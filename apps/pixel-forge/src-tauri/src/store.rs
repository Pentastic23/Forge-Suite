//! One `.pixelforge` file (SQLite) per project: sketches with their source
//! image and everything made from them (touch-ups, rig, animations), plus the
//! project's conversion settings and saved style profiles.

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
CREATE TABLE IF NOT EXISTS sketches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  png BLOB NOT NULL,
  doc TEXT NOT NULL DEFAULT '{}',
  folder TEXT NOT NULL DEFAULT 'Characters',
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_images (
  sketch_id INTEGER PRIMARY KEY REFERENCES sketches(id) ON DELETE CASCADE,
  png BLOB NOT NULL,
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

/// A sketch as stored: the source PNG and a JSON document the app owns.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sketch {
    pub id: i64,
    pub name: String,
    pub sort: i64,
    pub png: Vec<u8>,
    pub doc: serde_json::Value,
    /// Library folder, like "Characters" or "Effects".
    pub folder: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Library fields for one sketch; `None` leaves a field as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPatch {
    pub folder: Option<String>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

/// The library's starting folders. Any other name the person types is kept too.
pub const FOLDERS: [&str; 7] = ["Characters", "Enemies", "Effects", "Buildings", "UI", "Icons", "Animations"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub data: serde_json::Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub at: i64,
    pub action: String,
    pub detail: String,
}

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
        p.info().map_err(|_| "This isn't a Pixel Forge project".to_string())?;
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

    // ------------------------------------------------------------ sketches

    pub fn sketches(&self) -> Result<Vec<Sketch>> {
        let mut st = self
            .conn
            .prepare("SELECT id, name, sort, png, doc, folder, tags, favorite, created_at, updated_at FROM sketches ORDER BY sort, id")
            .map_err(sql)?;
        let rows = st
            .query_map([], |r| {
                let doc: String = r.get(4)?;
                let tags: String = r.get(6)?;
                Ok(Sketch {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    sort: r.get(2)?,
                    png: r.get(3)?,
                    doc: serde_json::from_str(&doc).unwrap_or(serde_json::json!({})),
                    folder: r.get(5)?,
                    tags: serde_json::from_str(&tags).unwrap_or_default(),
                    favorite: r.get::<_, i64>(7)? != 0,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    /// Adds a sketch and returns its id.
    pub fn add_sketch(&self, name: &str, folder: &str, png: &[u8], doc: &serde_json::Value) -> Result<i64> {
        if png.len() < 8 || &png[1..4] != b"PNG" {
            return Err("Sketches are stored as PNG".into());
        }
        let sort: i64 = self.conn.query_row("SELECT COALESCE(MAX(sort), 0) + 1 FROM sketches", [], |r| r.get(0)).map_err(sql)?;
        let now = now_ms();
        self.conn
            .execute(
                "INSERT INTO sketches(name, sort, png, doc, folder, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![name, sort, png, doc.to_string(), clean_folder(folder), now],
            )
            .map_err(sql)?;
        let id = self.conn.last_insert_rowid();
        self.log("Added sketch", name)?;
        Ok(id)
    }

    /// Saves a sketch's name and document; `png` replaces the source image when given.
    pub fn save_sketch(&self, id: i64, name: &str, doc: &serde_json::Value, png: Option<&[u8]>) -> Result<()> {
        let n = match png {
            Some(png) => self.conn.execute(
                "UPDATE sketches SET name = ?2, doc = ?3, png = ?4, updated_at = ?5 WHERE id = ?1",
                params![id, name, doc.to_string(), png, now_ms()],
            ),
            None => self.conn.execute("UPDATE sketches SET name = ?2, doc = ?3, updated_at = ?4 WHERE id = ?1", params![id, name, doc.to_string(), now_ms()]),
        }
        .map_err(sql)?;
        if n == 0 {
            return Err("That sketch was removed".into());
        }
        Ok(())
    }

    pub fn set_library(&self, ids: &[i64], patch: &LibraryPatch) -> Result<usize> {
        let tx = self.conn.unchecked_transaction().map_err(sql)?;
        let mut n = 0;
        for id in ids {
            if let Some(f) = &patch.folder {
                n += tx.execute("UPDATE sketches SET folder = ?2 WHERE id = ?1", params![id, clean_folder(f)]).map_err(sql)?;
            }
            if let Some(t) = &patch.tags {
                let mut tags: Vec<String> = t.iter().map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect();
                tags.sort();
                tags.dedup();
                n += tx.execute("UPDATE sketches SET tags = ?2 WHERE id = ?1", params![id, serde_json::to_string(&tags).unwrap()]).map_err(sql)?;
            }
            if let Some(f) = patch.favorite {
                n += tx.execute("UPDATE sketches SET favorite = ?2 WHERE id = ?1", params![id, f as i64]).map_err(sql)?;
            }
        }
        tx.commit().map_err(sql)?;
        Ok(n)
    }

    /// Copies a sketch with everything made from it; returns the new id.
    pub fn duplicate_sketch(&self, id: i64, name: &str) -> Result<i64> {
        let sort: i64 = self.conn.query_row("SELECT COALESCE(MAX(sort), 0) + 1 FROM sketches", [], |r| r.get(0)).map_err(sql)?;
        let now = now_ms();
        let n = self
            .conn
            .execute(
                "INSERT INTO sketches(name, sort, png, doc, folder, tags, favorite, created_at, updated_at)
                 SELECT ?2, ?3, png, doc, folder, tags, 0, ?4, ?4 FROM sketches WHERE id = ?1",
                params![id, name, sort, now],
            )
            .map_err(sql)?;
        if n == 0 {
            return Err("That sketch was removed".into());
        }
        let new_id = self.conn.last_insert_rowid();
        self.conn
            .execute("INSERT INTO ai_images(sketch_id, png, created_at) SELECT ?2, png, created_at FROM ai_images WHERE sketch_id = ?1", params![id, new_id])
            .map_err(sql)?;
        Ok(new_id)
    }

    // ------------------------------------------------------------ AI versions of sketches

    /// The colored version an AI backend made of a sketch, kept so it is never paid for twice.
    pub fn ai_image(&self, id: i64) -> Result<Option<Vec<u8>>> {
        self.conn.query_row("SELECT png FROM ai_images WHERE sketch_id = ?1", [id], |r| r.get(0)).optional().map_err(sql)
    }

    pub fn set_ai_image(&self, id: i64, png: Option<&[u8]>) -> Result<()> {
        match png {
            Some(p) => {
                if !p.starts_with(b"\x89PNG") {
                    return Err("The AI image isn't a PNG".into());
                }
                self.conn
                    .execute("INSERT OR REPLACE INTO ai_images(sketch_id, png, created_at) VALUES (?1, ?2, ?3)", params![id, p, now_ms()])
                    .map_err(sql)?;
            }
            None => {
                self.conn.execute("DELETE FROM ai_images WHERE sketch_id = ?1", [id]).map_err(sql)?;
            }
        }
        Ok(())
    }

    pub fn delete_sketch(&self, id: i64) -> Result<()> {
        let name: Option<String> = self.conn.query_row("SELECT name FROM sketches WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)?;
        self.conn.execute("DELETE FROM sketches WHERE id = ?1", [id]).map_err(sql)?;
        if let Some(n) = name {
            self.log("Removed sketch", &n)?;
        }
        Ok(())
    }

    pub fn reorder(&self, ids: &[i64]) -> Result<()> {
        let tx = self.conn.unchecked_transaction().map_err(sql)?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute("UPDATE sketches SET sort = ?2 WHERE id = ?1", params![id, i as i64]).map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    // ------------------------------------------------------------ style profiles

    pub fn profiles(&self) -> Result<Vec<Profile>> {
        let mut st = self.conn.prepare("SELECT name, data, updated_at FROM profiles ORDER BY name COLLATE NOCASE").map_err(sql)?;
        let rows = st
            .query_map([], |r| {
                let d: String = r.get(1)?;
                Ok(Profile { name: r.get(0)?, data: serde_json::from_str(&d).unwrap_or(serde_json::json!({})), updated_at: r.get(2)? })
            })
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn save_profile(&self, name: &str, data: &serde_json::Value) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Give the profile a name".into());
        }
        self.conn
            .execute("INSERT OR REPLACE INTO profiles(name, data, updated_at) VALUES (?1, ?2, ?3)", params![name, data.to_string(), now_ms()])
            .map_err(sql)?;
        self.log("Saved style profile", name)
    }

    pub fn delete_profile(&self, name: &str) -> Result<()> {
        self.conn.execute("DELETE FROM profiles WHERE name = ?1", [name]).map_err(sql)?;
        Ok(())
    }
}

fn clean_folder(f: &str) -> String {
    let f: String = f.trim().chars().filter(|c| !c.is_control()).take(40).collect();
    if f.is_empty() { FOLDERS[0].into() } else { f }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub const PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d, 0x49,
        0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0, 5, 0, 1, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn sketches_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.pixelforge");
        let p = Project::create(&path, " Mouse Kingdom ").unwrap();
        assert_eq!(p.info().unwrap().name, "Mouse Kingdom");
        assert!(p.add_sketch("bad", "", b"nope", &serde_json::json!({})).is_err());
        let a = p.add_sketch("knight", "Characters", PNG_1X1, &serde_json::json!({"facing": "right"})).unwrap();
        let b = p.add_sketch("slime", " ", PNG_1X1, &serde_json::json!({})).unwrap();
        p.save_sketch(a, "knight", &serde_json::json!({"facing": "left"}), None).unwrap();
        p.reorder(&[b, a]).unwrap();
        let list = p.sketches().unwrap();
        assert_eq!(list.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["slime", "knight"]);
        assert_eq!(list[1].doc["facing"], "left");
        assert_eq!(list[0].folder, "Characters", "an empty folder name falls back to the first folder");
        p.set_library(&[a], &LibraryPatch { folder: Some("Enemies".into()), tags: Some(vec!["Boss".into(), "boss".into(), " ".into()]), favorite: Some(true) }).unwrap();
        let k = p.sketches().unwrap().into_iter().find(|s| s.id == a).unwrap();
        assert_eq!((k.folder.as_str(), k.tags.clone(), k.favorite), ("Enemies", vec!["boss".to_string()], true));
        let c = p.duplicate_sketch(a, "knight_copy").unwrap();
        let c = p.sketches().unwrap().into_iter().find(|s| s.id == c).unwrap();
        assert_eq!((c.folder.as_str(), c.favorite, c.doc["facing"].as_str()), ("Enemies", false, Some("left")));
        p.delete_sketch(c.id).unwrap();
        p.delete_sketch(b).unwrap();
        assert!(p.save_sketch(b, "slime", &serde_json::json!({}), None).is_err());
        drop(p);

        let p = Project::open(&path).unwrap();
        assert_eq!(p.sketches().unwrap().len(), 1);
        p.set_setting("S", &serde_json::json!({"autoCount": 12})).unwrap();
        assert_eq!(p.setting("S").unwrap().unwrap()["autoCount"], 12);
        p.save_profile("Mouse style", &serde_json::json!({"outline": "selective"})).unwrap();
        assert_eq!(p.profiles().unwrap()[0].name, "Mouse style");
        assert!(p.activity(10).unwrap().iter().any(|e| e.action == "Removed sketch"));
    }

    #[test]
    fn ai_images_follow_their_sketch() {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("a.pixelforge"), "AI").unwrap();
        let a = p.add_sketch("hero", "Characters", PNG_1X1, &serde_json::json!({})).unwrap();
        assert_eq!(p.ai_image(a).unwrap(), None);
        assert!(p.set_ai_image(a, Some(b"not a png")).is_err());
        p.set_ai_image(a, Some(PNG_1X1)).unwrap();
        assert_eq!(p.ai_image(a).unwrap().as_deref(), Some(PNG_1X1));
        let c = p.duplicate_sketch(a, "hero_copy").unwrap();
        assert_eq!(p.ai_image(c).unwrap().as_deref(), Some(PNG_1X1), "a copy keeps the paid-for image");
        p.delete_sketch(a).unwrap();
        assert_eq!(p.ai_image(a).unwrap(), None, "deleting a sketch removes its AI image");
        p.set_ai_image(c, None).unwrap();
        assert_eq!(p.ai_image(c).unwrap(), None);
    }
}
