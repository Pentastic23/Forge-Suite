//! Bulk rename: build new names from a pattern, preview them, rename the files
//! on disk in one go and keep a record so the last batch can be undone.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::kinds::{self, NamingRule};
use crate::store::{AssetSummary, Project, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RenameSpec {
    /// Tokens: {name} {n} {folder} {category} {w} {h}. The extension is kept.
    pub pattern: String,
    pub case: NamingRule,
    pub find: String,
    pub replace: String,
    pub start: u32,
    pub pad: u8,
    pub lower_ext: bool,
}

impl Default for RenameSpec {
    fn default() -> Self {
        RenameSpec { pattern: "{name}".into(), case: NamingRule::None, find: String::new(), replace: String::new(), start: 1, pad: 2, lower_ext: true }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub id: String,
    pub from: String,
    pub to: String,
    /// Why this one can't be renamed, if it can't.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub id: String,
    pub folder: String,
    pub from_rel: String,
    pub to_rel: String,
}

fn split(name: &str) -> (&str, &str) {
    name.rsplit_once('.').unwrap_or((name, ""))
}

const BAD: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

pub fn plan(assets: &[AssetSummary], spec: &RenameSpec) -> Vec<Planned> {
    let mut out: Vec<Planned> = Vec::new();
    for (i, a) in assets.iter().enumerate() {
        let (stem, ext) = split(&a.name);
        let folder = a.rel_path.rsplit('/').nth(1).unwrap_or("");
        let n = format!("{:0width$}", spec.start as usize + i, width = spec.pad as usize);
        let mut s = spec
            .pattern
            .replace("{name}", stem)
            .replace("{n}", &n)
            .replace("{folder}", folder)
            .replace("{category}", &a.category.to_lowercase())
            .replace("{w}", &a.width.map(|x| x.to_string()).unwrap_or_default())
            .replace("{h}", &a.height.map(|x| x.to_string()).unwrap_or_default());
        if !spec.find.is_empty() {
            s = s.replace(&spec.find, &spec.replace);
        }
        if spec.case != NamingRule::None {
            s = kinds::to_case(&s, spec.case);
        }
        let s = s.trim().to_string();
        let ext = if spec.lower_ext { ext.to_lowercase() } else { ext.to_string() };
        let to = if ext.is_empty() { s.clone() } else { format!("{s}.{ext}") };
        let problem = if a.missing {
            Some("The file is missing".into())
        } else if s.is_empty() {
            Some("The new name is empty".into())
        } else if s.chars().any(|c| BAD.contains(&c) || c.is_control()) {
            Some("Has a character file names can't use".into())
        } else {
            None
        };
        out.push(Planned { id: a.id.clone(), from: a.name.clone(), to, problem });
    }
    // Two files can't end up with the same name in one folder, and a name can't take an existing file's place.
    let dirs: Vec<PathBuf> = assets.iter().map(|a| Path::new(&a.path).parent().map(Path::to_path_buf).unwrap_or_default()).collect();
    let leaving: HashSet<PathBuf> = assets.iter().zip(&out).filter(|(_, p)| p.from != p.to).map(|(a, _)| PathBuf::from(&a.path)).collect();
    let mut taken: HashMap<(PathBuf, String), usize> = HashMap::new();
    for (i, p) in out.iter().enumerate() {
        *taken.entry((dirs[i].clone(), p.to.to_lowercase())).or_default() += 1;
    }
    for (i, p) in out.iter_mut().enumerate() {
        if p.problem.is_some() || p.from == p.to {
            continue;
        }
        let target = dirs[i].join(&p.to);
        if taken[&(dirs[i].clone(), p.to.to_lowercase())] > 1 {
            p.problem = Some("Another file in this batch gets the same name".into());
        } else if target.exists() && !leaving.contains(&target) && !p.from.eq_ignore_ascii_case(&p.to) {
            p.problem = Some("A file with this name already exists".into());
        }
    }
    out
}

/// Renames on disk in two steps (through temporary names) so swaps and
/// chains work, then updates the library. Stops and undoes everything on error.
pub fn apply(p: &Project, assets: &[AssetSummary], planned: &[Planned]) -> Result<Vec<Done>> {
    let by_id: HashMap<&str, &AssetSummary> = assets.iter().map(|a| (a.id.as_str(), a)).collect();
    let mut todo: Vec<(&AssetSummary, String)> = Vec::new();
    for pl in planned.iter().filter(|x| x.problem.is_none() && x.from != x.to) {
        if let Some(a) = by_id.get(pl.id.as_str()) {
            todo.push((a, pl.to.clone()));
        }
    }
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let mut stage1: Vec<(PathBuf, PathBuf)> = Vec::new();
    let undo1 = |done: &[(PathBuf, PathBuf)]| {
        for (from, tmp) in done.iter().rev() {
            let _ = fs::rename(tmp, from);
        }
    };
    for (i, (a, _)) in todo.iter().enumerate() {
        let from = PathBuf::from(&a.path);
        let tmp = from.with_file_name(format!(".af-rename-{tag}-{i}"));
        if let Err(e) = fs::rename(&from, &tmp) {
            undo1(&stage1);
            return Err(format!("Couldn't rename {}: {e}. Nothing was changed.", a.name));
        }
        stage1.push((from, tmp));
    }
    let mut stage2: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (i, (a, to)) in todo.iter().enumerate() {
        let tmp = &stage1[i].1;
        let dest = tmp.with_file_name(to);
        if let Err(e) = fs::rename(tmp, &dest) {
            for (t, d) in stage2.iter().rev() {
                let _ = fs::rename(d, t);
            }
            undo1(&stage1);
            return Err(format!("Couldn't rename {} to {to}: {e}. Nothing was changed.", a.name));
        }
        stage2.push((tmp.clone(), dest));
    }
    // Same two steps in the library, so swapped names don't collide there either.
    for (a, _) in &todo {
        p.conn
            .execute("UPDATE assets SET rel_path = ?2 WHERE id = ?1", rusqlite::params![a.id, format!("\u{1}renaming/{tag}/{}", a.id)])
            .map_err(|e| format!("Database error: {e}"))?;
    }
    let mut done = Vec::new();
    for (a, to) in &todo {
        let to_rel = match a.rel_path.rsplit_once('/') {
            Some((dir, _)) => format!("{dir}/{to}"),
            None => to.clone(),
        };
        p.renamed(&a.id, &to_rel)?;
        done.push(Done { id: a.id.clone(), folder: a.folder_id.clone(), from_rel: a.rel_path.clone(), to_rel });
    }
    if !done.is_empty() {
        p.log(None, "Bulk rename", &format!("{} files renamed", done.len()))?;
    }
    Ok(done)
}

/// Puts the names from a batch back. Files renamed again since are left alone.
pub fn undo(p: &Project, batch: &[Done]) -> Result<usize> {
    let ids: Vec<String> = batch.iter().map(|d| d.id.clone()).collect();
    let now: HashMap<String, AssetSummary> = p.summaries(&ids)?.into_iter().map(|a| (a.id.clone(), a)).collect();
    let mut assets = Vec::new();
    let mut planned = Vec::new();
    for d in batch {
        let Some(a) = now.get(&d.id) else { continue };
        if a.rel_path != d.to_rel {
            continue;
        }
        let old_name = d.from_rel.rsplit('/').next().unwrap_or(&d.from_rel).to_string();
        planned.push(Planned { id: a.id.clone(), from: a.name.clone(), to: old_name, problem: None });
        assets.push(a.clone());
    }
    Ok(apply(p, &assets, &planned)?.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::sample;
    use crate::store::AssetQuery;

    #[test]
    fn plans_renames_and_undoes() {
        let (_dir, p, _) = sample();
        let icons = p.list(&AssetQuery { category: Some("Icon".into()), ..Default::default() }).unwrap().assets;
        assert_eq!(icons.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Big Axe.png", "bow.png", "shield.png", "sword.png"]);

        let spec = RenameSpec { pattern: "icon {name}".into(), case: NamingRule::SnakeCase, ..Default::default() };
        let plan1 = plan(&icons, &spec);
        assert_eq!(plan1.iter().map(|x| x.to.as_str()).collect::<Vec<_>>(), ["icon_big_axe.png", "icon_bow.png", "icon_shield.png", "icon_sword.png"]);
        assert!(plan1.iter().all(|x| x.problem.is_none()));

        let numbered = plan(&icons, &RenameSpec { pattern: "item_{n}".into(), start: 9, pad: 3, ..Default::default() });
        assert_eq!(numbered[1].to, "item_010.png");
        let clash = plan(&icons, &RenameSpec { pattern: "same".into(), ..Default::default() });
        assert!(clash.iter().all(|x| x.problem.as_deref() == Some("Another file in this batch gets the same name")));
        let taken = plan(&icons[1..2], &RenameSpec { pattern: "sword".into(), ..Default::default() });
        assert_eq!(taken[0].problem.as_deref(), Some("A file with this name already exists"));

        let done = apply(&p, &icons, &plan1).unwrap();
        assert_eq!(done.len(), 4);
        let after = p.list(&AssetQuery { category: Some("Icon".into()), ..Default::default() }).unwrap().assets;
        assert!(after.iter().all(|a| a.name.starts_with("icon_") && Path::new(&a.path).is_file()));
        assert_eq!(p.list(&AssetQuery { text: Some("icon big axe".into()), ..Default::default() }).unwrap().total, 1, "search follows the rename");

        // Swapping two names works thanks to the two-step rename.
        let two: Vec<AssetSummary> = after.iter().filter(|a| a.name == "icon_bow.png" || a.name == "icon_shield.png").cloned().collect();
        let swap = vec![
            Planned { id: two[0].id.clone(), from: two[0].name.clone(), to: two[1].name.clone(), problem: None },
            Planned { id: two[1].id.clone(), from: two[1].name.clone(), to: two[0].name.clone(), problem: None },
        ];
        assert_eq!(apply(&p, &two, &swap).unwrap().len(), 2);

        assert_eq!(undo(&p, &done).unwrap(), 2, "the two swapped files were renamed again, so they're left alone");
        let names: Vec<String> = p.list(&AssetQuery { category: Some("Icon".into()), ..Default::default() }).unwrap().assets.into_iter().map(|a| a.name).collect();
        assert!(names.contains(&"Big Axe.png".to_string()) && names.contains(&"sword.png".to_string()), "{names:?}");
    }
}
