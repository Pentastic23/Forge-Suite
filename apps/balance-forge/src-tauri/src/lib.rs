mod example;
mod exchange;
mod patch;
mod projects;
mod sheet;
mod sim;
mod store;

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use exchange::ImportSummary;
use patch::Diff;
use projects::ProjectFile;
use sheet::{Computed, Sheet};
use sim::{CombatRules, DuelResult, EconomyConfig, EconomyResult, Fighter, RoundRobinResult};
use store::{Project, ProjectInfo, SheetInfo, SnapshotInfo};

pub const APP_ID: &str = "balance-forge";

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

fn with_project<T>(state: &tauri::State<AppState>, f: impl FnOnce(&Project) -> CmdResult<T>) -> CmdResult<T> {
    allowed(state)?;
    let guard = state.open.lock().map_err(|_| "Project is busy, try again".to_string())?;
    let open = guard.as_ref().ok_or("No project is open")?;
    f(&open.project)
}

fn set_open(state: &tauri::State<AppState>, path: PathBuf, project: Project) -> CmdResult<CurrentProject> {
    allowed(state)?;
    let info = project.info()?;
    projects::remember(&path);
    *state.open.lock().map_err(|_| "Project is busy, try again".to_string())? = Some(Open { path: path.clone(), project });
    Ok(CurrentProject { path, info })
}

fn seed_or_random(seed: Option<u64>) -> u64 {
    // Kept under 2^53 so the app can show it and pass it back exactly.
    seed.unwrap_or_else(|| rand::random::<u64>() >> 11)
}

/// Runs heavy work off the main thread so the window stays responsive.
async fn background<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("The simulation stopped unexpectedly: {e}"))?
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
fn project_create(state: tauri::State<AppState>, name: String) -> CmdResult<CurrentProject> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the project a name".into());
    }
    let path = projects::new_project_path(name).map_err(|e| e.to_string())?;
    let project = Project::create(&path, name)?;
    set_open(&state, path, project)
}

/// Opens the Emberfall example project, making it the first time.
#[tauri::command]
fn project_example(state: tauri::State<AppState>) -> CmdResult<CurrentProject> {
    allowed(&state)?;
    let (path, project) = example::open_or_build()?;
    set_open(&state, path, project)
}

