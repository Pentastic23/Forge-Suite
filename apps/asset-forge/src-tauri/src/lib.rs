mod checks;
mod example;
mod export;
mod kinds;
mod projects;
mod rename;
mod requirements;
mod scan;
mod store;
mod usage;

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use checks::{CheckSettings, Report};
use export::{ExportReport, ExportSpec};
use projects::ProjectFile;
use rename::RenameSpec;
use requirements::{Readiness, Requirement};
use store::{Asset, AssetPatch, AssetQuery, Event, Facets, Folder, Page, Project, ProjectInfo, ScanReport};
use usage::UsageReport;

pub const APP_ID: &str = "asset-forge";

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

fn allowed(state: &AppState) -> CmdResult<()> {
    match &state.launch_error {
        Some(e) => Err(e.clone()),
        None => Ok(()),
    }
}

fn with_project<T>(state: &tauri::State<AppState>, f: impl FnOnce(&mut Project) -> CmdResult<T>) -> CmdResult<T> {
    allowed(state)?;
    let mut guard = state.open.lock().map_err(|_| "Project is busy, try again".to_string())?;
    let open = guard.as_mut().ok_or("No project is open")?;
    f(&mut open.project)
}

fn project_path(state: &tauri::State<AppState>) -> CmdResult<PathBuf> {
    allowed(state)?;
    let guard = state.open.lock().map_err(|_| "Project is busy, try again".to_string())?;
    Ok(guard.as_ref().ok_or("No project is open")?.path.clone())
}

/// Long jobs (scans, exports) get their own connection on a worker thread, so
/// the window and other commands keep working meanwhile.
async fn background<T: Send + 'static>(path: PathBuf, f: impl FnOnce(&mut Project) -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut p = Project::open(&path)?;
        f(&mut p)
    })
    .await
    .map_err(|e| format!("The job stopped unexpectedly: {e}"))?
}

/// Lets the window show previews of files inside the library's folders.
fn allow_previews(app: &AppHandle, folders: &[Folder]) {
    let scope = app.asset_protocol_scope();
    for f in folders {
        let _ = scope.allow_directory(&f.path, true);
    }
}

fn set_open(app: &AppHandle, state: &tauri::State<AppState>, path: PathBuf, project: Project) -> CmdResult<CurrentProject> {
    allowed(state)?;
    let info = project.info()?;
    allow_previews(app, &project.folders()?);
    projects::remember(&path);
    *state.open.lock().map_err(|_| "Project is busy, try again".to_string())? = Some(Open { path: path.clone(), project });
    Ok(CurrentProject { path, info })
}

// ---------------------------------------------------------------- projects

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
fn project_create(app: AppHandle, state: tauri::State<AppState>, name: String) -> CmdResult<CurrentProject> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the project a name".into());
    }
    let path = projects::new_project_path(name).map_err(|e| e.to_string())?;
    let project = Project::create(&path, name)?;
    set_open(&app, &state, path, project)
}

/// Opens the Emberfall example project, making it (and its asset folder) the first time.
#[tauri::command]
fn project_example(app: AppHandle, state: tauri::State<AppState>) -> CmdResult<CurrentProject> {
    allowed(&state)?;
    let (path, project) = example::open_or_build()?;
    set_open(&app, &state, path, project)
}

