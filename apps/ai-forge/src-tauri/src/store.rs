//! One `.aiforge` file (SQLite) per project: chats with the assistant, the
//! images and 3D models made in it (the library), the project brief and the
//! AI settings, plus an activity log.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub type Result<T> = std::result::Result<T, String>;

pub fn sql(e: rusqlite::Error) -> String {
    format!("Project file error: {e}")
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'general',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  thumb BLOB,
  folder TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at: i64,
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chat {
    pub id: i64,
    pub title: String,
    pub mode: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub role: String,
    pub content: String,
    pub model: String,
    pub created_at: i64,
}

/// A library item: an image or a 3D model. `data` is only read when asked for.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: i64,
    /// "image" or "model".
    pub kind: String,
    pub name: String,
    pub prompt: String,
    /// Where it was made, like "OpenAI gpt-image-1" or "Meshy".
    pub source: String,
    pub mime: String,
    pub size: i64,
    pub folder: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub created_at: i64,
}

/// Library fields for some assets; `None` leaves a field as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPatch {
    pub name: Option<String>,
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

pub struct NewAsset<'a> {
    pub kind: &'a str,
    pub name: &'a str,
    pub prompt: &'a str,
    pub source: &'a str,
    pub mime: &'a str,
    pub data: &'a [u8],
    pub thumb: Option<&'a [u8]>,
    pub folder: &'a str,
}

/// The roles a stored message can have.
pub const ROLES: [&str; 2] = ["user", "assistant"];

pub struct Project {
    pub conn: Connection,
}

