mod ai;
mod comfy;
mod export;
mod projects;
mod store;

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use export::OutFile;
use projects::ProjectFile;
use store::{Event, LibraryPatch, Profile, Project, ProjectInfo};

pub const APP_ID: &str = "pixel-forge";

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

/// A sketch on its way to the window: the PNG travels as base64.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SketchOut {
    id: i64,
    name: String,
    png: String,
    doc: serde_json::Value,
    /// The AI-colored version, base64 PNG, when one was made.
    ai_png: Option<String>,
    folder: String,
    tags: Vec<String>,
    favorite: bool,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SketchIn {
    name: String,
    #[serde(default)]
    folder: String,
    /// base64 PNG
    png: String,
    #[serde(default)]
    doc: serde_json::Value,
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
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

fn set_open(state: &tauri::State<AppState>, path: PathBuf, project: Project) -> CmdResult<CurrentProject> {
    allowed(state)?;
    let info = project.info()?;
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
fn project_create(state: tauri::State<AppState>, name: String) -> CmdResult<CurrentProject> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Give the project a name".into());
    }
    let path = projects::new_project_path(name).map_err(|e| e.to_string())?;
    let project = Project::create(&path, name)?;
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

#[tauri::command]
fn setting_get(state: tauri::State<AppState>, key: String) -> CmdResult<Option<serde_json::Value>> {
    with_project(&state, |p| p.setting(&key))
}

#[tauri::command]
fn setting_set(state: tauri::State<AppState>, key: String, value: serde_json::Value) -> CmdResult<()> {
    with_project(&state, |p| p.set_setting(&key, &value))
}

#[tauri::command]
fn activity(state: tauri::State<AppState>, limit: i64) -> CmdResult<Vec<Event>> {
    with_project(&state, |p| p.activity(limit.clamp(1, 1000)))
}

// ---------------------------------------------------------------- sketches and library

#[tauri::command]
fn sketches_list(state: tauri::State<AppState>) -> CmdResult<Vec<SketchOut>> {
    with_project(&state, |p| {
        let list = p.sketches()?;
        let mut out = Vec::with_capacity(list.len());
        for s in list {
            let ai_png = p.ai_image(s.id)?.map(|b| b64().encode(b));
            out.push(SketchOut {
                id: s.id,
                name: s.name,
                png: b64().encode(&s.png),
                doc: s.doc,
                ai_png,
                folder: s.folder,
                tags: s.tags,
                favorite: s.favorite,
                created_at: s.created_at,
                updated_at: s.updated_at,
            });
        }
        Ok(out)
    })
}

#[tauri::command]
fn sketch_add(state: tauri::State<AppState>, sketch: SketchIn) -> CmdResult<i64> {
    let png = b64().decode(&sketch.png).map_err(|_| "The image could not be read".to_string())?;
    with_project(&state, |p| p.add_sketch(sketch.name.trim(), &sketch.folder, &png, &sketch.doc))
}

#[tauri::command]
fn sketch_save(state: tauri::State<AppState>, id: i64, name: String, doc: serde_json::Value, png: Option<String>) -> CmdResult<()> {
    let png = match png {
        Some(s) => Some(b64().decode(s).map_err(|_| "The image could not be read".to_string())?),
        None => None,
    };
    with_project(&state, |p| p.save_sketch(id, name.trim(), &doc, png.as_deref()))
}

#[tauri::command]
fn sketch_delete(state: tauri::State<AppState>, id: i64) -> CmdResult<()> {
    with_project(&state, |p| p.delete_sketch(id))
}

#[tauri::command]
fn sketch_duplicate(state: tauri::State<AppState>, id: i64, name: String) -> CmdResult<i64> {
    with_project(&state, |p| p.duplicate_sketch(id, name.trim()))
}

#[tauri::command]
fn sketches_reorder(state: tauri::State<AppState>, ids: Vec<i64>) -> CmdResult<()> {
    with_project(&state, |p| p.reorder(&ids))
}

#[tauri::command]
fn library_update(state: tauri::State<AppState>, ids: Vec<i64>, patch: LibraryPatch) -> CmdResult<usize> {
    with_project(&state, |p| p.set_library(&ids, &patch))
}

#[tauri::command]
fn library_folders() -> Vec<&'static str> {
    store::FOLDERS.to_vec()
}

// ---------------------------------------------------------------- style profiles

#[tauri::command]
fn profiles_list(state: tauri::State<AppState>) -> CmdResult<Vec<Profile>> {
    with_project(&state, |p| p.profiles())
}

#[tauri::command]
fn profile_save(state: tauri::State<AppState>, name: String, data: serde_json::Value) -> CmdResult<()> {
    with_project(&state, |p| p.save_profile(&name, &data))
}

#[tauri::command]
fn profile_delete(state: tauri::State<AppState>, name: String) -> CmdResult<()> {
    with_project(&state, |p| p.delete_profile(&name))
}

// ---------------------------------------------------------------- export

