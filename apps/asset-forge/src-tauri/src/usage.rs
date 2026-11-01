//! Finding out which assets the game actually uses, by reading the game
//! project's text files (scenes, prefabs, resources, scripts, data). Nothing
//! is changed. Binary formats (like Unreal's .uasset) can't be read this way.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

use crate::store::AssetSummary;

const TEXT_EXTS: &[&str] = &[
    // Unity
    "unity", "prefab", "asset", "mat", "anim", "controller", "overridecontroller", "spriteatlas", "playable", "asmdef",
    // Godot
    "tscn", "tres", "gd", "godot", "cfg",
    // Code and data
    "cs", "js", "ts", "lua", "py", "cpp", "c", "h", "hpp", "rs", "java", "kt", "hx", "json", "xml", "yaml", "yml", "ini", "toml", "txt", "csv", "tmx", "tsx", "ldtk", "atlas", "plist", "html",
];
const SKIP_DIRS: &[&str] = &["library", "temp", "obj", "build", "builds", "logs", ".git", ".godot", ".import", "node_modules", "intermediate", "saved", "deriveddatacache", "binaries", "target"];
const MAX_FILE: u64 = 20_000_000;

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub files_read: usize,
    pub used: usize,
    pub unused: usize,
}

fn tokens(text: &str, into: &mut HashMap<String, i64>) {
    for t in text.split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '-' || c == '.')) {
        let t = t.trim_matches('.');
        if t.len() >= 2 {
            *into.entry(t.to_lowercase()).or_default() += 1;
        }
    }
}

/// Unity keeps a GUID for each file in its .meta file; scenes refer to that, not to the name.
fn unity_guid(asset_path: &Path) -> Option<String> {
    let meta = fs::read_to_string(format!("{}.meta", asset_path.display())).ok()?;
    meta.lines().find_map(|l| l.trim().strip_prefix("guid:").map(|g| g.trim().to_lowercase()))
}

/// Counts mentions of each asset in the game project. A mention is the file
/// name, the name without extension, or the Unity GUID, so it leans towards
/// "used" rather than wrongly calling a file unused.
pub fn scan(project_dir: &Path, assets: &[AssetSummary]) -> Result<(HashMap<String, i64>, UsageReport), String> {
    if !project_dir.is_dir() {
        return Err(format!("{} is not a folder", project_dir.display()));
    }
    let mut seen: HashMap<String, i64> = HashMap::new();
    let mut report = UsageReport::default();
    let walker = WalkDir::new(project_dir).into_iter().filter_entry(|e| e.depth() == 0 || !SKIP_DIRS.contains(&e.file_name().to_string_lossy().to_lowercase().as_str()));
    for e in walker.flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let ext = e.path().extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if !TEXT_EXTS.contains(&ext.as_str()) || e.metadata().map(|m| m.len() > MAX_FILE).unwrap_or(true) {
            continue;
        }
        if let Ok(bytes) = fs::read(e.path()) {
            tokens(&String::from_utf8_lossy(&bytes), &mut seen);
            report.files_read += 1;
        }
    }
    let mut counts = HashMap::new();
    for a in assets.iter().filter(|a| !a.missing) {
        let name = a.name.to_lowercase();
        let stem = name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| name.clone());
        let mut n = seen.get(&name).copied().unwrap_or(0);
        if stem != name {
            n += seen.get(&stem).copied().unwrap_or(0);
        }
        if let Some(g) = unity_guid(Path::new(&a.path)) {
            n += seen.get(&g).copied().unwrap_or(0);
        }
        if n > 0 {
            report.used += 1;
        } else {
            report.unused += 1;
        }
        counts.insert(a.id.clone(), n);
    }
    Ok((counts, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::sample;

    #[test]
    fn finds_mentions() {
        let (dir, p, _) = sample();
        let game = dir.path().join("godot_project");
        fs::create_dir_all(game.join("scenes")).unwrap();
        fs::write(game.join("scenes/hud.tscn"), "[ext_resource path=\"res://ui/icons/sword.png\" type=\"Texture2D\"]").unwrap();
        fs::write(game.join("scenes/player.gd"), "var walk = preload(\"res://Characters/knight_walk_01.png\")\nplay_sound(\"hit\")").unwrap();
        fs::write(game.join("big.uasset"), "sword.png shield.png").unwrap();
        fs::create_dir_all(game.join(".godot")).unwrap();
        fs::write(game.join(".godot/cache.cfg"), "bow.png").unwrap();

        let all = p.all().unwrap();
        let (counts, report) = scan(&game, &all).unwrap();
        let by_name = |n: &str| counts[&all.iter().find(|a| a.name == n).unwrap().id];
        assert_eq!(report.files_read, 2);
        assert_eq!(by_name("sword.png"), 1);
        assert_eq!(by_name("knight_walk_01.png"), 1);
        assert_eq!(by_name("hit.wav"), 1, "name without extension counts");
        assert_eq!(by_name("shield.png"), 0, "binary files are not read");
        assert_eq!(by_name("bow.png"), 0, "engine cache folders are skipped");
        assert_eq!(report.used, 3);
    }
}
