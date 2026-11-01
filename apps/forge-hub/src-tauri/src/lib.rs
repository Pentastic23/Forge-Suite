mod activity;
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
    let result = registry::scan(&s.app_folders);
    for p in &result.problems {
        activity::log(&hub_dir(), Level::Warn, "hub", format!("Skipped {}: {}", p.path.display(), p.errors.join("; ")));
    }
    result
}

#[tauri::command]
fn recent_apps() -> HashMap<String, u64> {
    activity::read_recent(&hub_dir())
}

#[tauri::command]
fn launch_app(app: tauri::AppHandle, id: String, args: Option<Vec<String>>) -> Result<u32, String> {
    let s = settings::load(&hub_dir());
    let scan = registry::scan(&s.app_folders);
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
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_apps,
            recent_apps,
            launch_app,
            read_logs,
            hub_paths,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Forge Hub");
}