#[tauri::command]
fn project_open(app: AppHandle, state: tauri::State<AppState>, path: PathBuf) -> CmdResult<CurrentProject> {
    let project = Project::open(&path)?;
    set_open(&app, &state, path, project)
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
fn setting_get(state: tauri::State<AppState>, key: String) -> CmdResult<Option<serde_json::Value>> {
    with_project(&state, |p| p.setting(&key))
}

#[tauri::command]
fn setting_set(state: tauri::State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_project(&state, |p| p.set_setting(&key, &value))
}

#[tauri::command]
fn activity(state: tauri::State<AppState>, limit: i64) -> CmdResult<Vec<(Option<String>, Event)>> {
    with_project(&state, |p| p.activity(limit.clamp(1, 1000)))
}

// ---------------------------------------------------------------- folders and scanning

#[tauri::command]
fn folders_list(state: tauri::State<AppState>) -> CmdResult<Vec<Folder>> {
    with_project(&state, |p| p.folders())
}

#[tauri::command]
fn folder_add(app: AppHandle, state: tauri::State<AppState>, path: PathBuf) -> CmdResult<Folder> {
    let f = with_project(&state, |p| p.add_folder(&path))?;
    allow_previews(&app, std::slice::from_ref(&f));
    Ok(f)
}

#[tauri::command]
fn folder_remove(state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    with_project(&state, |p| p.remove_folder(&id))
}

#[derive(Clone, Serialize)]
struct Progress {
    done: usize,
    total: usize,
}

#[tauri::command]
async fn library_scan(app: AppHandle, state: tauri::State<'_, AppState>) -> CmdResult<ScanReport> {
    let path = project_path(&state)?;
    background(path, move |p| {
        p.scan_all(&|done, total| {
            let _ = app.emit("scan-progress", Progress { done, total });
        })
    })
    .await
}

// ---------------------------------------------------------------- assets

#[tauri::command]
fn assets_list(state: tauri::State<AppState>, query: AssetQuery) -> CmdResult<Page> {
    with_project(&state, |p| p.list(&query))
}

#[tauri::command]
fn assets_facets(state: tauri::State<AppState>) -> CmdResult<Facets> {
    with_project(&state, |p| p.facets())
}

#[tauri::command]
fn asset_get(state: tauri::State<AppState>, id: String) -> CmdResult<Asset> {
    with_project(&state, |p| p.get(&id))
}

#[tauri::command]
fn assets_update(state: tauri::State<AppState>, ids: Vec<String>, patch: AssetPatch) -> CmdResult<usize> {
    with_project(&state, |p| p.update(&ids, &patch))
}

/// Removes missing files from the library. Files on disk are never deleted.
#[tauri::command]
fn assets_forget(state: tauri::State<AppState>, ids: Vec<String>) -> CmdResult<usize> {
    with_project(&state, |p| p.forget(&ids))
}

#[tauri::command]
fn categories() -> (Vec<&'static str>, Vec<&'static str>) {
    (kinds::CATEGORIES.to_vec(), store::STATUSES.to_vec())
}

// ---------------------------------------------------------------- checks

#[tauri::command]
async fn checks_run(state: tauri::State<'_, AppState>) -> CmdResult<Report> {
    let path = project_path(&state)?;
    background(path, |p| {
        let cfg: CheckSettings = p.setting("checks")?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        Ok(checks::run(&p.all()?, &cfg))
    })
    .await
}

#[tauri::command]
async fn usage_scan(state: tauri::State<'_, AppState>, dir: PathBuf) -> CmdResult<UsageReport> {
    let path = project_path(&state)?;
    background(path, move |p| {
        let (counts, report) = usage::scan(&dir, &p.all()?)?;
        p.set_refs(&counts.into_iter().collect())?;
        p.set_setting("usageDir", &serde_json::json!(dir))?;
        p.log(None, "Usage scan", &format!("{} files read in {}: {} assets used, {} not", report.files_read, dir.display(), report.used, report.unused))?;
        Ok(report)
    })
    .await
}

// ---------------------------------------------------------------- production

fn templates(p: &Project) -> CmdResult<BTreeMap<String, Vec<String>>> {
    Ok(p.setting("slotTemplates")?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_else(requirements::default_templates))
}

#[tauri::command]
fn readiness(state: tauri::State<AppState>) -> CmdResult<Readiness> {
    with_project(&state, |p| requirements::readiness(p))
}

#[tauri::command]
fn requirement_save(state: tauri::State<AppState>, requirement: Requirement) -> CmdResult<Requirement> {
    with_project(&state, |p| requirements::save(p, requirement))
}

#[tauri::command]
fn requirement_delete(state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    with_project(&state, |p| requirements::delete(p, &id))
}

#[tauri::command]
fn requirement_link(state: tauri::State<AppState>, id: String, slot: String, asset_id: Option<String>) -> CmdResult<Requirement> {
    with_project(&state, |p| requirements::link(p, &id, &slot, asset_id))
}

#[tauri::command]
fn slot_templates(state: tauri::State<AppState>) -> CmdResult<BTreeMap<String, Vec<String>>> {
    with_project(&state, |p| templates(p))
}

#[tauri::command]
fn codex_import(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<(usize, usize)> {
    with_project(&state, |p| {
        let t = templates(p)?;
        requirements::import_codex(p, &path, &t)
    })
}

// ---------------------------------------------------------------- rename

#[tauri::command]
fn rename_plan(state: tauri::State<AppState>, ids: Vec<String>, spec: RenameSpec) -> CmdResult<Vec<rename::Planned>> {
    with_project(&state, |p| {
        let assets = ordered(p, &ids)?;
        Ok(rename::plan(&assets, &spec))
    })
}

/// Assets in the order the ids were given (the order shown on screen), so {n} counts as expected.
fn ordered(p: &Project, ids: &[String]) -> CmdResult<Vec<store::AssetSummary>> {
    let mut by_id: std::collections::HashMap<String, store::AssetSummary> = p.summaries(ids)?.into_iter().map(|a| (a.id.clone(), a)).collect();
    Ok(ids.iter().filter_map(|i| by_id.remove(i)).collect())
}

#[tauri::command]
fn rename_apply(state: tauri::State<AppState>, ids: Vec<String>, spec: RenameSpec) -> CmdResult<usize> {
    with_project(&state, |p| {
        let assets = ordered(p, &ids)?;
        let planned = rename::plan(&assets, &spec);
        let done = rename::apply(p, &assets, &planned)?;
        p.set_setting("lastRename", &serde_json::to_value(&done).unwrap())?;
        Ok(done.len())
    })
}

#[tauri::command]
fn rename_undo(state: tauri::State<AppState>) -> CmdResult<usize> {
    with_project(&state, |p| {
        let batch: Vec<rename::Done> = p.setting("lastRename")?.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        if batch.is_empty() {
            return Err("There is no rename to undo".into());
        }
        let n = rename::undo(p, &batch)?;
        p.set_setting("lastRename", &serde_json::json!([]))?;
        Ok(n)
    })
}

// ---------------------------------------------------------------- export

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPreview {
    total: usize,
    files: Vec<export::Planned>,
}

#[tauri::command]
fn export_preview(state: tauri::State<AppState>, spec: ExportSpec) -> CmdResult<ExportPreview> {
    with_project(&state, |p| {
        let all = p.all()?;
        let picked = export::select(&all, &spec);
        let names = p.folders()?.into_iter().map(|f| (f.id, Path::new(&f.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default())).collect();
        let planned = export::plan(&picked, &spec, &names);
        Ok(ExportPreview { total: planned.len(), files: planned.into_iter().take(200).collect() })
    })
}

#[tauri::command]
async fn export_run(state: tauri::State<'_, AppState>, spec: ExportSpec) -> CmdResult<ExportReport> {
    let path = project_path(&state)?;
    background(path, move |p| export::run(p, &spec)).await
}

#[tauri::command]
fn export_exchange(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<usize> {
    with_project(&state, |p| export::exchange(p, &path))
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
            setting_get,
            setting_set,
            activity,
            folders_list,
            folder_add,
            folder_remove,
            library_scan,
            assets_list,
            assets_facets,
            asset_get,
            assets_update,
            assets_forget,
            categories,
            checks_run,
            usage_scan,
            readiness,
            requirement_save,
            requirement_delete,
            requirement_link,
            slot_templates,
            codex_import,
            rename_plan,
            rename_apply,
            rename_undo,
            export_preview,
            export_run,
            export_exchange
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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { open: Mutex::new(None), launch_error })
        .invoke_handler(commands!())
        .run(tauri::generate_context!())
        .expect("error while running Asset Forge");
}
