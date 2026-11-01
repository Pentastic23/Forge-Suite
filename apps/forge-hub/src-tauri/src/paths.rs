use std::path::PathBuf;

/// `%LOCALAPPDATA%\ForgeSuite` on Windows.
pub fn suite_root() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ForgeSuite")
}

/// Where Forge Hub keeps its own files (settings, recent apps, logs).
pub fn hub_data_dir() -> PathBuf {
    suite_root().join("hub")
}

/// Default folder apps are installed into, one subfolder per app.
pub fn default_apps_dir() -> PathBuf {
    suite_root().join("apps")
}