#[tauri::command]
fn project_open(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<CurrentProject> {
    let project = Project::open(&path)?;
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

// ---------------------------------------------------------------- sheets

#[tauri::command]
fn sheet_list(state: tauri::State<AppState>) -> CmdResult<Vec<SheetInfo>> {
    with_project(&state, |p| p.sheets())
}

#[tauri::command]
fn sheet_get(state: tauri::State<AppState>, id: String) -> CmdResult<Sheet> {
    with_project(&state, |p| p.sheet(&id))
}

#[tauri::command]
fn sheet_save(state: tauri::State<AppState>, sheet: Sheet) -> CmdResult<Sheet> {
    with_project(&state, |p| p.save_sheet(sheet))
}

#[tauri::command]
fn sheet_delete(state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    with_project(&state, |p| p.delete_sheet(&id))
}

/// Works out formulas for a sheet as it is in the editor, saved or not.
#[tauri::command]
fn sheet_compute(state: tauri::State<AppState>, sheet: Sheet) -> CmdResult<Computed> {
    allowed(&state)?;
    sheet.validate()?;
    Ok(sheet.compute())
}

/// Checks one formula on its own, for the column editor.
#[tauri::command]
fn formula_check(formula: String) -> CmdResult<Vec<String>> {
    forge_formula::parse(&formula).map(|e| e.references().into_iter().collect()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- import / export

#[tauri::command]
fn codex_kinds(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<BTreeMap<String, usize>> {
    allowed(&state)?;
    exchange::codex_kinds(&path)
}

/// Imports one Forge Core module into a new sheet, or refreshes `sheet_id`.
#[tauri::command]
fn codex_import(state: tauri::State<AppState>, path: PathBuf, kind: String, sheet_id: Option<String>) -> CmdResult<ImportSummary> {
    with_project(&state, |p| {
        let existing = match &sheet_id {
            Some(id) => Some(p.sheet(id)?),
            None => None,
        };
        let mut summary = exchange::import_codex(&path, &kind, existing)?;
        summary.sheet = p.save_sheet(summary.sheet)?;
        Ok(summary)
    })
}

#[tauri::command]
fn export_balance(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<usize> {
    with_project(&state, |p| exchange::export_balance(p, &path))
}

#[tauri::command]
fn export_csv(state: tauri::State<AppState>, sheet_id: String, path: PathBuf) -> CmdResult<usize> {
    with_project(&state, |p| exchange::export_csv(&p.sheet(&sheet_id)?, &path))
}

// ---------------------------------------------------------------- patches

#[tauri::command]
fn snapshot_create(state: tauri::State<AppState>, sheet_id: String, name: String) -> CmdResult<SnapshotInfo> {
    with_project(&state, |p| p.snapshot(&sheet_id, &name))
}

#[tauri::command]
fn snapshot_list(state: tauri::State<AppState>, sheet_id: String) -> CmdResult<Vec<SnapshotInfo>> {
    with_project(&state, |p| p.snapshots(&sheet_id))
}

#[tauri::command]
fn snapshot_delete(state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    with_project(&state, |p| p.delete_snapshot(&id))
}

/// Compares snapshot `before` with snapshot `after`, or with the sheet as
/// saved now when `after` is left out.
#[tauri::command]
fn patch_diff(state: tauri::State<AppState>, sheet_id: String, before: String, after: Option<String>, title: String) -> CmdResult<Diff> {
    with_project(&state, |p| {
        let old = p.snapshot_sheet(&before)?;
        let new = match &after {
            Some(id) => p.snapshot_sheet(id)?,
            None => p.sheet(&sheet_id)?,
        };
        Ok(patch::diff(&old, &new, &title))
    })
}

/// Saves patch notes as a Markdown or text file the person picked.
#[tauri::command]
fn notes_save(state: tauri::State<AppState>, path: PathBuf, text: String) -> CmdResult<()> {
    allowed(&state)?;
    match path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).as_deref() {
        Some("md") | Some("txt") => std::fs::write(&path, text).map_err(|e| format!("Could not save the notes: {e}")),
        _ => Err("Patch notes can be saved as .md or .txt".into()),
    }
}

#[tauri::command]
fn setting_get(state: tauri::State<AppState>, key: String) -> CmdResult<Option<serde_json::Value>> {
    with_project(&state, |p| p.setting(&key))
}

#[tauri::command]
fn setting_set(state: tauri::State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_project(&state, |p| p.set_setting(&key, &value))
}

// ---------------------------------------------------------------- simulations

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Seeded<T> {
    seed: u64,
    result: T,
}

#[tauri::command]
async fn sim_duel(state: tauri::State<'_, AppState>, a: Fighter, b: Fighter, rules: CombatRules, runs: u32, seed: Option<u64>) -> CmdResult<Seeded<DuelResult>> {
    allowed(&state)?;
    let seed = seed_or_random(seed);
    background(move || sim::duel(&a, &b, &rules, runs, seed).map(|result| Seeded { seed, result })).await
}

#[tauri::command]
async fn sim_round_robin(state: tauri::State<'_, AppState>, fighters: Vec<Fighter>, rules: CombatRules, runs: u32, seed: Option<u64>) -> CmdResult<Seeded<RoundRobinResult>> {
    allowed(&state)?;
    let seed = seed_or_random(seed);
    background(move || sim::round_robin(&fighters, &rules, runs, seed).map(|result| Seeded { seed, result })).await
}

#[tauri::command]
async fn sim_economy(state: tauri::State<'_, AppState>, config: EconomyConfig, seed: Option<u64>) -> CmdResult<Seeded<EconomyResult>> {
    allowed(&state)?;
    let seed = seed_or_random(seed);
    background(move || sim::economy(&config, seed).map(|result| Seeded { seed, result })).await
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
            sheet_list,
            sheet_get,
            sheet_save,
            sheet_delete,
            sheet_compute,
            formula_check,
            codex_kinds,
            codex_import,
            export_balance,
            export_csv,
            snapshot_create,
            snapshot_list,
            snapshot_delete,
            patch_diff,
            notes_save,
            setting_get,
            setting_set,
            sim_duel,
            sim_round_robin,
            sim_economy
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
        .expect("error while running Balance Forge");
}
