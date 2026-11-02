mod db;
mod example;
mod export;
mod projects;

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use db::{Backlink, Entity, EntitySummary, ListQuery, Project, ProjectInfo, VersionInfo};
use projects::ProjectFile;

pub const APP_ID: &str = "forge-core";

struct Open {
    path: PathBuf,
    project: Project,
}

struct AppState {
    open: Mutex<Option<Open>>,
    /// Why the app may not run (not opened from Forge Hub), checked once at startup.
    launch_error: Option<String>,
}

type CmdResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentProject {
    path: PathBuf,
    info: ProjectInfo,
}

fn with_project<T>(state: &tauri::State<AppState>, f: impl FnOnce(&mut Project) -> Result<T, db::DbError>) -> CmdResult<T> {
    if let Some(e) = &state.launch_error {
        return Err(e.clone());
    }
    let mut guard = state.open.lock().map_err(|_| "Project is busy, try again".to_string())?;
    let open = guard.as_mut().ok_or("No project is open")?;
    f(&mut open.project).map_err(|e| e.to_string())
}

fn set_open(state: &tauri::State<AppState>, path: PathBuf, project: Project) -> CmdResult<CurrentProject> {
    if let Some(e) = &state.launch_error {
        return Err(e.clone());
    }
    let info = project.info().map_err(|e| e.to_string())?;
    projects::remember(&path);
    *state.open.lock().map_err(|_| "Project is busy, try again".to_string())? = Some(Open { path: path.clone(), project });
    Ok(CurrentProject { path, info })
}

#[tauri::command]
fn launch_status(state: tauri::State<AppState>) -> Option<String> {
    state.launch_error.clone()
}

#[tauri::command]
fn projects_list() -> Vec<ProjectFile> {
    projects::list()
}

#[tauri::command]
fn projects_folder() -> PathBuf {
    projects::projects_dir()
}

#[tauri::command]
fn project_create(state: tauri::State<AppState>, name: String) -> CmdResult<CurrentProject> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the project a name".into());
    }
    let path = projects::new_project_path(name).map_err(|e| e.to_string())?;
    let project = Project::create(&path, name).map_err(|e| e.to_string())?;
    set_open(&state, path, project)
}

/// Opens the Emberfall example project, making it the first time.
#[tauri::command]
fn project_example(state: tauri::State<AppState>) -> CmdResult<CurrentProject> {
    if let Some(e) = &state.launch_error {
        return Err(e.clone());
    }
    let (path, project) = example::open_or_build()?;
    set_open(&state, path, project)
}

