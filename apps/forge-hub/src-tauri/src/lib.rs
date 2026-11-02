mod activity;
mod discover;
mod launcher;
mod paths;
mod registry;
mod settings;

use std::collections::HashMap;
use std::path::PathBuf;

use activity::{Level, LogEntry};
use registry::ScanResult;
use settings::Settings;
use tauri::Manager;

fn hub_dir() -> PathBuf {
    paths::hub_data_dir()
}

#[tauri::command]
fn get_settings() -> Settings {
    settings::load(&hub_dir())
}

#[tauri::command]
fn save_settings(settings: Settings) -> Result<(), String> {
    settings::save(&hub_dir(), &settings).map_err(|e| e.to_string())?;
    activity::log(&hub_dir(), Level::Info, "hub", "Settings saved");
    Ok(())
}

#[tauri::command]
fn list_apps() -> ScanResult {
    let s = settings::load(&hub_dir());
    let result = discover::find_apps(&s.app_folders);
    for p in &result.problems {
        activity::log(&hub_dir(), Level::Warn, "hub", format!("Skipped {}: {}", p.path.display(), p.errors.join("; ")));
    }
    result
}

/// Every folder searched for apps: the ones from Settings, then the automatic ones.
#[tauri::command]
fn app_search_folders() -> Vec<discover::SearchFolder> {
    discover::search_folders(&settings::load(&hub_dir()).app_folders)
}

#[tauri::command]
fn recent_apps() -> HashMap<String, u64> {
    activity::read_recent(&hub_dir())
}

#[tauri::command]
fn launch_app(app: tauri::AppHandle, id: String, args: Option<Vec<String>>) -> Result<u32, String> {
    let s = settings::load(&hub_dir());
    let scan = discover::find_apps(&s.app_folders);
    let found = scan.apps.iter().find(|a| a.manifest.id == id).ok_or_else(|| format!("No installed app with id \"{id}\""))?;
    let pid = launcher::launch(found, &hub_dir(), &forge_launch_guard::default_launch_dir(), &args.unwrap_or_default())?;
    if s.close_on_launch {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.minimize();
        }
    }
    Ok(pid)
}

#[tauri::command]
fn read_logs(limit: Option<usize>) -> Vec<LogEntry> {
    activity::read(&hub_dir(), limit.unwrap_or(500))
}

#[tauri::command]
fn hub_paths() -> HashMap<&'static str, PathBuf> {
    HashMap::from([
        ("data", hub_dir()),
        ("defaultApps", paths::default_apps_dir()),
        ("launchKeys", forge_launch_guard::default_launch_dir()),
    ])
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectsFolder {
    path: PathBuf,
    /// "env" (FORGE_PROJECTS_DIR), "setting" or "default".
    source: &'static str,
    default_path: PathBuf,
    in_onedrive: bool,
    /// Project files in the default folder, when another folder is in use.
    left_in_default: usize,
}

fn count_projects(dir: &std::path::Path) -> usize {
    const EXTS: [&str; 4] = ["forgecore", "balanceforge", "assetforge", "pixelforge"];
    std::fs::read_dir(dir)
        .map(|it| it.flatten().filter(|e| e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| EXTS.contains(&x.to_lowercase().as_str()))).count())
        .unwrap_or(0)
}

/// The folder every Forge app keeps project files in.
#[tauri::command]
fn projects_folder() -> ProjectsFolder {
    let (path, source) = forge_paths::projects_dir_with_source();
    let default_path = forge_paths::default_projects_dir();
    let left_in_default = if path != default_path { count_projects(&default_path) } else { 0 };
    ProjectsFolder {
        in_onedrive: forge_paths::in_onedrive(&path),
        path,
        source: match source {
            forge_paths::Source::Env => "env",
            forge_paths::Source::Setting => "setting",
            forge_paths::Source::Default => "default",
        },
        default_path,
        left_in_default,
    }
}

/// Changes the projects folder for every app; `None` goes back to the default.
#[tauri::command]
fn set_projects_folder(path: Option<PathBuf>) -> Result<ProjectsFolder, String> {
    forge_paths::set_projects_dir(path.as_deref()).map_err(|e| e.to_string())?;
    let msg = match &path {
        Some(p) => format!("Projects folder set to {}", p.display()),
        None => "Projects folder set back to the default".to_string(),
    };
    activity::log(&hub_dir(), Level::Info, "hub", msg);
    Ok(projects_folder())
}

/// Opens a folder in the system file manager.
#[tauri::command]
fn open_folder(path: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let program = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program).arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = hub_dir();
    let s = settings::load(&dir);
    let removed = activity::prune(&dir, s.log_retention_days);
    activity::log(&dir, Level::Info, "hub", format!("Forge Hub {} started", env!("CARGO_PKG_VERSION")));
    if removed > 0 {
        activity::log(&dir, Level::Info, "hub", format!("Removed {removed} old log entries"));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_apps,
            recent_apps,
            launch_app,
            read_logs,
            hub_paths,
            open_folder,
            app_search_folders,
            projects_folder,
            set_projects_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Forge Hub");
}
