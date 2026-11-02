//! Works out every folder Forge Hub searches for installed apps.
//!
//! The folders in Settings are extras. Forge Hub always also searches the
//! places Forge apps get installed, so a wrong or missing Settings entry can
//! never hide the apps.

use std::path::{Path, PathBuf};

use crate::paths;

/// Product names of the suite's apps, as their installers name their folders.
const SUITE_PRODUCTS: [&str; 4] = ["Forge Core", "Balance Forge", "Asset Forge", "Pixel Forge"];

/// Folders people keep the suite in by hand.
const WELL_KNOWN_ROOTS: [&str; 3] = ["C:\\Forge Hub", "D:\\Forge Hub", "E:\\Forge Hub"];

/// A folder Forge Hub searches, and why.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchFolder {
    pub path: PathBuf,
    /// "setting" for a folder from Settings, otherwise "auto".
    pub source: &'static str,
}

/// The folders searched automatically, whatever Settings holds. Only folders
/// that exist are returned.
pub fn auto_folders() -> Vec<PathBuf> {
    let mut out = vec![paths::default_apps_dir()];

    // Next to Forge Hub itself: E:\Forge Hub\Forge Hub.exe finds E:\Forge Hub\<app>\.
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        out.push(exe_dir.join("apps"));
        out.push(exe_dir.join("Apps"));
        // Installed as <root>\Forge Hub\Forge Hub.exe: the apps are siblings.
        // A drive root such as E:\ is skipped, since that would search the whole drive's top level.
        if let Some(parent) = exe_dir.parent().filter(|p| !is_drive_root(p)) {
            out.push(parent.to_path_buf());
        }
        out.push(exe_dir);
    }

    for root in WELL_KNOWN_ROOTS {
        let root = PathBuf::from(root);
        out.push(root.join("Apps"));
        out.push(root);
    }

    // Where each app's own installer puts it.
    let mut install_roots = Vec::new();
    if let Some(d) = dirs::data_local_dir() {
        install_roots.push(d.join("Programs"));
        install_roots.push(d);
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(d) = std::env::var_os(var) {
            install_roots.push(PathBuf::from(d));
        }
    }
    for root in &install_roots {
        for product in SUITE_PRODUCTS {
            out.push(root.join(product));
        }
    }
    out.extend(registry_install_dirs());

    dedupe(out.into_iter().filter(|p| p.is_dir()).collect())
}

/// Folders from Settings first (they win on ties), then the automatic ones.
pub fn search_folders(from_settings: &[PathBuf]) -> Vec<SearchFolder> {
    let mut out: Vec<SearchFolder> = Vec::new();
    let push = |out: &mut Vec<SearchFolder>, path: PathBuf, source| {
        if !out.iter().any(|f| same_path(&f.path, &path)) {
            out.push(SearchFolder { path, source });
        }
    };
    for p in from_settings {
        push(&mut out, p.clone(), "setting");
    }
    for p in auto_folders() {
        push(&mut out, p, "auto");
    }
    out
}

pub fn paths_of(folders: &[SearchFolder]) -> Vec<PathBuf> {
    folders.iter().map(|f| f.path.clone()).collect()
}

/// `E:\`, `E:` or `/`: a folder with no parent of its own.
fn is_drive_root(p: &Path) -> bool {
    p.parent().is_none() || p.parent().is_some_and(|q| q.as_os_str().is_empty())
}

fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        let s = p.to_string_lossy().replace('/', "\\");
        s.trim_end_matches('\\').to_lowercase()
    };
    if cfg!(windows) {
        norm(a) == norm(b)
    } else {
        a == b
    }
}

fn dedupe(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for p in paths {
        if !out.iter().any(|o| same_path(o, &p)) {
            out.push(p);
        }
    }
    out
}

/// Install folders that Windows lists under "Installed apps" for the suite's
/// apps, wherever the user chose to install them.
#[cfg(windows)]
fn registry_install_dirs() -> Vec<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut out = Vec::new();
    for hive in ["HKCU", "HKLM"] {
        for product in SUITE_PRODUCTS {
            let key = format!("{hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{product}");
            let Ok(output) = std::process::Command::new("reg")
                .args(["query", &key, "/v", "InstallLocation"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            else {
                continue;
            };
            if let Some(p) = parse_reg_value(&String::from_utf8_lossy(&output.stdout)) {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn registry_install_dirs() -> Vec<PathBuf> {
    Vec::new()
}

/// Reads the value out of `reg query` output such as
/// `    InstallLocation    REG_SZ    "C:\Apps\Forge Core"`.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_reg_value(output: &str) -> Option<PathBuf> {
    let line = output.lines().find(|l| l.contains("REG_SZ") || l.contains("REG_EXPAND_SZ"))?;
    let (_, value) = line.split_once("_SZ")?;
    let value = value.trim().trim_matches('"').trim();
    (!value.is_empty()).then(|| PathBuf::from(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_come_first_and_auto_folders_are_always_added() {
        let tmp = tempfile::tempdir().unwrap();
        let mine = tmp.path().join("mine");
        let folders = search_folders(&[mine.clone(), mine.clone()]);
        assert_eq!(folders[0], SearchFolder { path: mine, source: "setting" });
        assert_eq!(folders.iter().filter(|f| f.source == "setting").count(), 1);
        // The default apps folder is searched only once it exists, but never depends on Settings.
        for f in folders.iter().filter(|f| f.source == "auto") {
            assert!(f.path.is_dir());
        }
    }

    #[test]
    fn drive_roots_are_not_searched() {
        assert!(is_drive_root(Path::new("/")));
        assert!(!is_drive_root(Path::new("/home")));
        if cfg!(windows) {
            assert!(is_drive_root(Path::new("E:\\")));
            assert!(!is_drive_root(Path::new("E:\\Forge Hub")));
        }
    }

    #[test]
    fn reads_reg_query_output() {
        let out = "\r\nHKEY_CURRENT_USER\\Software\\...\\Forge Core\r\n    InstallLocation    REG_SZ    \"E:\\Forge Hub\\Forge Core\"\r\n\r\n";
        assert_eq!(parse_reg_value(out), Some(PathBuf::from("E:\\Forge Hub\\Forge Core")));
        assert_eq!(parse_reg_value("ERROR: not found"), None);
    }
}
