use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Folders scanned for installed apps (each app in its own subfolder).
    pub app_folders: Vec<PathBuf>,
    /// Close Forge Hub's window after launching an app.
    pub close_on_launch: bool,
    /// Check for updates when Forge Hub starts.
    pub check_updates_on_start: bool,
    /// Days of log history to keep.
    pub log_retention_days: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            app_folders: vec![paths::default_apps_dir()],
            close_on_launch: false,
            check_updates_on_start: true,
            log_retention_days: 30,
        }
    }
}

pub fn load(dir: &Path) -> Settings {
    fs::read_to_string(dir.join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, settings: &Settings) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    fs::write(dir.join("settings.json"), json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_defaults_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Settings::default());
        let mut s = Settings::default();
        s.close_on_launch = true;
        save(dir.path(), &s).unwrap();
        assert_eq!(load(dir.path()), s);
        fs::write(dir.path().join("settings.json"), r#"{"closeOnLaunch":true}"#).unwrap();
        let partial = load(dir.path());
        assert!(partial.close_on_launch);
        assert_eq!(partial.log_retention_days, 30);
    }
}
