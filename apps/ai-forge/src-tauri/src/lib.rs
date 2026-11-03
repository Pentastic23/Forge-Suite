mod chat;
mod codex;
mod example;
mod images;
mod keys;
mod mesh;
mod projects;
mod store;

use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use projects::ProjectFile;
use store::{Asset, AssetPatch, Chat, Event, Message, NewAsset, Project, ProjectInfo};

pub const APP_ID: &str = "ai-forge";

struct Open {
    path: PathBuf,
    project: Project,
}

struct AppState {
    open: Mutex<Option<Open>>,
    /// Why the app may not run (not opened from Forge Hub), checked once at startup.
    launch_error: Option<String>,
    /// Set by Stop while an answer is being written.
    stop: AtomicBool,
}

type CmdResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentProject {
    path: PathBuf,
    info: ProjectInfo,
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

/// Opens the Emberfall example project, making the file the first time.
#[tauri::command]
fn project_example(state: tauri::State<AppState>) -> CmdResult<CurrentProject> {
    allowed(&state)?;
    let path = example::path();
    let project = if path.is_file() {
        Project::open(&path)?
    } else {
        std::fs::create_dir_all(projects::projects_dir()).map_err(|e| e.to_string())?;
        let p = Project::create(&path, example::NAME)?;
        example::fill(&p)?;
        p
    };
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

// ---------------------------------------------------------------- chats

#[tauri::command]
fn chats_list(state: tauri::State<AppState>) -> CmdResult<Vec<Chat>> {
    with_project(&state, |p| p.chats())
}

#[tauri::command]
fn chat_create(state: tauri::State<AppState>, title: String, mode: String) -> CmdResult<Chat> {
    with_project(&state, |p| {
        let id = p.create_chat(&title, &mode)?;
        p.chat(id)
    })
}

#[tauri::command]
fn chat_update(state: tauri::State<AppState>, id: i64, title: Option<String>, mode: Option<String>, pinned: Option<bool>) -> CmdResult<Chat> {
    with_project(&state, |p| {
        p.update_chat(id, title.as_deref(), mode.as_deref(), pinned)?;
        p.chat(id)
    })
}

#[tauri::command]
fn chat_delete(state: tauri::State<AppState>, id: i64) -> CmdResult<()> {
    with_project(&state, |p| p.delete_chat(id))
}

#[tauri::command]
fn chat_messages(state: tauri::State<AppState>, id: i64) -> CmdResult<Vec<Message>> {
    with_project(&state, |p| p.messages(id))
}

/// Removes a message and everything after it (to edit a question or try an answer again).
#[tauri::command]
fn chat_truncate(state: tauri::State<AppState>, id: i64, from: i64) -> CmdResult<usize> {
    with_project(&state, |p| p.truncate_chat(id, from))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sent {
    /// The question as stored, when one was sent (an empty text resends the chat as it is).
    question: Option<Message>,
    answer: Message,
    note: Option<String>,
    mock: bool,
}

/// A short title from the first question: its first words.
fn title_from(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().take(7).collect();
    let mut t = words.join(" ");
    if t.chars().count() > 60 {
        t = t.chars().take(57).collect::<String>() + "…";
    }
    t
}

/// Adds the question to the chat, sends the whole chat to the chosen AI and keeps its answer.
/// Each piece of the answer is sent to `on_text` as it arrives.
#[tauri::command]
async fn chat_send(state: tauri::State<'_, AppState>, id: i64, text: String, req: chat::ChatRequest, on_text: tauri::ipc::Channel<String>) -> CmdResult<Sent> {
    let (question, turns) = with_project(&state, |p| {
        let question = if text.trim().is_empty() {
            None
        } else {
            let chat = p.chat(id)?;
            if chat.messages == 0 && (chat.title == "New chat" || chat.title == "Untitled") {
                p.update_chat(id, Some(&title_from(&text)), None, None)?;
            }
            Some(p.add_message(id, "user", text.trim(), "")?)
        };
        let turns: Vec<chat::Turn> = p.messages(id)?.into_iter().map(|m| chat::Turn { role: m.role, content: m.content }).collect();
        Ok((question, turns))
    })?;
    state.stop.store(false, Ordering::Relaxed);
    let reply = chat::send(&req, &turns, &state.stop, |t| {
        let _ = on_text.send(t.to_string());
    })
    .await?;
    let answer = with_project(&state, |p| {
        let mut body = reply.text.clone();
        if let Some(n) = &reply.note {
            body.push_str(&format!("\n\n_({n})_"));
        }
        p.add_message(id, "assistant", &body, &reply.model)
    })?;
    Ok(Sent { question, answer, note: reply.note, mock: reply.mock })
}

#[tauri::command]
fn chat_stop(state: tauri::State<AppState>) {
    state.stop.store(true, Ordering::Relaxed);
}

/// One question outside any chat (like "improve this image prompt"); nothing is kept.
#[tauri::command]
async fn ask_once(state: tauri::State<'_, AppState>, text: String, req: chat::ChatRequest) -> CmdResult<String> {
    allowed(&state)?;
    let stop = AtomicBool::new(false);
    let turns = [chat::Turn { role: "user".into(), content: text }];
    Ok(chat::send(&req, &turns, &stop, |_| {}).await?.text)
}

#[tauri::command]
async fn local_models(state: tauri::State<'_, AppState>, url: String) -> CmdResult<Vec<String>> {
    allowed(&state)?;
    chat::local_models(&url).await
}

// ---------------------------------------------------------------- keys

#[tauri::command]
fn keys_status() -> keys::KeyStatus {
    keys::status()
}

#[tauri::command]
fn key_set(state: tauri::State<AppState>, service: String, key: String) -> CmdResult<()> {
    allowed(&state)?;
    keys::save(&service, &key)
}

#[tauri::command]
fn key_clear(state: tauri::State<AppState>, service: String) -> CmdResult<()> {
    allowed(&state)?;
    keys::clear(&service)
}

// ---------------------------------------------------------------- images

fn keep_image(state: &tauri::State<AppState>, made: images::Made, name: &str, prompt: &str) -> CmdResult<Asset> {
    let name = if name.trim().is_empty() { title_from(prompt) } else { name.to_string() };
    with_project(state, |p| {
        let id = p.add_asset(&NewAsset { kind: "image", name: &name, prompt, source: &made.source, mime: "image/png", data: &made.png, thumb: None, folder: "" })?;
        p.asset(id)
    })
}

#[tauri::command]
async fn image_openai(state: tauri::State<'_, AppState>, req: images::OpenAIImageRequest, name: String) -> CmdResult<Asset> {
    allowed(&state)?;
    let prompt = req.prompt.trim().to_string();
    let made = images::openai(req).await?;
    keep_image(&state, made, &name, &prompt)
}

#[tauri::command]
async fn image_comfy(state: tauri::State<'_, AppState>, req: images::ComfyImageRequest, name: String) -> CmdResult<Asset> {
    allowed(&state)?;
    let prompt = req.prompt.trim().to_string();
    let made = images::comfy(req).await?;
    keep_image(&state, made, &name, &prompt)
}

#[tauri::command]
async fn comfy_info(state: tauri::State<'_, AppState>, url: String) -> CmdResult<images::ComfyInfo> {
    allowed(&state)?;
    images::comfy_info(&url).await
}

#[tauri::command]
async fn comfy_interrupt(state: tauri::State<'_, AppState>, url: String) -> CmdResult<()> {
    allowed(&state)?;
    images::comfy_interrupt(&url).await
}

// ---------------------------------------------------------------- 3D models

#[tauri::command]
async fn mesh_start(state: tauri::State<'_, AppState>, req: mesh::MeshRequest) -> CmdResult<String> {
    allowed(&state)?;
    let id = mesh::start(&req).await?;
    let what = match req.kind.as_str() {
        "refine" => "texturing a preview".to_string(),
        "image" => "from a picture".to_string(),
        _ => format!("\"{}\"", title_from(&req.prompt)),
    };
    with_project(&state, |p| p.log("Started 3D model", &format!("Meshy, {what}")))?;
    Ok(id)
}

#[tauri::command]
async fn mesh_status(state: tauri::State<'_, AppState>, kind: String, id: String) -> CmdResult<mesh::MeshStatus> {
    allowed(&state)?;
    mesh::status(&kind, &id).await
}

/// Downloads a finished model into the library.
#[tauri::command]
async fn mesh_keep(state: tauri::State<'_, AppState>, kind: String, id: String, name: String, prompt: String) -> CmdResult<Asset> {
    allowed(&state)?;
    let files = mesh::download(&kind, &id).await?;
    let name = if name.trim().is_empty() { title_from(&prompt) } else { name };
    let source = if id.starts_with("mock-") { "test mode, nothing sent".to_string() } else { format!("Meshy ({})", if kind == "image" { "image to 3D" } else if kind == "refine" { "textured" } else { "preview mesh" }) };
    with_project(&state, |p| {
        let aid = p.add_asset(&NewAsset { kind: "model", name: &name, prompt: &prompt, source: &source, mime: "model/gltf-binary", data: &files.glb, thumb: files.thumb.as_deref(), folder: "" })?;
        p.asset(aid)
    })
}

// ---------------------------------------------------------------- library

#[tauri::command]
fn assets_list(state: tauri::State<AppState>) -> CmdResult<Vec<Asset>> {
    with_project(&state, |p| p.assets())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileData {
    mime: String,
    /// base64
    data: String,
}

#[tauri::command]
fn asset_data(state: tauri::State<AppState>, id: i64) -> CmdResult<FileData> {
    with_project(&state, |p| p.asset_data(id).map(|(mime, d)| FileData { mime, data: b64().encode(d) }))
}

#[tauri::command]
fn asset_thumb(state: tauri::State<AppState>, id: i64) -> CmdResult<Option<FileData>> {
    with_project(&state, |p| Ok(p.asset_thumb(id)?.map(|(mime, d)| FileData { mime, data: b64().encode(d) })))
}

/// Keeps a preview the window rendered (a 3D model without one from Meshy).
#[tauri::command]
fn asset_set_thumb(state: tauri::State<AppState>, id: i64, png: String) -> CmdResult<()> {
    let png = b64().decode(png).map_err(|_| "The preview couldn't be read".to_string())?;
    if store::sniff_image(&png) != "image/png" {
        return Err("Previews are kept as PNG".into());
    }
    with_project(&state, |p| p.set_thumb(id, &png))
}

#[tauri::command]
fn assets_update(state: tauri::State<AppState>, ids: Vec<i64>, patch: AssetPatch) -> CmdResult<usize> {
    with_project(&state, |p| p.update_assets(&ids, &patch))
}

#[tauri::command]
fn asset_delete(state: tauri::State<AppState>, id: i64) -> CmdResult<()> {
    with_project(&state, |p| p.delete_asset(id))
}

/// Adds an image or GLB file from disk to the library (for example, a picture to turn into 3D).
#[tauri::command]
fn asset_import(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<Asset> {
    allowed(&state)?;
    let data = read_file(&path, 128)?;
    let (kind, mime) = if data.starts_with(b"glTF") { ("model", "model/gltf-binary") } else { ("image", store::sniff_image(&data)) };
    if mime == "application/octet-stream" {
        return Err("AI Forge can add PNG, JPEG and WebP images and GLB models".into());
    }
    let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Imported".into());
    with_project(&state, |p| {
        let id = p.add_asset(&NewAsset { kind, name: &name, prompt: "", source: "Imported file", mime, data: &data, thumb: None, folder: "" })?;
        p.asset(id)
    })
}

fn read_file(path: &PathBuf, max_mb: u64) -> CmdResult<Vec<u8>> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    if meta.len() > max_mb * 1024 * 1024 {
        return Err(format!("{} is larger than {max_mb} MB", path.display()));
    }
    std::fs::read(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))
}

// ---------------------------------------------------------------- files

/// Saves a library item to a file the person chose.
#[tauri::command]
fn export_asset(state: tauri::State<AppState>, id: i64, path: PathBuf) -> CmdResult<()> {
    let (_, data) = with_project(&state, |p| p.asset_data(id))?;
    std::fs::write(&path, data).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
    with_project(&state, |p| p.log("Exported", &path.display().to_string()))
}

/// Saves text (a code block, or a chat as Markdown) to a file the person chose.
#[tauri::command]
fn export_text(state: tauri::State<AppState>, path: PathBuf, text: String) -> CmdResult<()> {
    allowed(&state)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't make {}: {e}", dir.display()))?;
    }
    std::fs::write(&path, text).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

#[tauri::command]
fn read_image(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<String> {
    allowed(&state)?;
    Ok(b64().encode(read_file(&path, 32)?))
}

// ---------------------------------------------------------------- codex from Forge Core

#[tauri::command]
fn codex_import(state: tauri::State<AppState>, path: PathBuf) -> CmdResult<codex::Codex> {
    allowed(&state)?;
    let c = codex::read(&path)?;
    with_project(&state, |p| {
        p.set_setting("codex", &serde_json::to_value(&c).map_err(|e| e.to_string())?)?;
        p.log("Imported codex", &format!("{} entries from {}", c.entries.len(), path.display()))
    })?;
    Ok(c)
}

#[tauri::command]
fn codex_clear(state: tauri::State<AppState>) -> CmdResult<()> {
    with_project(&state, |p| p.set_setting("codex", &serde_json::Value::Null))
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
            chats_list,
            chat_create,
            chat_update,
            chat_delete,
            chat_messages,
            chat_truncate,
            chat_send,
            chat_stop,
            ask_once,
            local_models,
            keys_status,
            key_set,
            key_clear,
            image_openai,
            image_comfy,
            comfy_info,
            comfy_interrupt,
            mesh_start,
            mesh_status,
            mesh_keep,
            assets_list,
            asset_data,
            asset_thumb,
            asset_set_thumb,
            assets_update,
            asset_delete,
            asset_import,
            export_asset,
            export_text,
            read_image,
            codex_import,
            codex_clear
        ]
    };
}

fn new_state(launch_error: Option<String>) -> AppState {
    AppState { open: Mutex::new(None), launch_error, stop: AtomicBool::new(false) }
}

/// This app's commands as a plugin named after the app id, so Forge Suite mobile
/// can hold every Forge app in one Android app (`plugin:<app id>|<command>`).
/// There is no Forge Hub on the phone to hand out launch keys, so the launch
/// check is left out here; the desktop app still requires it.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new(APP_ID)
        .setup(|app, _api| {
            tauri::Manager::manage(app, new_state(None));
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
        .manage(new_state(launch_error))
        .invoke_handler(commands!())
        .run(tauri::generate_context!())
        .expect("error while running AI Forge");
}

#[cfg(test)]
mod tests {
    #[test]
    fn titles_from_questions() {
        assert_eq!(super::title_from("  How do I make   the cave bat swoop at the player in Godot?"), "How do I make the cave bat");
    }
}
