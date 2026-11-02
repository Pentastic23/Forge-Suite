//! The Emberfall example project: a small made-up action RPG that shows what
//! Forge Core holds. Its entries come from `examples/emberfall/codex.json`, the
//! same file Balance Forge and Asset Forge build their examples from, so the
//! example projects link up through the shared Forge Core ids.

use std::fs;
use std::path::{Path, PathBuf};

use crate::db::{Entity, Project};
use crate::export::{self, ExportFile};
use crate::projects;

pub const CODEX: &str = include_str!("../../../../examples/emberfall/codex.json");
pub const NAME: &str = "Emberfall (example)";
const FILE_STEM: &str = "Emberfall Example";

/// Where the example project lives: always the same file, so opening the
/// example again opens your copy instead of making another one.
pub fn path() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM}.{}", projects::EXTENSION))
}

/// The .forgecodex written next to the example, ready to import into Balance
/// Forge or Asset Forge by hand.
pub fn codex_path() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM}.forgecodex"))
}

pub fn entities() -> Vec<Entity> {
    let file: ExportFile = serde_json::from_str(CODEX).expect("examples/emberfall/codex.json is a Forge Core export");
    file.entities
}

/// Opens the example project, making it first if it isn't there yet.
pub fn open_or_build() -> Result<(PathBuf, Project), String> {
    let path = path();
    if path.is_file() {
        return Ok((path.clone(), Project::open(&path).map_err(|e| e.to_string())?));
    }
    fs::create_dir_all(projects::projects_dir()).map_err(|e| e.to_string())?;
    match build(&path) {
        Ok(p) => {
            // The exchange file is a convenience; the example still opens without it.
            let _ = export::to_codex(&p, &[], &codex_path());
            Ok((path, p))
        }
        Err(e) => {
            for ext in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{ext}", path.display()));
            }
            Err(e)
        }
    }
}

pub fn build(path: &Path) -> Result<Project, String> {
    let err = |e: crate::db::DbError| e.to_string();
    let mut p = Project::create(path, NAME).map_err(err)?;
    let entities = entities();

    // An earlier draft of the Cinder Golem, so its version history has
    // something to compare and restore.
    if let Some(golem) = entities.iter().find(|e| e.id == "emberfall-mob-cinder-golem") {
        let mut draft = golem.clone();
        draft.links.clear();
        draft.status = "Draft".into();
        draft.summary = "Big rock monster at the bottom of the Hollow.".into();
        draft.fields.insert("health".into(), 360.into());
        draft.fields.insert("damage".into(), 34.into());
        p.save(draft).map_err(err)?;
    }
    p.import(entities).map_err(err)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ListQuery;

    #[test]
    fn builds_a_linked_example() {
        let dir = tempfile::tempdir().unwrap();
        let p = build(&dir.path().join("e.forgecore")).unwrap();
        assert_eq!(p.info().unwrap().name, NAME);
        let counts: std::collections::HashMap<_, _> = p.counts().unwrap().into_iter().collect();
        for kind in crate::db::KINDS {
            assert!(counts.get(kind).copied().unwrap_or(0) >= 3, "{kind} has a few entries");
        }
        let all = entities();
        assert_eq!(p.all().unwrap().len(), all.len());
        // Every link in the file survived.
        for e in &all {
            assert_eq!(p.get(&e.id).unwrap().links.len(), e.links.len(), "{}", e.name);
        }
        let golem = p.get("emberfall-mob-cinder-golem").unwrap();
        assert_eq!(golem.fields["health"], 420);
        assert_eq!(p.versions(&golem.id).unwrap().len(), 1);
        assert!(!p.backlinks("emberfall-zone-cinder-hollow").unwrap().is_empty());
        let found = p.list(&ListQuery { text: Some("ember".into()), ..Default::default() }).unwrap();
        assert!(found.len() >= 3);
    }
}