#[tauri::command]
fn project_open(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<CurrentProject> {
    let project = Project::open(&path).map_err(|e| e.to_string())?;
    set_open(&state, path, project)
}

#[tauri::command]
fn project_close(state: tauri::State<AppState>) {
    if let Ok(mut g) = state.open.lock() {
        *g = None;
    }
}

#[tauri::command]
fn project_current(state: tauri::State<AppState>) -> Option<CurrentProject> {
    let g = state.open.lock().ok()?;
    let open = g.as_ref()?;
    Some(CurrentProject { path: open.path.clone(), info: open.project.info().ok()? })
}

#[tauri::command]
fn project_rename(state: tauri::State<AppState>, name: String) -> CmdResult<ProjectInfo> {
    if name.trim().is_empty() {
        return Err("Give the project a name".into());
    }
    with_project(&state, |p| p.rename(&name))
}

#[tauri::command]
fn entity_list(state: tauri::State<AppState>, query: ListQuery) -> CmdResult<Vec<EntitySummary>> {
    with_project(&state, |p| p.list(&query))
}

#[tauri::command]
fn entity_get(state: tauri::State<AppState>, id: String) -> CmdResult<Entity> {
    with_project(&state, |p| p.get(&id))
}

/// Names for a set of ids, to label link chips. Unknown ids are left out.
#[tauri::command]
fn entity_names(state: tauri::State<AppState>, ids: Vec<String>) -> CmdResult<HashMap<String, (String, String)>> {
    with_project(&state, |p| {
        let mut out = HashMap::new();
        for id in ids {
            if let Ok(e) = p.get(&id) {
                out.insert(id, (e.name, e.kind));
            }
        }
        Ok(out)
    })
}

#[tauri::command]
fn entity_save(state: tauri::State<AppState>, entity: Entity) -> CmdResult<Entity> {
    with_project(&state, |p| p.save(entity))
}

#[tauri::command]
fn entity_delete(state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    with_project(&state, |p| p.delete(&id))
}

#[tauri::command]
fn entity_backlinks(state: tauri::State<AppState>, id: String) -> CmdResult<Vec<Backlink>> {
    with_project(&state, |p| p.backlinks(&id))
}

#[tauri::command]
fn entity_versions(state: tauri::State<AppState>, id: String) -> CmdResult<Vec<VersionInfo>> {
    with_project(&state, |p| p.versions(&id))
}

#[tauri::command]
fn entity_version(state: tauri::State<AppState>, id: String, version: i64) -> CmdResult<Entity> {
    with_project(&state, |p| p.version(&id, version))
}

#[tauri::command]
fn entity_restore(state: tauri::State<AppState>, id: String, version: i64) -> CmdResult<Entity> {
    with_project(&state, |p| p.restore(&id, version))
}

#[tauri::command]
fn project_tags(state: tauri::State<AppState>) -> CmdResult<Vec<(String, i64)>> {
    with_project(&state, |p| p.tags())
}

#[tauri::command]
fn project_counts(state: tauri::State<AppState>) -> CmdResult<HashMap<String, i64>> {
    with_project(&state, |p| p.counts().map(|v| v.into_iter().collect()))
}

/// format: "json" | "csv" | "markdown" | "codex". Empty `kinds` exports everything.
#[tauri::command]
fn project_export(state: tauri::State<AppState>, format: String, kinds: Vec<String>, path: PathBuf) -> CmdResult<usize> {
    if let Some(e) = &state.launch_error {
        return Err(e.clone());
    }
    let g = state.open.lock().map_err(|_| "Project is busy, try again".to_string())?;
    let p = &g.as_ref().ok_or("No project is open")?.project;
    match format.as_str() {
        "json" => export::to_json(p, &kinds, &path),
        "csv" => export::to_csv(p, &kinds, &path),
        "markdown" => export::to_markdown(p, &kinds, &path),
        "codex" => export::to_codex(p, &kinds, &path),
        other => Err(format!("Unknown export format \"{other}\"")),
    }
}

/// Adds entries from a .forgecodex or JSON export. Returns [added, updated].
#[tauri::command]
fn project_import(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<(usize, usize)> {
    let entities = export::read_entities(&path)?;
    with_project(&state, |p| p.import(entities))
}

/// Every command the window can call, listed once for [`run`] and [`plugin`].
/// Forge Suite mobile's build script reads this list, so keep one name per line.
macro_rules! commands {
    () => {
        tauri::generate_handler![
            launch_status,
            projects_list,
            projects_folder,
            project_create,
            project_open,
            project_example,
            project_close,
            project_current,
            project_rename,
            entity_list,
            entity_get,
            entity_names,
            entity_save,
            entity_delete,
            entity_backlinks,
            entity_versions,
            entity_version,
            entity_restore,
            project_tags,
            project_counts,
            project_export,
            project_import
        ]
    };
}

/// This app's commands as a plugin named after the app id, so Forge Suite mobile
/// can hold every Forge app in one Android app (`plugin:<app id>|<command>`).
/// There is no Forge Hub on the phone to hand out launch keys, so the launch
/// check is left out here; the desktop app still requires it.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new(APP_ID)
        .setup(|app, _api| {
            tauri::Manager::manage(app, AppState { open: Mutex::new(None), launch_error: None });
            Ok(())
        })
        .invoke_handler(commands!())
        .build()
}

/// The desktop app. Android and iOS use [`plugin`] inside Forge Suite mobile instead.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn run() {
    let launch_error = forge_launch_guard::verify_from_env(APP_ID).err().map(|e| e.to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { open: Mutex::new(None), launch_error })
        .invoke_handler(commands!())
        .run(tauri::generate_context!())
        .expect("error while running Forge Core");
}