/// Writes rendered files into a folder, or into one zip when `path` ends in .zip.
#[tauri::command]
async fn export_write(state: tauri::State<'_, AppState>, path: PathBuf, files: Vec<OutFile>, summary: String) -> CmdResult<usize> {
    allowed(&state)?;
    let target = path.clone();
    let n = tauri::async_runtime::spawn_blocking(move || {
        if target.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
            export::to_zip(&target, &files)
        } else {
            export::to_folder(&target, &files)
        }
    })
    .await
    .map_err(|e| format!("The export stopped unexpectedly: {e}"))??;
    with_project(&state, |p| p.log("Exported", &format!("{summary} to {}", path.display())))?;
    Ok(n)
}

/// Writes one file, like a single sprite PNG or a style profile, to a path the person chose.
#[tauri::command]
fn export_file(state: tauri::State<AppState>, path: PathBuf, data: String) -> CmdResult<()> {
    allowed(&state)?;
    export::to_file(&path, &data)
}

/// Reads a file the person picked (a palette or a style profile) as text.
#[tauri::command]
fn read_text(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<String> {
    allowed(&state)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("That file is too large to be a palette or profile".into());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))
}

/// Reads an image the person picked, as base64, so the window can decode it.
#[tauri::command]
fn read_image(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<String> {
    allowed(&state)?;
    let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err(format!("{} is larger than 64 MB", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    Ok(b64().encode(bytes))
}

// ---------------------------------------------------------------- AI coloring (optional, the person's own OpenAI key)

#[tauri::command]
fn ai_has_key() -> bool {
    ai::has_key()
}

#[tauri::command]
fn ai_set_key(state: tauri::State<AppState>, key: String) -> CmdResult<()> {
    allowed(&state)?;
    ai::set_key(&key)
}

#[tauri::command]
fn ai_clear_key(state: tauri::State<AppState>) -> CmdResult<()> {
    allowed(&state)?;
    ai::clear_key()
}

/// Keeps a colored image with its sketch and notes where it came from.
fn keep_ai_image(state: &tauri::State<AppState>, id: i64, res: &ai::ColorResult, how: String) -> CmdResult<()> {
    let png = b64().decode(&res.png).map_err(|_| "The AI image couldn't be read".to_string())?;
    let how = if res.mock { "test mode, nothing sent".to_string() } else { how };
    with_project(state, |p| {
        p.set_ai_image(id, Some(&png))?;
        p.log("AI colored", &format!("Sketch {id} ({how})"))
    })
}

/// Sends one sketch to OpenAI and keeps the colored result with the sketch.
#[tauri::command]
async fn ai_color(state: tauri::State<'_, AppState>, id: i64, req: ai::ColorRequest) -> CmdResult<ai::ColorResult> {
    allowed(&state)?;
    let how = format!("OpenAI, {} quality", ai::clean_quality(&req.quality));
    let res = ai::color_sketch(req).await?;
    keep_ai_image(&state, id, &res, how)?;
    Ok(res)
}

/// Asks a ComfyUI server which checkpoints it has (and whether it is running at all).
#[tauri::command]
async fn comfy_info(state: tauri::State<'_, AppState>, url: String) -> CmdResult<comfy::ComfyInfo> {
    allowed(&state)?;
    comfy::info(&url).await
}

/// Colors one sketch on the person's own ComfyUI and keeps the result with the sketch.
#[tauri::command]
async fn comfy_color(state: tauri::State<'_, AppState>, id: i64, req: comfy::ComfyRequest) -> CmdResult<ai::ColorResult> {
    allowed(&state)?;
    let how = if req.workflow.is_some() { "ComfyUI, own workflow".to_string() } else { format!("ComfyUI, {}", req.checkpoint) };
    let res = comfy::color_sketch(req).await?;
    keep_ai_image(&state, id, &res, how)?;
    Ok(res)
}

#[tauri::command]
async fn comfy_interrupt(state: tauri::State<'_, AppState>, url: String) -> CmdResult<()> {
    allowed(&state)?;
    comfy::interrupt(&url).await
}

#[tauri::command]
fn ai_image_set(state: tauri::State<AppState>, id: i64, png: Option<String>) -> CmdResult<()> {
    let png = match png {
        Some(s) => Some(b64().decode(s).map_err(|_| "The image could not be read".to_string())?),
        None => None,
    };
    with_project(&state, |p| p.set_ai_image(id, png.as_deref()))
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
            project_close,
            project_current,
            project_rename,
            setting_get,
            setting_set,
            activity,
            sketches_list,
            sketch_add,
            sketch_save,
            sketch_delete,
            sketch_duplicate,
            sketches_reorder,
            library_update,
            library_folders,
            profiles_list,
            profile_save,
            profile_delete,
            export_write,
            export_file,
            read_text,
            read_image,
            ai_has_key,
            ai_set_key,
            ai_clear_key,
            ai_color,
            ai_image_set,
            comfy_info,
            comfy_color,
            comfy_interrupt
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
        .expect("error while running Pixel Forge");
}
