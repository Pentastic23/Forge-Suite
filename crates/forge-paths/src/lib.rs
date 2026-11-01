//! Folders shared by every Forge app.
//!
//! The projects folder is chosen in Forge Hub's Settings and stored in
//! `%LOCALAPPDATA%\ForgeSuite\suite.json`, which every app reads, so the apps
//! still work on their own. `FORGE_PROJECTS_DIR` overrides it for one run.

use serde_json::{Map, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Environment variable that overrides the projects folder.
pub const PROJECTS_ENV: &str = "FORGE_PROJECTS_DIR";
const KEY: &str = "projectsDir";

/// `%LOCALAPPDATA%\ForgeSuite`: local to this PC, never synced.
pub fn suite_dir() -> PathBuf {
    dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("ForgeSuite")
}

/// The suite-wide settings file.
pub fn suite_file() -> PathBuf {
    suite_dir().join("suite.json")
}

/// `Documents\Forge\Projects`, used until another folder is chosen.
pub fn default_projects_dir() -> PathBuf {
    dirs::document_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_else(std::env::temp_dir)).join("Forge").join("Projects")
}

/// Where the projects folder setting comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Env,
    Setting,
    Default,
}

/// Where project files live, and why.
pub fn projects_dir_with_source() -> (PathBuf, Source) {
    resolve(std::env::var_os(PROJECTS_ENV).map(PathBuf::from), &suite_file(), default_projects_dir())
}

/// Where project files live: `FORGE_PROJECTS_DIR`, then the folder chosen in
/// Forge Hub, then `Documents\Forge\Projects`.
pub fn projects_dir() -> PathBuf {
    projects_dir_with_source().0
}

/// The folder saved in Forge Hub's Settings, if any (ignores the env override).
pub fn saved_projects_dir() -> Option<PathBuf> {
    read_setting(&suite_file())
}

/// Saves the projects folder for every app; `None` goes back to the default.
pub fn set_projects_dir(dir: Option<&Path>) -> io::Result<()> {
    write_setting(&suite_file(), dir)
}

/// True when the path is inside a OneDrive folder, which syncs and can lock
/// SQLite files while they are open.
pub fn in_onedrive(path: &Path) -> bool {
    path.to_string_lossy().split(['\\', '/']).any(|part| part.to_lowercase().starts_with("onedrive"))
}

fn resolve(env: Option<PathBuf>, file: &Path, default: PathBuf) -> (PathBuf, Source) {
    if let Some(p) = env.filter(|p| !p.as_os_str().is_empty()) {
        return (p, Source::Env);
    }
    match read_setting(file) {
        Some(p) => (p, Source::Setting),
        None => (default, Source::Default),
    }
}

fn read_map(file: &Path) -> Map<String, Value> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

fn read_setting(file: &Path) -> Option<PathBuf> {
    read_map(file).get(KEY).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(PathBuf::from)
}

fn write_setting(file: &Path, dir: Option<&Path>) -> io::Result<()> {
    let mut map = read_map(file);
    match dir {
        Some(d) => {
            if !d.is_absolute() {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "Choose a full folder path, like E:\\Forge Hub\\Projects"));
            }
            fs::create_dir_all(d)?;
            map.insert(KEY.into(), Value::String(d.to_string_lossy().into_owned()));
        }
        None => {
            map.remove(KEY);
        }
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    // Write then rename, so an app reading at the same moment never sees half a file.
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&Value::Object(map)).map_err(io::Error::other)?)?;
    fs::rename(&tmp, file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_then_setting_then_default() {
        let t = tempfile::tempdir().unwrap();
        let file = t.path().join("suite.json");
        let default = t.path().join("default");
        assert_eq!(resolve(None, &file, default.clone()), (default.clone(), Source::Default));

        let chosen = t.path().join("Projects");
        write_setting(&file, Some(&chosen)).unwrap();
        assert!(chosen.is_dir(), "the chosen folder is created");
        assert_eq!(resolve(None, &file, default.clone()), (chosen.clone(), Source::Setting));
        assert_eq!(resolve(Some(PathBuf::new()), &file, default.clone()).1, Source::Setting, "an empty env var is ignored");

        let env = t.path().join("env");
        assert_eq!(resolve(Some(env.clone()), &file, default.clone()), (env, Source::Env));

        write_setting(&file, None).unwrap();
        assert_eq!(resolve(None, &file, default.clone()), (default, Source::Default));
    }

    #[test]
    fn keeps_other_keys_and_survives_bad_files() {
        let t = tempfile::tempdir().unwrap();
        let file = t.path().join("suite.json");
        fs::write(&file, r#"{"theme":"dark"}"#).unwrap();
        write_setting(&file, Some(&t.path().join("P"))).unwrap();
        assert_eq!(read_map(&file).get("theme").and_then(Value::as_str), Some("dark"));

        fs::write(&file, "not json").unwrap();
        assert_eq!(read_setting(&file), None);
        assert!(write_setting(&file, Some(Path::new("relative"))).is_err());
    }

    #[test]
    fn spots_onedrive() {
        assert!(in_onedrive(Path::new(r"C:\Users\Mason\OneDrive\Documents\Forge\Projects")));
        assert!(in_onedrive(Path::new("/home/m/OneDrive - Studio/Projects")));
        assert!(!in_onedrive(Path::new(r"E:\Forge Hub\Projects")));
    }
}
