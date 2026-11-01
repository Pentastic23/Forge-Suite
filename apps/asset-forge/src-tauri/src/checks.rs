//! Project checks: problems a technical art director would look for before a
//! build. Every check is a plain rule over what the library already knows.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::kinds::{self, NamingRule};
use crate::store::{human_size, AssetSummary};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckSettings {
    pub naming: NamingRule,
    pub max_image_px: u32,
    pub max_image_mb: f64,
    pub max_sfx_mb: f64,
    pub max_music_mb: f64,
    pub max_model_mb: f64,
    /// Flag textures whose sides aren't powers of two.
    pub power_of_two: bool,
}

impl Default for CheckSettings {
    fn default() -> Self {
        CheckSettings { naming: NamingRule::None, max_image_px: 4096, max_image_mb: 8.0, max_sfx_mb: 5.0, max_music_mb: 30.0, max_model_mb: 50.0, power_of_two: true }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Which check found it: missing, duplicate, oversized, sizes, frames, states, naming, pot, unused.
    pub check: String,
    pub severity: Severity,
    pub title: String,
    pub detail: String,
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryStat {
    pub count: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub assets: i64,
    pub bytes: i64,
    /// Uncompressed RGBA size of every image, a rough upper bound for GPU memory.
    pub texture_memory: i64,
    /// Bytes taken by the second and later copies of identical files.
    pub duplicate_bytes: i64,
    pub by_category: BTreeMap<String, CategoryStat>,
    /// Whether a game-project usage scan has run.
    pub usage_known: bool,
    pub unused: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub summary: Summary,
    pub findings: Vec<Finding>,
}

fn dir_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

fn stem_of(name: &str) -> &str {
    name.rsplit_once('.').map(|(s, _)| s).unwrap_or(name)
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn list_names(assets: &[&AssetSummary], max: usize) -> String {
    let mut s: Vec<&str> = assets.iter().take(max).map(|a| a.name.as_str()).collect();
    if assets.len() > max {
        s.push("…");
    }
    s.join(", ")
}

pub fn run(all: &[AssetSummary], cfg: &CheckSettings) -> Report {
    let live: Vec<&AssetSummary> = all.iter().filter(|a| !a.missing).collect();
    let mut findings = Vec::new();
    let mut summary = Summary { assets: live.len() as i64, ..Default::default() };
    for a in &live {
        summary.bytes += a.size;
        let c = summary.by_category.entry(a.category.clone()).or_default();
        c.count += 1;
        c.bytes += a.size;
        if a.file_type == "image" {
            if let (Some(w), Some(h)) = (a.width, a.height) {
                summary.texture_memory += w * h * 4;
            }
        }
    }

    // Missing files
    let missing: Vec<&AssetSummary> = all.iter().filter(|a| a.missing).collect();
    if !missing.is_empty() {
        findings.push(Finding {
            check: "missing".into(),
            severity: Severity::Error,
            title: format!("{} missing", plural(missing.len(), "file is", "files are")),
            detail: format!("The library knew these files but they are gone from their folder: {}. Rescan after restoring them, or forget them.", list_names(&missing, 6)),
            asset_ids: missing.iter().map(|a| a.id.clone()).collect(),
        });
    }

    // Duplicates
    let mut by_hash: HashMap<&str, Vec<&AssetSummary>> = HashMap::new();
    for a in live.iter().filter(|a| a.size > 0) {
        by_hash.entry(a.hash.as_str()).or_default().push(a);
    }
    let mut dup_groups: Vec<Vec<&AssetSummary>> = by_hash.into_values().filter(|g| g.len() > 1).collect();
    dup_groups.sort_by(|a, b| (b[0].size * b.len() as i64).cmp(&(a[0].size * a.len() as i64)).then(a[0].rel_path.cmp(&b[0].rel_path)));
    for g in dup_groups {
        summary.duplicate_bytes += g[0].size * (g.len() as i64 - 1);
        findings.push(Finding {
            check: "duplicate".into(),
            severity: Severity::Warning,
            title: format!("{} copies of {}", g.len(), g[0].name),
            detail: format!("Identical content ({} each): {}", human_size(g[0].size), g.iter().map(|a| a.rel_path.as_str()).collect::<Vec<_>>().join(", ")),
            asset_ids: g.iter().map(|a| a.id.clone()).collect(),
        });
    }

    // Oversized
    let mb = |x: f64| (x * 1_000_000.0) as i64;
    let mut big: BTreeMap<&str, Vec<&AssetSummary>> = BTreeMap::new();
    for a in &live {
        let reason = match (a.file_type.as_str(), a.category.as_str()) {
            ("image", _) if a.width.unwrap_or(0) > cfg.max_image_px as i64 || a.height.unwrap_or(0) > cfg.max_image_px as i64 => Some("px"),
            ("image", _) if a.size > mb(cfg.max_image_mb) => Some("image"),
            ("audio", "Music") if a.size > mb(cfg.max_music_mb) => Some("music"),
            ("audio", c) if c != "Music" && a.size > mb(cfg.max_sfx_mb) => Some("sfx"),
            ("model", _) if a.size > mb(cfg.max_model_mb) => Some("model"),
            _ => None,
        };
        if let Some(r) = reason {
            big.entry(r).or_default().push(a);
        }
    }
    for (r, g) in big {
        let what = match r {
            "px" => format!("wider or taller than {} px", cfg.max_image_px),
            "image" => format!("images over {} MB", cfg.max_image_mb),
            "music" => format!("music over {} MB", cfg.max_music_mb),
            "sfx" => format!("sound effects over {} MB", cfg.max_sfx_mb),
            _ => format!("models over {} MB", cfg.max_model_mb),
        };
        findings.push(Finding {
            check: "oversized".into(),
            severity: Severity::Warning,
            title: format!("{} {what}", plural(g.len(), "file", "files")),
            detail: format!("Largest: {}. Large files slow loading and grow the build.", g.iter().max_by_key(|a| a.size).map(|a| format!("{} ({})", a.name, human_size(a.size))).unwrap_or_default()),
            asset_ids: g.iter().map(|a| a.id.clone()).collect(),
        });
    }

    // Size consistency: in a folder of icons or sprites that mostly share one size, the odd ones out.
    let mut groups: BTreeMap<(&str, &str), Vec<&AssetSummary>> = BTreeMap::new();
    for a in live.iter().filter(|a| matches!(a.category.as_str(), "Icon" | "Sprite" | "UI" | "Animation") && a.width.is_some()) {
        groups.entry((dir_of(&a.rel_path), a.category.as_str())).or_default().push(a);
    }
    for ((dir, cat), g) in groups {
        if g.len() < 3 {
            continue;
        }
        let mut sizes: HashMap<(i64, i64), usize> = HashMap::new();
        for a in &g {
            *sizes.entry((a.width.unwrap_or(0), a.height.unwrap_or(0))).or_default() += 1;
        }
        let (&(mw, mh), &count) = sizes.iter().max_by_key(|(k, v)| (**v, std::cmp::Reverse(**k))).unwrap();
        if count * 10 < g.len() * 6 || count == g.len() {
            continue;
        }
        let odd: Vec<&AssetSummary> = g.iter().copied().filter(|a| (a.width.unwrap_or(0), a.height.unwrap_or(0)) != (mw, mh)).collect();
        findings.push(Finding {
            check: "sizes".into(),
            severity: Severity::Warning,
            title: format!("{} in {} not {mw}×{mh}", plural(odd.len(), &cat.to_lowercase(), &format!("{}s", cat.to_lowercase())), if dir.is_empty() { "the top folder" } else { dir }),
            detail: format!(
                "{count} of {} are {mw}×{mh}. Different: {}.",
                g.len(),
                odd.iter().take(6).map(|a| format!("{} ({}×{})", a.name, a.width.unwrap_or(0), a.height.unwrap_or(0))).collect::<Vec<_>>().join(", ")
            ),
            asset_ids: odd.iter().map(|a| a.id.clone()).collect(),
        });
    }

    // Numbered frames with gaps, like walk_01, walk_02, walk_04.
    let mut seqs: BTreeMap<(String, String, String), Vec<(u32, usize, &AssetSummary)>> = BTreeMap::new();
    for a in live.iter().filter(|a| a.file_type == "image") {
        let stem = stem_of(&a.name);
        let digits: String = stem.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
        if digits.is_empty() || digits.len() > 4 || digits.len() == stem.len() {
            continue;
        }
        let base = &stem[..stem.len() - digits.len()];
        if let Ok(n) = digits.parse::<u32>() {
            seqs.entry((dir_of(&a.rel_path).to_string(), base.to_string(), a.ext.to_lowercase())).or_default().push((n, digits.len(), a));
        }
    }
    for ((dir, base, _), mut frames) in seqs {
        if frames.len() < 2 {
            continue;
        }
        frames.sort_by_key(|f| f.0);
        let have: BTreeSet<u32> = frames.iter().map(|f| f.0).collect();
        let (lo, hi) = (frames[0].0, frames[frames.len() - 1].0);
        if hi - lo > 500 {
            continue;
        }
        let gaps: Vec<u32> = (lo..=hi).filter(|n| !have.contains(n)).collect();
        if gaps.is_empty() || gaps.len() * 2 > frames.len() + 1 {
            continue;
        }
        let width = frames[0].1;
        let show = |n: u32| format!("{base}{n:0width$}");
        findings.push(Finding {
            check: "frames".into(),
            severity: Severity::Warning,
            title: format!("{} missing from {}", plural(gaps.len(), "frame", "frames"), base.trim_end_matches(['_', '-', ' '])),
            detail: format!(
                "In {}: frames {}–{} exist, but {} {} not there.",
                if dir.is_empty() { "the top folder" } else { &dir },
                show(lo),
                show(hi),
                gaps.iter().take(8).map(|&n| show(n)).collect::<Vec<_>>().join(", "),
                if gaps.len() == 1 { "is" } else { "are" }
            ),
            asset_ids: frames.iter().map(|f| f.2.id.clone()).collect(),
        });
    }

    // UI sets missing a state the others have, like a button without a disabled image.
    const STATES: &[&str] = &["normal", "hover", "pressed", "disabled", "selected", "focused", "active", "inactive", "down", "up", "over", "highlight", "highlighted", "on", "off", "empty", "full", "locked", "unlocked"];
    let mut sets: BTreeMap<String, BTreeMap<String, (BTreeSet<String>, Vec<&AssetSummary>)>> = BTreeMap::new();
    for a in live.iter().filter(|a| a.file_type == "image") {
        let w = kinds::words(stem_of(&a.name));
        if w.len() < 2 {
            continue;
        }
        let last = w[w.len() - 1].as_str();
        if STATES.contains(&last) {
            let base = w[..w.len() - 1].join("_");
            let e = sets.entry(dir_of(&a.rel_path).to_string()).or_default().entry(base).or_default();
            e.0.insert(last.to_string());
            e.1.push(a);
        }
    }
    for (dir, bases) in sets {
        if bases.len() < 2 {
            continue;
        }
        let mut freq: BTreeMap<&str, usize> = BTreeMap::new();
        for (states, _) in bases.values() {
            for s in states {
                *freq.entry(s.as_str()).or_default() += 1;
            }
        }
        for (base, (states, files)) in &bases {
            let lacking: Vec<&str> = freq.iter().filter(|(s, n)| **n >= 2 && **n * 10 >= bases.len() * 6 && !states.contains(**s)).map(|(s, _)| *s).collect();
            if lacking.is_empty() {
                continue;
            }
            findings.push(Finding {
                check: "states".into(),
                severity: Severity::Warning,
                title: format!("{base} has no {} image", lacking.join(" or ")),
                detail: format!(
                    "Most sets in {} have {}. {base} has {}.",
                    if dir.is_empty() { "the top folder" } else { &dir },
                    lacking.iter().map(|s| format!("\"{s}\" ({} of {})", freq[s], bases.len())).collect::<Vec<_>>().join(", "),
                    states.iter().cloned().collect::<Vec<_>>().join(", ")
                ),
                asset_ids: files.iter().map(|a| a.id.clone()).collect(),
            });
        }
    }

    // Naming
    let mut naming: BTreeMap<String, Vec<&AssetSummary>> = BTreeMap::new();
    for a in &live {
        if let Some(p) = kinds::naming_problem(stem_of(&a.name), &a.ext, cfg.naming) {
            naming.entry(p).or_default().push(a);
        }
    }
    for (problem, g) in naming {
        findings.push(Finding {
            check: "naming".into(),
            severity: Severity::Info,
            title: format!("{} {problem}", plural(g.len(), "name", "names")),
            detail: format!("For example {}. Bulk rename can fix these.", list_names(&g, 4)),
            asset_ids: g.iter().map(|a| a.id.clone()).collect(),
        });
    }

    // Power-of-two textures
    if cfg.power_of_two {
        let npot: Vec<&AssetSummary> = live
            .iter()
            .copied()
            .filter(|a| a.category == "Texture" && a.width.zip(a.height).is_some_and(|(w, h)| w > 0 && h > 0 && ((w & (w - 1)) != 0 || (h & (h - 1)) != 0)))
            .collect();
        if !npot.is_empty() {
            findings.push(Finding {
                check: "pot".into(),
                severity: Severity::Info,
                title: format!("{} not a power of two", plural(npot.len(), "texture is", "textures are")),
                detail: format!("Some platforms can't compress or mipmap these well: {}.", list_names(&npot, 5)),
                asset_ids: npot.iter().map(|a| a.id.clone()).collect(),
            });
        }
    }

    // Unused (only after a usage scan)
    summary.usage_known = live.iter().any(|a| a.refs.is_some());
    if summary.usage_known {
        let unused: Vec<&AssetSummary> = live.iter().copied().filter(|a| a.refs == Some(0)).collect();
        summary.unused = unused.len() as i64;
        if !unused.is_empty() {
            let bytes: i64 = unused.iter().map(|a| a.size).sum();
            findings.push(Finding {
                check: "unused".into(),
                severity: Severity::Info,
                title: format!("{} not used in the game project", plural(unused.len(), "file", "files")),
                detail: format!("{} in total. Not mentioned in any scene, prefab, resource or script file. Check before deleting: code can build file names at run time.", human_size(bytes)),
                asset_ids: unused.iter().map(|a| a.id.clone()).collect(),
            });
        }
    }

    findings.sort_by(|a, b| a.severity.cmp(&b.severity));
    Report { summary, findings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(id: &str, rel: &str, cat: &str, w: i64, h: i64, hash: &str) -> AssetSummary {
        let name = rel.rsplit('/').next().unwrap().to_string();
        AssetSummary {
            id: id.into(),
            folder_id: "f".into(),
            ext: name.rsplit_once('.').unwrap().1.into(),
            name,
            rel_path: rel.into(),
            path: rel.into(),
            file_type: "image".into(),
            category: cat.into(),
            status: "WIP".into(),
            size: 1000,
            width: Some(w),
            height: Some(h),
            duration_ms: None,
            hash: hash.into(),
            missing: false,
            refs: None,
            mtime: 0,
            tags: vec![],
        }
    }

    fn checks(r: &Report, check: &str) -> Vec<Finding> {
        r.findings.iter().filter(|f| f.check == check).cloned().collect()
    }

    #[test]
    fn finds_problems() {
        let mut all = vec![
            a("1", "ui/icons/sword.png", "Icon", 16, 16, "h1"),
            a("2", "ui/icons/shield.png", "Icon", 16, 16, "h2"),
            a("3", "ui/icons/bow.png", "Icon", 16, 16, "h3"),
            a("4", "ui/icons/axe.png", "Icon", 18, 16, "h4"),
            a("5", "chars/walk_01.png", "Animation", 32, 32, "h5"),
            a("6", "chars/walk_02.png", "Animation", 32, 32, "h6"),
            a("7", "chars/walk_04.png", "Animation", 32, 32, "h7"),
            a("8", "chars/walk_copy.png", "Animation", 32, 32, "h5"),
            a("9", "ui/btn_play_normal.png", "UI", 64, 24, "h9"),
            a("10", "ui/btn_play_hover.png", "UI", 64, 24, "h10"),
            a("11", "ui/btn_play_disabled.png", "UI", 64, 24, "h11"),
            a("12", "ui/btn_quit_normal.png", "UI", 64, 24, "h12"),
            a("13", "ui/btn_quit_hover.png", "UI", 64, 24, "h13"),
            a("14", "ui/btn_menu_normal.png", "UI", 64, 24, "h14"),
            a("15", "ui/btn_menu_hover.png", "UI", 64, 24, "h15"),
            a("16", "ui/btn_menu_disabled.png", "UI", 64, 24, "h16"),
            a("17", "tex/Stone Wall.png", "Texture", 500, 512, "h17"),
            a("18", "tex/huge.png", "Texture", 8192, 8192, "h18"),
        ];
        all[16].size = 3_000_000;
        all.push(a("20", "chars/HeroIdle.png", "Sprite", 32, 32, "h20"));
        let mut gone = a("19", "old.png", "Sprite", 1, 1, "h19");
        gone.missing = true;
        all.push(gone);

        let r = run(&all, &CheckSettings::default());
        assert_eq!(r.findings[0].check, "missing", "errors first");
        let sizes = checks(&r, "sizes");
        assert_eq!(sizes.len(), 1);
        assert_eq!(sizes[0].asset_ids, ["4"]);
        assert!(sizes[0].title.contains("16×16"), "{}", sizes[0].title);
        let frames = checks(&r, "frames");
        assert_eq!(frames.len(), 1);
        assert!(frames[0].detail.contains("walk_03"), "{}", frames[0].detail);
        let dups = checks(&r, "duplicate");
        assert_eq!(dups[0].asset_ids.len(), 2);
        assert_eq!(r.summary.duplicate_bytes, 1000);
        let states = checks(&r, "states");
        assert_eq!(states.len(), 1);
        assert!(states[0].title.starts_with("btn_quit has no disabled"), "{}", states[0].title);
        assert_eq!(checks(&r, "oversized")[0].asset_ids, ["18"]);
        assert_eq!(checks(&r, "pot")[0].asset_ids, ["17"]);
        assert_eq!(checks(&r, "naming")[0].asset_ids, ["17"], "space in Stone Wall");
        assert!(checks(&r, "unused").is_empty(), "no usage scan yet");
        assert_eq!(r.summary.assets, 19);
        assert_eq!(r.summary.by_category["Icon"].count, 4);

        let snake = run(&all, &CheckSettings { naming: NamingRule::SnakeCase, ..Default::default() });
        let snake_names = checks(&snake, "naming").into_iter().find(|f| f.title.contains("snake")).unwrap();
        assert_eq!(snake_names.asset_ids, ["20"]);

        for x in all.iter_mut() {
            x.refs = Some(if x.id == "1" { 0 } else { 2 });
        }
        let used = run(&all, &CheckSettings::default());
        assert_eq!(checks(&used, "unused")[0].asset_ids, ["1"]);
    }
}
