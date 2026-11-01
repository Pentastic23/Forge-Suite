//! Where project files live and the recently opened list.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const EXTENSION: &str = "forgecore";

/// Shared with the other Forge apps; chosen in Forge Hub's Settings
/// (or `FORGE_PROJECTS_DIR`), else `Documents\Forge\Projects`.
pub fn projects_dir() -> PathBuf {
    forge_paths::projects_dir()
}

fn recent_file() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("ForgeSuite").join("forge-core").join("recent.json")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub path: PathBuf,
    pub name: String,
    pub modified: u64,
}

/// A file name from the project name: letters, digits, spaces and dashes.
pub fn slug(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' { c } else { ' ' }).collect();
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() { "Project".into() } else { s.chars().take(60).collect() }
}

pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let base = slug(name);
    let mut path = dir.join(format!("{base}.{EXTENSION}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} ({n}).{EXTENSION}"));
        n += 1;
    }
    path
}

pub fn new_project_path(name: &str) -> std::io::Result<PathBuf> {
    let dir = projects_dir();
    fs::create_dir_all(&dir)?;
    Ok(unique_path(&dir, name))
}

fn read_recent() -> Vec<PathBuf> {
    fs::read_to_string(recent_file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn remember(path: &Path) {
    let mut recent = read_recent();
    recent.retain(|p| p != path);
    recent.insert(0, path.to_path_buf());
    recent.truncate(20);
    let file = recent_file();
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&recent) {
        let _ = fs::write(file, json);
    }
}

fn describe(path: &Path) -> Option<ProjectFile> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
    let name = crate::db::Project::open(path).and_then(|p| p.info()).map(|i| i.name).ok()?;
    Some(ProjectFile { path: path.to_path_buf(), name, modified })
}

/// Projects in the projects folder plus recently opened ones elsewhere, newest first.
pub fn list() -> Vec<ProjectFile> {
    let mut paths = read_recent();
    if let Ok(entries) = fs::read_dir(projects_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == EXTENSION) && !paths.contains(&p) {
                paths.push(p);
            }
        }
    }
    let mut out: Vec<ProjectFile> = paths.iter().filter_map(|p| describe(p)).collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_and_unique_names() {
        assert_eq!(slug("Mouse: Kingdom / 2"), "Mouse Kingdom 2");
        assert_eq!(slug("???"), "Project");
        let dir = tempfile::tempdir().unwrap();
        let first = unique_path(dir.path(), "Game");
        assert!(first.ends_with("Game.forgecore"));
        fs::write(&first, "").unwrap();
        assert!(unique_path(dir.path(), "Game").ends_with("Game (2).forgecore"));
    }
}
