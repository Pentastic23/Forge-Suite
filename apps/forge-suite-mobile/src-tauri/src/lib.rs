//! Forge Suite mobile: Forge Core, Balance Forge, Asset Forge, Pixel Forge and AI Forge
//! in one Android app, for testing on a phone.
//!
//! On desktop each app is its own program that Forge Hub starts with a launch
//! key. Android can't start one app's program from another, so here every
//! app's commands are a plugin named after its app id, each app's screen is a
//! page in this one window, and there is no launch key check.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(forge_core_lib::plugin())
        .plugin(balance_forge_lib::plugin())
        .plugin(asset_forge_lib::plugin())
        .plugin(pixel_forge_lib::plugin())
        .plugin(ai_forge_lib::plugin())
        .setup(|app| {
            keep_files_in_app(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Forge Suite");
}

/// The apps find their folders through the home and data folders of a desktop
/// user. A phone app has neither, so point them all inside this app's own
/// storage, with projects in `<app data>/Projects`.
#[cfg(mobile)]
fn keep_files_in_app(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let data = app.path().app_data_dir()?;
    let projects = data.join("Projects");
    std::fs::create_dir_all(&projects)?;
    // Set before any command runs; the apps read these when they need a folder.
    std::env::set_var("HOME", &data);
    std::env::set_var("XDG_DATA_HOME", data.join("local"));
    std::env::set_var("XDG_CONFIG_HOME", data.join("config"));
    std::env::set_var(forge_paths::PROJECTS_ENV, &projects);
    Ok(())
}

/// On desktop (only used while developing this app) the normal folders are used.
#[cfg(not(mobile))]
fn keep_files_in_app(_app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
