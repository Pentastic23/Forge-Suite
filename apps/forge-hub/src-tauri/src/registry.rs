//! Finds installed Forge apps by scanning for `forge-app.json` files.
//! No app is hardcoded: anything with a valid manifest shows up.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const MANIFEST_FILE: &str = "forge-app.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub executable: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub opens: Vec<String>,
    #[serde(default)]
    pub update_source: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AppHealth {
    /// Manifest valid and executable present.
    Ready,
    /// Manifest valid but the executable file is missing.
    MissingExecutable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub manifest: AppManifest,
    pub folder: PathBuf,
    pub executable_path: PathBuf,
    pub icon_path: Option<PathBuf>,
    pub health: AppHealth,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProblem {
    pub path: PathBuf,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub apps: Vec<InstalledApp>,
    pub problems: Vec<ScanProblem>,
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_valid_version(v: &str) -> bool {
    let core = v.split('-').next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// A path from a manifest must stay inside the app's folder.
fn is_inside(rel: &str) -> bool {
    let p = Path::new(rel);
    !rel.is_empty()
        && !rel.contains("..")
        && !p.is_absolute()
        && !rel.starts_with('/')
        && !rel.starts_with('\\')
        && !(rel.len() >= 2 && rel.as_bytes()[1] == b':')
}

/// Same rules as `validateManifest` in packages/formats.
pub fn validate(m: &AppManifest) -> Vec<String> {
    let mut errors = Vec::new();
    if m.name.trim().is_empty() {
        errors.push("\"name\" must be a non-empty string".into());
    }
    if !is_valid_id(&m.id) {
        errors.push("\"id\" must use lowercase letters, digits and dashes".into());
    }
    if !is_valid_version(&m.version) {
        errors.push("\"version\" must look like 1.2.3".into());
    }
    if !is_inside(&m.executable) {
        errors.push("\"executable\" must be a file inside the app folder".into());
    }
    if let Some(icon) = &m.icon {
        if !is_inside(icon) {
            errors.push("\"icon\" must be a file inside the app folder".into());
        }
    }
    if let Some(c) = &m.channel {
        if !["stable", "beta", "experimental"].contains(&c.as_str()) {
            errors.push("\"channel\" must be one of stable, beta, experimental".into());
        }
    }
    errors
}

fn read_manifest(path: &Path) -> Result<AppManifest, Vec<String>> {
    let text = fs::read_to_string(path).map_err(|e| vec![format!("could not read file: {e}")])?;
    let m: AppManifest = serde_json::from_str(&text).map_err(|e| vec![format!("not valid JSON: {e}")])?;
    let errors = validate(&m);
    if errors.is_empty() {
        Ok(m)
    } else {
        Err(errors)
    }
}

/// Scans each folder, and its direct subfolders, for a manifest. When two
/// apps share an id, one whose executable is present beats one without (so a
/// source checkout can't hide the installed app); otherwise the first wins and
/// later duplicates are reported as problems.
pub fn scan(folders: &[PathBuf]) -> ScanResult {
    let mut result = ScanResult::default();
    let mut seen: Vec<PathBuf> = Vec::new();
    for root in folders {
        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(e) => {
                // A folder that exists but can't be read is worth knowing about.
                if root.is_dir() {
                    result.problems.push(ScanProblem { path: root.clone(), errors: vec![format!("could not read folder: {e}")] });
                }
                continue;
            }
        };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        dirs.insert(0, root.clone());
        for folder in dirs {
            let manifest_path = folder.join(MANIFEST_FILE);
            if !manifest_path.is_file() {
                continue;
            }
            let key = fs::canonicalize(&manifest_path).unwrap_or_else(|_| manifest_path.clone());
            if seen.contains(&key) {
                continue;
            }
            seen.push(key);
            match read_manifest(&manifest_path) {
                Ok(manifest) => {
                    let executable_path = folder.join(&manifest.executable);
                    let icon_path = manifest.icon.as_ref().map(|i| folder.join(i)).filter(|p| p.is_file());
                    let health = if executable_path.is_file() { AppHealth::Ready } else { AppHealth::MissingExecutable };
                    let app = InstalledApp { manifest, folder, executable_path, icon_path, health };
                    match result.apps.iter().position(|a| a.manifest.id == app.manifest.id) {
                        None => result.apps.push(app),
                        Some(i) => {
                            let existing = &result.apps[i];
                            if existing.health == AppHealth::MissingExecutable && app.health == AppHealth::Ready {
                                result.apps[i] = app;
                            } else if app.health == AppHealth::MissingExecutable && existing.health == AppHealth::Ready {
                                // A copy without its program (e.g. the source folder); the working one is used.
                            } else {
                                result.problems.push(ScanProblem {
                                    path: manifest_path,
                                    errors: vec![format!("another app already uses the id \"{}\"", app.manifest.id)],
                                });
                            }
                        }
                    }
                }
                Err(errors) => result.problems.push(ScanProblem { path: manifest_path, errors }),
            }
        }
    }
    result.apps.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
    result
}

/// Apps built from a Forge Suite source checkout but never installed: each
/// `apps/<app>/src-tauri/forge-app.json` paired with its program in
/// `target/release`. Only builds whose program exists are returned.
pub fn scan_builds(repo_roots: &[PathBuf]) -> Vec<InstalledApp> {
    let mut out: Vec<InstalledApp> = Vec::new();
    for repo in repo_roots {
        let release = repo.join("target").join("release");
        let Ok(entries) = fs::read_dir(repo.join("apps")) else { continue };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        dirs.sort();
        for app_dir in dirs {
            let src = app_dir.join("src-tauri");
            let Ok(manifest) = read_manifest(&src.join(MANIFEST_FILE)) else { continue };
            let executable_path = release.join(&manifest.executable);
            if !executable_path.is_file() || out.iter().any(|a| a.manifest.id == manifest.id) {
                continue;
            }
            let icon_path = [release.join("icon.png"), src.join("icons").join("icon.png")].into_iter().find(|p| p.is_file());
            out.push(InstalledApp { manifest, folder: release.clone(), executable_path, icon_path, health: AppHealth::Ready });
        }
    }
    out
}

/// Adds apps found by other means where no working copy with the same id is
/// known yet.
pub fn merge_fallback(result: &mut ScanResult, extra: Vec<InstalledApp>) {
    for app in extra {
        match result.apps.iter().position(|a| a.manifest.id == app.manifest.id) {
            None => result.apps.push(app),
            Some(i) if result.apps[i].health != AppHealth::Ready && app.health == AppHealth::Ready => result.apps[i] = app,
            Some(_) => {}
        }
    }
    result.apps.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_app(root: &Path, folder: &str, json: &str, exe: Option<&str>) {
        let dir = root.join(folder);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(MANIFEST_FILE), json).unwrap();
        if let Some(e) = exe {
            fs::write(dir.join(e), b"").unwrap();
        }
    }

    #[test]
    fn finds_valid_apps_and_reports_problems() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_app(root, "core", r#"{"id":"forge-core","name":"Forge Core","version":"0.1.0","executable":"ForgeCore.exe"}"#, Some("ForgeCore.exe"));
        write_app(root, "balance", r#"{"id":"balance-forge","name":"Balance Forge","version":"0.2.0","executable":"BalanceForge.exe"}"#, None);
        write_app(root, "broken", r#"{"id":"Bad Id","name":"x","version":"1","executable":"../x.exe"}"#, None);
        write_app(root, "notjson", "{", None);
        write_app(root, "zdupe", r#"{"id":"forge-core","name":"Copy","version":"0.1.0","executable":"a.exe"}"#, None);
        fs::create_dir_all(root.join("empty")).unwrap();

        let r = scan(&[root.to_path_buf(), root.join("does-not-exist")]);
        let names: Vec<_> = r.apps.iter().map(|a| a.manifest.name.as_str()).collect();
        assert_eq!(names, ["Balance Forge", "Forge Core"]);
        assert_eq!(r.apps[0].health, AppHealth::MissingExecutable);
        assert_eq!(r.apps[1].health, AppHealth::Ready);
        // "zdupe" has no program and a working forge-core exists, so it is skipped quietly.
        assert_eq!(r.problems.len(), 2);
        let broken = r.problems.iter().find(|p| p.path.starts_with(root.join("broken"))).unwrap();
        assert_eq!(broken.errors.len(), 3);
    }

    #[test]
    fn working_copy_beats_one_without_its_program() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let installed = tmp.path().join("installed");
        let json = r#"{"id":"pixel-forge","name":"Pixel Forge","version":"0.1.0","executable":"Pixel Forge.exe"}"#;
        // The source folder holds just a manifest, and is itself the folder listed in Settings.
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join(MANIFEST_FILE), json).unwrap();
        write_app(&installed, "pixel-forge", json, Some("Pixel Forge.exe"));

        let r = scan(&[source.clone(), installed.clone(), installed.clone()]);
        assert_eq!(r.apps.len(), 1);
        assert_eq!(r.apps[0].health, AppHealth::Ready);
        assert!(r.apps[0].folder.starts_with(&installed));
        assert!(r.problems.is_empty(), "{:?}", r.problems);

        // A folder that is itself an app is found too.
        let r = scan(&[installed.join("pixel-forge")]);
        assert_eq!(r.apps.len(), 1);
    }

    #[test]
    fn finds_uninstalled_builds_in_a_source_checkout() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let json = r#"{"id":"forge-core","name":"Forge Core","version":"0.1.0","executable":"Forge Core.exe","icon":"icon.png"}"#;
        fs::create_dir_all(repo.join("apps/forge-core/src-tauri/icons")).unwrap();
        fs::write(repo.join("apps/forge-core/src-tauri").join(MANIFEST_FILE), json).unwrap();
        fs::write(repo.join("apps/forge-core/src-tauri/icons/icon.png"), b"").unwrap();
        // Built but not yet: no app.
        assert!(scan_builds(&[repo.to_path_buf()]).is_empty());
        fs::create_dir_all(repo.join("target/release")).unwrap();
        fs::write(repo.join("target/release/Forge Core.exe"), b"").unwrap();
        let builds = scan_builds(&[repo.to_path_buf()]);
        assert_eq!(builds.len(), 1);
        assert!(builds[0].icon_path.is_some());

        // An installed copy wins over the build; a missing one is replaced by it.
        let mut r = ScanResult::default();
        merge_fallback(&mut r, builds.clone());
        assert_eq!(r.apps.len(), 1);
        r.apps[0].health = AppHealth::MissingExecutable;
        merge_fallback(&mut r, builds);
        assert_eq!(r.apps[0].health, AppHealth::Ready);
    }

    #[test]
    fn path_rules() {
        assert!(is_inside("bin/App.exe"));
        for bad in ["", "../a.exe", "C:\\a.exe", "/a", "\\a"] {
            assert!(!is_inside(bad), "{bad}");
        }
        assert!(is_valid_version("1.2.3-beta.1"));
        assert!(!is_valid_version("1.2"));
        assert!(is_valid_id("pixel-forge2"));
        assert!(!is_valid_id("-x") && !is_valid_id("a--b") && !is_valid_id("A"));
    }
}