impl Project {
    fn prepare(conn: Connection) -> Result<Project> {
        conn.busy_timeout(std::time::Duration::from_secs(10)).map_err(sql)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(sql)?;
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Project { conn })
    }

    pub fn create(path: &Path, name: &str) -> Result<Project> {
        if path.exists() {
            return Err("A project with that file name already exists".into());
        }
        let p = Project::prepare(Connection::open(path).map_err(sql)?)?;
        let id = uuid::Uuid::new_v4().to_string();
        for (k, v) in [("id", id.as_str()), ("name", name.trim()), ("createdAt", &now_ms().to_string()), ("format", "1")] {
            p.conn.execute("INSERT INTO meta(key, value) VALUES (?1, ?2)", params![k, v]).map_err(sql)?;
        }
        p.log("Created", &format!("Project \"{}\"", name.trim()))?;
        Ok(p)
    }

    pub fn open(path: &Path) -> Result<Project> {
        if !path.exists() {
            return Err(format!("{} doesn't exist any more", path.display()));
        }
        let p = Project::prepare(Connection::open(path).map_err(sql)?)?;
        p.info().map_err(|_| "This isn't an AI Forge project".to_string())?;
        Ok(p)
    }

    fn meta(&self, key: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0)).optional().map_err(sql)
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        Ok(ProjectInfo {
            id: self.meta("id")?.ok_or("Missing project id")?,
            name: self.meta("name")?.unwrap_or_else(|| "Untitled".into()),
            created_at: self.meta("createdAt")?.and_then(|s| s.parse().ok()).unwrap_or(0),
        })
    }

    pub fn rename(&self, name: &str) -> Result<ProjectInfo> {
        self.conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('name', ?1)", [name.trim()]).map_err(sql)?;
        self.info()
    }

    pub fn setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let s: Option<String> = self.conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional().map_err(sql)?;
        Ok(s.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.conn
            .execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?1, ?2)", params![key, value.to_string()])
            .map_err(sql)?;
        Ok(())
    }

    pub fn log(&self, action: &str, detail: &str) -> Result<()> {
        self.conn.execute("INSERT INTO events(at, action, detail) VALUES (?1, ?2, ?3)", params![now_ms(), action, detail]).map_err(sql)?;
        Ok(())
    }

    pub fn activity(&self, limit: i64) -> Result<Vec<Event>> {
        let mut st = self.conn.prepare("SELECT at, action, detail FROM events ORDER BY at DESC, id DESC LIMIT ?1").map_err(sql)?;
        let rows = st.query_map([limit], |r| Ok(Event { at: r.get(0)?, action: r.get(1)?, detail: r.get(2)? })).map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    // ------------------------------------------------------------ chats

    pub fn chats(&self) -> Result<Vec<Chat>> {
        let mut st = self
            .conn
            .prepare(
                "SELECT c.id, c.title, c.mode, c.pinned, c.created_at, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id)
                 FROM chats c ORDER BY c.pinned DESC, c.updated_at DESC, c.id DESC",
            )
            .map_err(sql)?;
        let rows = st
            .query_map([], |r| {
                Ok(Chat {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    mode: r.get(2)?,
                    pinned: r.get::<_, i64>(3)? != 0,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    messages: r.get(6)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn chat(&self, id: i64) -> Result<Chat> {
        self.chats()?.into_iter().find(|c| c.id == id).ok_or_else(|| "That chat was removed".to_string())
    }

    pub fn create_chat(&self, title: &str, mode: &str) -> Result<i64> {
        let now = now_ms();
        let title = clean_title(title);
        self.conn
            .execute("INSERT INTO chats(title, mode, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", params![title, clean_mode(mode), now])
            .map_err(sql)?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn update_chat(&self, id: i64, title: Option<&str>, mode: Option<&str>, pinned: Option<bool>) -> Result<()> {
        let mut n = 0;
        if let Some(t) = title {
            n += self.conn.execute("UPDATE chats SET title = ?2 WHERE id = ?1", params![id, clean_title(t)]).map_err(sql)?;
        }
        if let Some(m) = mode {
            n += self.conn.execute("UPDATE chats SET mode = ?2 WHERE id = ?1", params![id, clean_mode(m)]).map_err(sql)?;
        }
        if let Some(p) = pinned {
            n += self.conn.execute("UPDATE chats SET pinned = ?2 WHERE id = ?1", params![id, p as i64]).map_err(sql)?;
        }
        if n == 0 && (title.is_some() || mode.is_some() || pinned.is_some()) {
            return Err("That chat was removed".into());
        }
        Ok(())
    }

    pub fn delete_chat(&self, id: i64) -> Result<()> {
        let title: Option<String> = self.conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)?;
        self.conn.execute("DELETE FROM chats WHERE id = ?1", [id]).map_err(sql)?;
        if let Some(t) = title {
            self.log("Removed chat", &t)?;
        }
        Ok(())
    }

    pub fn messages(&self, chat_id: i64) -> Result<Vec<Message>> {
        let mut st = self.conn.prepare("SELECT id, role, content, model, created_at FROM messages WHERE chat_id = ?1 ORDER BY id").map_err(sql)?;
        let rows = st
            .query_map([chat_id], |r| Ok(Message { id: r.get(0)?, role: r.get(1)?, content: r.get(2)?, model: r.get(3)?, created_at: r.get(4)? }))
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn add_message(&self, chat_id: i64, role: &str, content: &str, model: &str) -> Result<Message> {
        if !ROLES.contains(&role) {
            return Err(format!("Unknown message role {role}"));
        }
        let now = now_ms();
        let n = self.conn.execute("UPDATE chats SET updated_at = ?2 WHERE id = ?1", params![chat_id, now]).map_err(sql)?;
        if n == 0 {
            return Err("That chat was removed".into());
        }
        self.conn
            .execute("INSERT INTO messages(chat_id, role, content, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![chat_id, role, content, model, now])
            .map_err(sql)?;
        Ok(Message { id: self.conn.last_insert_rowid(), role: role.into(), content: content.into(), model: model.into(), created_at: now })
    }

    /// Removes a message and everything after it in its chat (to edit or retry from there).
    pub fn truncate_chat(&self, chat_id: i64, from_message: i64) -> Result<usize> {
        self.conn.execute("DELETE FROM messages WHERE chat_id = ?1 AND id >= ?2", params![chat_id, from_message]).map_err(sql)
    }

    // ------------------------------------------------------------ library

    pub fn assets(&self) -> Result<Vec<Asset>> {
        let mut st = self
            .conn
            .prepare("SELECT id, kind, name, prompt, source, mime, length(data), folder, tags, favorite, created_at FROM assets ORDER BY created_at DESC, id DESC")
            .map_err(sql)?;
        let rows = st
            .query_map([], |r| {
                let tags: String = r.get(8)?;
                Ok(Asset {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    prompt: r.get(3)?,
                    source: r.get(4)?,
                    mime: r.get(5)?,
                    size: r.get(6)?,
                    folder: r.get(7)?,
                    tags: serde_json::from_str(&tags).unwrap_or_default(),
                    favorite: r.get::<_, i64>(9)? != 0,
                    created_at: r.get(10)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn asset(&self, id: i64) -> Result<Asset> {
        self.assets()?.into_iter().find(|a| a.id == id).ok_or_else(|| "That item was removed from the library".to_string())
    }

    pub fn add_asset(&self, a: &NewAsset) -> Result<i64> {
        if !matches!(a.kind, "image" | "model") {
            return Err(format!("Unknown library item kind {}", a.kind));
        }
        if a.data.is_empty() {
            return Err("Nothing to keep: the file is empty".into());
        }
        let name = clean_title(a.name);
        let folder = clean_folder(a.folder, a.kind);
        self.conn
            .execute(
                "INSERT INTO assets(kind, name, prompt, source, mime, data, thumb, folder, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![a.kind, name, a.prompt, a.source, a.mime, a.data, a.thumb, folder, now_ms()],
            )
            .map_err(sql)?;
        let id = self.conn.last_insert_rowid();
        self.log(if a.kind == "image" { "Made image" } else { "Made 3D model" }, &format!("{name} ({})", a.source))?;
        Ok(id)
    }

    pub fn asset_data(&self, id: i64) -> Result<(String, Vec<u8>)> {
        self.conn
            .query_row("SELECT mime, data FROM assets WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(sql)?
            .ok_or_else(|| "That item was removed from the library".to_string())
    }

    /// The small preview: a model's render, or for images the image itself when no thumb was kept.
    pub fn asset_thumb(&self, id: i64) -> Result<Option<(String, Vec<u8>)>> {
        let row: Option<(String, String, Option<Vec<u8>>)> = self
            .conn
            .query_row("SELECT kind, mime, thumb FROM assets WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .map_err(sql)?;
        match row {
            None => Ok(None),
            Some((_, _, Some(t))) => Ok(Some((sniff_image(&t).to_string(), t))),
            Some((kind, _, None)) if kind == "image" => self.asset_data(id).map(Some),
            Some(_) => Ok(None),
        }
    }

    pub fn set_thumb(&self, id: i64, thumb: &[u8]) -> Result<()> {
        self.conn.execute("UPDATE assets SET thumb = ?2 WHERE id = ?1", params![id, thumb]).map_err(sql)?;
        Ok(())
    }

    pub fn update_assets(&self, ids: &[i64], patch: &AssetPatch) -> Result<usize> {
        let tx = self.conn.unchecked_transaction().map_err(sql)?;
        let mut n = 0;
        for id in ids {
            if let Some(name) = &patch.name {
                n += tx.execute("UPDATE assets SET name = ?2 WHERE id = ?1", params![id, clean_title(name)]).map_err(sql)?;
            }
            if let Some(f) = &patch.folder {
                n += tx.execute("UPDATE assets SET folder = ?2 WHERE id = ?1 ", params![id, f.trim().chars().filter(|c| !c.is_control()).take(40).collect::<String>()]).map_err(sql)?;
            }
            if let Some(t) = &patch.tags {
                let mut tags: Vec<String> = t.iter().map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect();
                tags.sort();
                tags.dedup();
                n += tx.execute("UPDATE assets SET tags = ?2 WHERE id = ?1", params![id, serde_json::to_string(&tags).unwrap()]).map_err(sql)?;
            }
            if let Some(f) = patch.favorite {
                n += tx.execute("UPDATE assets SET favorite = ?2 WHERE id = ?1", params![id, f as i64]).map_err(sql)?;
            }
        }
        tx.commit().map_err(sql)?;
        Ok(n)
    }

    pub fn delete_asset(&self, id: i64) -> Result<()> {
        let name: Option<String> = self.conn.query_row("SELECT name FROM assets WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)?;
        self.conn.execute("DELETE FROM assets WHERE id = ?1", [id]).map_err(sql)?;
        if let Some(n) = name {
            self.log("Removed from library", &n)?;
        }
        Ok(())
    }
}

/// The mime type of a PNG, JPEG or WebP from its first bytes.
pub fn sniff_image(b: &[u8]) -> &'static str {
    if b.starts_with(b"\x89PNG") {
        "image/png"
    } else if b.starts_with(&[0xff, 0xd8]) {
        "image/jpeg"
    } else if b.len() > 12 && &b[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    }
}

fn clean_title(t: &str) -> String {
    let t: String = t.trim().chars().filter(|c| !c.is_control()).take(120).collect();
    if t.is_empty() { "Untitled".into() } else { t }
}

/// The assistant's modes; anything else becomes "general".
pub const MODES: [&str; 7] = ["general", "code", "design", "writing", "art", "model3d", "review"];

fn clean_mode(m: &str) -> &str {
    MODES.iter().find(|x| **x == m).copied().unwrap_or("general")
}

fn clean_folder(f: &str, kind: &str) -> String {
    let f: String = f.trim().chars().filter(|c| !c.is_control()).take(40).collect();
    if !f.is_empty() {
        f
    } else if kind == "model" {
        "3D models".into()
    } else {
        "Images".into()
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49,
        0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 5, 0, 1, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn chats_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.aiforge");
        let p = Project::create(&path, " Mouse Kingdom ").unwrap();
        assert_eq!(p.info().unwrap().name, "Mouse Kingdom");
        let a = p.create_chat("Jump code", "code").unwrap();
        let b = p.create_chat("  ", "nonsense").unwrap();
        let chat_b = p.chat(b).unwrap();
        assert_eq!((chat_b.title.as_str(), chat_b.mode.as_str()), ("Untitled", "general"));
        p.add_message(a, "user", "How do I make a jump?", "").unwrap();
        let reply = p.add_message(a, "assistant", "Use velocity.y", "claude-opus-5-5").unwrap();
        assert!(p.add_message(a, "system", "x", "").is_err());
        assert!(p.add_message(999, "user", "x", "").is_err());
        assert_eq!(p.messages(a).unwrap().len(), 2);
        assert_eq!(p.chats().unwrap()[0].id, a, "the chat just written in comes first");
        p.update_chat(b, Some("Pinned"), None, Some(true)).unwrap();
        assert_eq!(p.chats().unwrap()[0].id, b, "pinned chats come first");
        p.truncate_chat(a, reply.id).unwrap();
        assert_eq!(p.messages(a).unwrap().len(), 1);
        p.delete_chat(a).unwrap();
        assert!(p.chat(a).is_err());
        drop(p);
        let p = Project::open(&path).unwrap();
        assert_eq!(p.chats().unwrap().len(), 1);
        p.set_setting("brief", &serde_json::json!({"genre": "platformer"})).unwrap();
        assert_eq!(p.setting("brief").unwrap().unwrap()["genre"], "platformer");
        assert!(p.activity(10).unwrap().iter().any(|e| e.action == "Removed chat"));
    }

    #[test]
    fn library_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("a.aiforge"), "AI").unwrap();
        let img = p
            .add_asset(&NewAsset { kind: "image", name: "Slime", prompt: "green slime", source: "OpenAI", mime: "image/png", data: PNG_1X1, thumb: None, folder: "" })
            .unwrap();
        let glb = p
            .add_asset(&NewAsset { kind: "model", name: "Crate", prompt: "crate", source: "Meshy", mime: "model/gltf-binary", data: b"glTF....", thumb: Some(PNG_1X1), folder: "" })
            .unwrap();
        assert!(p.add_asset(&NewAsset { kind: "sound", name: "x", prompt: "", source: "", mime: "", data: b"x", thumb: None, folder: "" }).is_err());
        let list = p.assets().unwrap();
        assert_eq!(list.len(), 2);
        let i = list.iter().find(|a| a.id == img).unwrap();
        assert_eq!((i.folder.as_str(), i.size), ("Images", PNG_1X1.len() as i64));
        assert_eq!(p.asset(glb).unwrap().folder, "3D models");
        assert_eq!(p.asset_thumb(img).unwrap().unwrap().1, PNG_1X1, "an image is its own preview");
        assert_eq!(p.asset_thumb(glb).unwrap().unwrap().0, "image/png");
        p.update_assets(&[img, glb], &AssetPatch { tags: Some(vec!["Boss".into(), "boss".into()]), favorite: Some(true), ..Default::default() }).unwrap();
        let a = p.asset(img).unwrap();
        assert_eq!((a.tags.clone(), a.favorite), (vec!["boss".to_string()], true));
        p.delete_asset(img).unwrap();
        assert!(p.asset_data(img).is_err());
        assert_eq!(p.asset_data(glb).unwrap().1, b"glTF....");
    }

    #[test]
    fn sniffs_images() {
        assert_eq!(sniff_image(PNG_1X1), "image/png");
        assert_eq!(sniff_image(&[0xff, 0xd8, 0xff]), "image/jpeg");
        assert_eq!(sniff_image(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
    }
}
