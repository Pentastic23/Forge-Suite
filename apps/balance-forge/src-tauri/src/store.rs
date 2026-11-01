//! A Balance Forge project is one SQLite file holding its sheets and the
//! patch snapshots taken of them.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::sheet::Sheet;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetInfo {
    pub id: String,
    pub name: String,
    pub rows: usize,
    pub source_kind: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub sheet_id: String,
    pub name: String,
    pub created_at: i64,
}

pub struct Project {
    conn: Connection,
}

type Result<T> = std::result::Result<T, String>;

fn sql(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sheets (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, position INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
"#;

impl Project {
    pub fn create(path: &Path, name: &str) -> Result<Project> {
        if path.exists() {
            return Err(format!("{} already exists", path.display()));
        }
        let p = Project::connect(path)?;
        let info = ProjectInfo { id: uuid::Uuid::new_v4().to_string(), name: name.trim().into(), created_at: now_ms() };
        p.conn
            .execute("INSERT INTO meta(key, value) VALUES ('project', ?1)", [serde_json::to_string(&info).unwrap()])
            .map_err(sql)?;
        Ok(p)
    }

    pub fn open(path: &Path) -> Result<Project> {
        if !path.is_file() {
            return Err(format!("No project file at {}", path.display()));
        }
        let p = Project::connect(path)?;
        p.info()?;
        Ok(p)
    }

    fn connect(path: &Path) -> Result<Project> {
        let conn = Connection::open(path).map_err(sql)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(sql)?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(sql)?;
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Project { conn })
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        let raw: Option<String> = self.conn.query_row("SELECT value FROM meta WHERE key = 'project'", [], |r| r.get(0)).optional().map_err(sql)?;
        let raw = raw.ok_or("This file is not a Balance Forge project")?;
        serde_json::from_str(&raw).map_err(|e| format!("Project info is damaged: {e}"))
    }

    pub fn rename(&self, name: &str) -> Result<ProjectInfo> {
        let mut info = self.info()?;
        info.name = name.trim().into();
        self.conn.execute("UPDATE meta SET value = ?1 WHERE key = 'project'", [serde_json::to_string(&info).unwrap()]).map_err(sql)?;
        Ok(info)
    }

    pub fn sheets(&self) -> Result<Vec<SheetInfo>> {
        let mut stmt = self.conn.prepare("SELECT data FROM sheets ORDER BY position, name").map_err(sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(sql)?;
        let mut out = Vec::new();
        for raw in rows {
            let s: Sheet = serde_json::from_str(&raw.map_err(sql)?).map_err(|e| format!("A sheet is damaged: {e}"))?;
            out.push(SheetInfo { id: s.id, name: s.name, rows: s.rows.len(), source_kind: s.source_kind, updated_at: s.updated_at });
        }
        Ok(out)
    }

    pub fn sheet(&self, id: &str) -> Result<Sheet> {
        let raw: Option<String> = self.conn.query_row("SELECT data FROM sheets WHERE id = ?1", [id], |r| r.get(0)).optional().map_err(sql)?;
        serde_json::from_str(&raw.ok_or("That sheet no longer exists")?).map_err(|e| format!("The sheet is damaged: {e}"))
    }

    pub fn save_sheet(&self, mut s: Sheet) -> Result<Sheet> {
        s.name = s.name.trim().to_string();
        if s.name.is_empty() {
            return Err("Give the sheet a name".into());
        }
        s.validate()?;
        if s.id.is_empty() {
            s.id = uuid::Uuid::new_v4().to_string();
        }
        for r in &mut s.rows {
            if r.id.is_empty() {
                r.id = uuid::Uuid::new_v4().to_string();
            }
        }
        s.updated_at = now_ms();
        let pos: i64 = self
            .conn
            .query_row("SELECT COALESCE((SELECT position FROM sheets WHERE id = ?1), (SELECT COALESCE(MAX(position), -1) + 1 FROM sheets))", [&s.id], |r| r.get(0))
            .map_err(sql)?;
        self.conn
            .execute(
                "INSERT INTO sheets(id, name, data, position, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
                params![s.id, s.name, serde_json::to_string(&s).unwrap(), pos, s.updated_at],
            )
            .map_err(sql)?;
        Ok(s)
    }

    pub fn delete_sheet(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM sheets WHERE id = ?1", [id]).map_err(sql)?;
        Ok(())
    }

    /// Saves the sheet as it is now under a name like "Patch 1.2".
    pub fn snapshot(&self, sheet_id: &str, name: &str) -> Result<SnapshotInfo> {
        let s = self.sheet(sheet_id)?;
        let info = SnapshotInfo { id: uuid::Uuid::new_v4().to_string(), sheet_id: s.id.clone(), name: name.trim().into(), created_at: now_ms() };
        if info.name.is_empty() {
            return Err("Give the snapshot a name, like Patch 1.2".into());
        }
        self.conn
            .execute(
                "INSERT INTO snapshots(id, sheet_id, name, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![info.id, info.sheet_id, info.name, serde_json::to_string(&s).unwrap(), info.created_at],
            )
            .map_err(sql)?;
        Ok(info)
    }

    pub fn snapshots(&self, sheet_id: &str) -> Result<Vec<SnapshotInfo>> {
        let mut stmt = self.conn.prepare("SELECT id, sheet_id, name, created_at FROM snapshots WHERE sheet_id = ?1 ORDER BY created_at DESC").map_err(sql)?;
        let rows = stmt
            .query_map([sheet_id], |r| Ok(SnapshotInfo { id: r.get(0)?, sheet_id: r.get(1)?, name: r.get(2)?, created_at: r.get(3)? }))
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn snapshot_sheet(&self, snapshot_id: &str) -> Result<Sheet> {
        let raw: Option<String> = self.conn.query_row("SELECT data FROM snapshots WHERE id = ?1", [snapshot_id], |r| r.get(0)).optional().map_err(sql)?;
        serde_json::from_str(&raw.ok_or("That snapshot no longer exists")?).map_err(|e| format!("The snapshot is damaged: {e}"))
    }

    pub fn delete_snapshot(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM snapshots WHERE id = ?1", [id]).map_err(sql)?;
        Ok(())
    }

    /// Screen settings kept with the project, like a simulation setup.
    pub fn setting(&self, key: &str) -> Result<Option<serde_json::Value>> {
        let raw: Option<String> = self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [format!("ui:{key}")], |r| r.get(0)).optional().map_err(sql)?;
        Ok(raw.and_then(|r| serde_json::from_str(&r).ok()))
    }

    pub fn set_setting(&self, key: &str, value: &serde_json::Value) -> Result<()> {
        self.conn
            .execute("INSERT INTO meta(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![format!("ui:{key}"), value.to_string()])
            .map_err(sql)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::tests::units;

    #[test]
    fn sheets_and_snapshots() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.balanceforge");
        let p = Project::create(&path, "Arena").unwrap();
        assert!(Project::create(&path, "again").is_err());
        let mut s = units();
        s.id = String::new();
        let saved = p.save_sheet(s).unwrap();
        assert!(!saved.id.is_empty());
        let mut second = units();
        second.id = String::new();
        second.name = "Bosses".into();
        p.save_sheet(second).unwrap();
        assert_eq!(p.sheets().unwrap().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Units", "Bosses"]);

        let snap = p.snapshot(&saved.id, "Patch 1.0").unwrap();
        let mut changed = saved.clone();
        changed.rows[0].values.insert("damage".into(), 45.into());
        p.save_sheet(changed).unwrap();
        assert_eq!(p.snapshot_sheet(&snap.id).unwrap().rows[0].values["damage"], 40);
        assert_eq!(p.snapshots(&saved.id).unwrap().len(), 1);
        assert!(p.snapshot(&saved.id, " ").is_err());

        let reopened = Project::open(&path).unwrap();
        assert_eq!(reopened.info().unwrap().name, "Arena");
        reopened.delete_sheet(&saved.id).unwrap();
        assert!(reopened.snapshots(&saved.id).unwrap().is_empty(), "snapshots go with their sheet");

        assert_eq!(reopened.setting("economy").unwrap(), None);
        reopened.set_setting("economy", &serde_json::json!({"players": 100})).unwrap();
        reopened.set_setting("economy", &serde_json::json!({"players": 200})).unwrap();
        assert_eq!(reopened.setting("economy").unwrap().unwrap()["players"], 200);
        assert_eq!(reopened.info().unwrap().name, "Arena", "settings don't touch project info");
    }

    #[test]
    fn rejects_bad_sheets() {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("b.balanceforge"), "Arena").unwrap();
        let mut s = units();
        s.name = " ".into();
        assert!(p.save_sheet(s).is_err());
        let mut s = units();
        s.columns[0].key = "max hp".into();
        assert!(p.save_sheet(s).is_err());
    }
}
