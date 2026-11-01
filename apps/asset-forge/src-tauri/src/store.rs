//! An Asset Forge project is one SQLite file. It points at the user's own
//! asset folders (files are never copied in) and holds what the library knows
//! about each file: type, size, tags, status, notes, versions and history.

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::kinds;
use crate::scan;

pub type Result<T> = std::result::Result<T, String>;

fn sql(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub const STATUSES: &[&str] = &["Placeholder", "WIP", "Review", "Approved", "Final"];
pub const DEFAULT_STATUS: &str = "WIP";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub path: String,
    pub added_at: i64,
    pub last_scan: Option<i64>,
    pub assets: i64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetSummary {
    pub id: String,
    pub folder_id: String,
    pub name: String,
    pub rel_path: String,
    /// Full path on disk, for previews.
    pub path: String,
    pub ext: String,
    pub file_type: String,
    pub category: String,
    pub status: String,
    pub size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub hash: String,
    pub missing: bool,
    /// Times the file is mentioned in the game project, once a usage scan has run.
    pub refs: Option<i64>,
    pub mtime: i64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub size: i64,
    pub hash: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub mtime: i64,
    pub recorded_at: i64,
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
pub struct Asset {
    #[serde(flatten)]
    pub summary: AssetSummary,
    pub author: String,
    pub notes: String,
    pub license: String,
    pub source: String,
    pub category_set: bool,
    pub added_at: i64,
    pub updated_at: i64,
    /// Tags the library added from folder names; the rest were added by hand.
    pub auto_tags: Vec<String>,
    pub versions: Vec<Version>,
    pub history: Vec<Event>,
    /// Other files with exactly the same content.
    pub duplicates: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssetQuery {
    pub text: Option<String>,
    pub category: Option<String>,
    pub status: Option<String>,
    pub file_type: Option<String>,
    pub tag: Option<String>,
    pub folder_id: Option<String>,
    pub missing: Option<bool>,
    /// Only these ids (e.g. the files a check flagged).
    pub ids: Option<Vec<String>>,
    /// "name" (default), "newest", "largest", "category", "path".
    pub sort: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub assets: Vec<AssetSummary>,
    pub total: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub total: i64,
    pub missing: i64,
    pub categories: BTreeMap<String, i64>,
    pub statuses: BTreeMap<String, i64>,
    pub file_types: BTreeMap<String, i64>,
    pub tags: Vec<(String, i64)>,
}

/// Changes to apply to one or many assets. Fields left out stay as they are.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AssetPatch {
    pub status: Option<String>,
    pub category: Option<String>,
    pub author: Option<String>,
    pub notes: Option<String>,
    pub license: Option<String>,
    pub source: Option<String>,
    pub add_tags: Vec<String>,
    pub remove_tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub folders: usize,
    pub total: usize,
    pub added: usize,
    pub changed: usize,
    pub moved: usize,
    pub missing: usize,
    pub returned: usize,
    pub errors: Vec<String>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at INTEGER NOT NULL, last_scan INTEGER);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  file_type TEXT NOT NULL,
  category TEXT NOT NULL,
  category_set INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  hash TEXT NOT NULL,
  width INTEGER, height INTEGER, duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'WIP',
  author TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  missing INTEGER NOT NULL DEFAULT 0,
  refs INTEGER,
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(folder_id, rel_path)
);
CREATE INDEX IF NOT EXISTS assets_category ON assets(category);
CREATE INDEX IF NOT EXISTS assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS assets_hash ON assets(hash);
CREATE TABLE IF NOT EXISTS tags (asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, tag TEXT NOT NULL, auto INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (asset_id, tag));
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE, size INTEGER NOT NULL, hash TEXT NOT NULL, width INTEGER, height INTEGER, mtime INTEGER NOT NULL, recorded_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, asset_id TEXT, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_asset ON events(asset_id);
CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, source_id TEXT, grp TEXT NOT NULL, name TEXT NOT NULL, slots TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED, name, path, tags, notes, tokenize = 'unicode61');
"#;

const SUMMARY_COLS: &str = "a.id, a.folder_id, a.name, a.rel_path, f.path, a.ext, a.file_type, a.category, a.status, a.size, a.width, a.height, a.duration_ms, a.hash, a.missing, a.refs, a.mtime, (SELECT group_concat(tag, char(31)) FROM (SELECT tag FROM tags t WHERE t.asset_id = a.id ORDER BY tag))";

fn join_path(folder: &str, rel: &str) -> String {
    let sep = if folder.contains('\\') { '\\' } else { '/' };
    let rel = if sep == '\\' { rel.replace('/', "\\") } else { rel.to_string() };
    if folder.ends_with(sep) {
        format!("{folder}{rel}")
    } else {
        format!("{folder}{sep}{rel}")
    }
}

fn summary_row(r: &rusqlite::Row) -> rusqlite::Result<AssetSummary> {
    let folder: String = r.get(4)?;
    let rel: String = r.get(3)?;
    let tags: Option<String> = r.get(17)?;
    Ok(AssetSummary {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        name: r.get(2)?,
        path: join_path(&folder, &rel),
        rel_path: rel,
        ext: r.get(5)?,
        file_type: r.get(6)?,
        category: r.get(7)?,
        status: r.get(8)?,
        size: r.get(9)?,
        width: r.get(10)?,
        height: r.get(11)?,
        duration_ms: r.get(12)?,
        hash: r.get(13)?,
        missing: r.get::<_, i64>(14)? != 0,
        refs: r.get(15)?,
        mtime: r.get(16)?,
        tags: tags.map(|t| t.split('\u{1f}').map(String::from).collect()).unwrap_or_default(),
    })
}

/// Words for the search index, so "knight walk" finds Characters/knight_walk_01.png.
fn search_words(text: &str) -> String {
    kinds::words(text).join(" ")
}

/// A safe FTS query: every word must match the start of an indexed word.
fn fts_query(text: &str) -> Option<String> {
    let w = kinds::words(text);
    if w.is_empty() {
        None
    } else {
        Some(w.iter().map(|x| format!("\"{x}\"*")).collect::<Vec<_>>().join(" "))
    }
}

pub fn clean_tag(t: &str) -> Option<String> {
    let t = t.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("-");
    if t.is_empty() || t.len() > 48 {
        None
    } else {
        Some(t)
    }
}

pub struct Project {
    pub conn: Connection,
}

impl Project {
    pub fn create(path: &Path, name: &str) -> Result<Project> {
        if path.exists() {
            return Err(format!("{} already exists", path.display()));
        }
        let p = Project::connect(path)?;
        let info = ProjectInfo { id: uuid::Uuid::new_v4().to_string(), name: name.trim().into(), created_at: now_ms() };
        p.conn.execute("INSERT INTO meta(key, value) VALUES ('project', ?1)", [serde_json::to_string(&info).unwrap()]).map_err(sql)?;
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
        // Scans and exports use their own connection, so wait for each other instead of failing.
        conn.busy_timeout(std::time::Duration::from_secs(10)).map_err(sql)?;
        conn.pragma_update(None, "journal_mode", "WAL").map_err(sql)?;
        conn.pragma_update(None, "foreign_keys", "ON").map_err(sql)?;
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Project { conn })
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        let raw: Option<String> = self.conn.query_row("SELECT value FROM meta WHERE key = 'project'", [], |r| r.get(0)).optional().map_err(sql)?;
        let raw = raw.ok_or("This file is not an Asset Forge project")?;
        serde_json::from_str(&raw).map_err(|e| format!("Project info is damaged: {e}"))
    }

    pub fn rename(&self, name: &str) -> Result<ProjectInfo> {
        let mut info = self.info()?;
        info.name = name.trim().into();
        self.conn.execute("UPDATE meta SET value = ?1 WHERE key = 'project'", [serde_json::to_string(&info).unwrap()]).map_err(sql)?;
        Ok(info)
    }

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

    // ------------------------------------------------------------ folders

    pub fn folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self
            .conn
            .prepare("SELECT f.id, f.path, f.added_at, f.last_scan, (SELECT COUNT(*) FROM assets a WHERE a.folder_id = f.id AND a.missing = 0) FROM folders f ORDER BY f.path")
            .map_err(sql)?;
        let rows = stmt
            .query_map([], |r| {
                let path: String = r.get(1)?;
                Ok(Folder { id: r.get(0)?, exists: Path::new(&path).is_dir(), path, added_at: r.get(2)?, last_scan: r.get(3)?, assets: r.get(4)? })
            })
            .map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    /// Adds a folder to watch. A folder inside (or around) one already added is refused, so files aren't listed twice.
    pub fn add_folder(&self, path: &Path) -> Result<Folder> {
        if !path.is_dir() {
            return Err(format!("{} is not a folder", path.display()));
        }
        let new = path.to_path_buf();
        for f in self.folders()? {
            let old = PathBuf::from(&f.path);
            if new == old {
                return Err("That folder is already in the library".into());
            }
            if new.starts_with(&old) {
                return Err(format!("That folder is already inside {}", f.path));
            }
            if old.starts_with(&new) {
                return Err(format!("{} is inside that folder. Remove it first, then add the bigger folder.", f.path));
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let path_s = path.to_string_lossy().to_string();
        let at = now_ms();
        self.conn.execute("INSERT INTO folders(id, path, added_at) VALUES (?1, ?2, ?3)", params![id, path_s, at]).map_err(sql)?;
        Ok(Folder { id, path: path_s, added_at: at, last_scan: None, assets: 0, exists: true })
    }

    /// Forgets a folder and everything the library knew about its files. Files on disk are untouched.
    pub fn remove_folder(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM search WHERE id IN (SELECT id FROM assets WHERE folder_id = ?1)", [id]).map_err(sql)?;
        self.conn.execute("DELETE FROM folders WHERE id = ?1", [id]).map_err(sql)?;
        Ok(())
    }

    // ------------------------------------------------------------ scanning

    /// Brings the library in line with every folder on disk.
    pub fn scan_all(&mut self, progress: &dyn Fn(usize, usize)) -> Result<ScanReport> {
        let folders = self.folders()?;
        let mut report = ScanReport { folders: folders.len(), ..Default::default() };
        for f in folders {
            match self.scan_folder(&f.id, Path::new(&f.path), progress) {
                Ok(r) => {
                    report.total += r.total;
                    report.added += r.added;
                    report.changed += r.changed;
                    report.moved += r.moved;
                    report.missing += r.missing;
                    report.returned += r.returned;
                    report.errors.extend(r.errors);
                }
                Err(e) => report.errors.push(format!("{}: {e}", f.path)),
            }
        }
        Ok(report)
    }

    pub fn scan_folder(&mut self, folder_id: &str, root: &Path, progress: &dyn Fn(usize, usize)) -> Result<ScanReport> {
        let disk = scan::walk(root).map_err(|e| e.to_string())?;
        let mut report = ScanReport { folders: 1, total: disk.len(), ..Default::default() };

        struct Known {
            id: String,
            size: i64,
            mtime: i64,
            hash: String,
            missing: bool,
            width: Option<i64>,
            height: Option<i64>,
        }
        let mut known: HashMap<String, Known> = HashMap::new();
        {
            let mut stmt = self.conn.prepare("SELECT rel_path, id, size, mtime, hash, missing, width, height FROM assets WHERE folder_id = ?1").map_err(sql)?;
            let rows = stmt
                .query_map([folder_id], |r| {
                    Ok((r.get::<_, String>(0)?, Known { id: r.get(1)?, size: r.get(2)?, mtime: r.get(3)?, hash: r.get(4)?, missing: r.get::<_, i64>(5)? != 0, width: r.get(6)?, height: r.get(7)? }))
                })
                .map_err(sql)?;
            for row in rows {
                let (p, k) = row.map_err(sql)?;
                known.insert(p, k);
            }
        }
        let on_disk: std::collections::HashSet<&str> = disk.iter().map(|d| d.rel_path.as_str()).collect();
        // Files the library knew that are gone from their old path: candidates for a move.
        let mut gone_by_hash: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for (p, k) in &known {
            if !on_disk.contains(p.as_str()) && !k.hash.is_empty() {
                gone_by_hash.entry(k.hash.clone()).or_default().push((p.clone(), k.id.clone()));
            }
        }

        let now = now_ms();
        let tx = self.conn.transaction().map_err(sql)?;
        for (i, d) in disk.iter().enumerate() {
            if i % 200 == 0 {
                progress(i, disk.len());
            }
            let full = root.join(&d.rel_path);
            let name = d.rel_path.rsplit('/').next().unwrap_or(&d.rel_path).to_string();
            let ext = name.rsplit_once('.').map(|(_, e)| e.to_string()).unwrap_or_default();
            let ft = kinds::file_type(&ext);
            if let Some(k) = known.get(&d.rel_path) {
                if k.missing {
                    report.returned += 1;
                    tx.execute("UPDATE assets SET missing = 0 WHERE id = ?1", [&k.id]).map_err(sql)?;
                }
                if k.size == d.size as i64 && k.mtime == d.mtime {
                    continue;
                }
                let hash = match scan::hash(&full) {
                    Ok(h) => h,
                    Err(e) => {
                        report.errors.push(format!("{}: {e}", d.rel_path));
                        continue;
                    }
                };
                if hash != k.hash {
                    let det = scan::details(&full, ft);
                    tx.execute(
                        "INSERT INTO versions(asset_id, size, hash, width, height, mtime, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        params![k.id, k.size, k.hash, k.width, k.height, k.mtime, now],
                    )
                    .map_err(sql)?;
                    tx.execute(
                        "UPDATE assets SET size = ?2, mtime = ?3, hash = ?4, width = ?5, height = ?6, duration_ms = ?7, updated_at = ?8 WHERE id = ?1",
                        params![k.id, d.size as i64, d.mtime, hash, det.width, det.height, det.duration_ms.map(|x| x as i64), now],
                    )
                    .map_err(sql)?;
                    log(&tx, Some(&k.id), "Changed on disk", &format!("{} → {}", human_size(k.size), human_size(d.size as i64)))?;
                    report.changed += 1;
                } else {
                    tx.execute("UPDATE assets SET mtime = ?2 WHERE id = ?1", params![k.id, d.mtime]).map_err(sql)?;
                }
                continue;
            }

            let hash = match scan::hash(&full) {
                Ok(h) => h,
                Err(e) => {
                    report.errors.push(format!("{}: {e}", d.rel_path));
                    continue;
                }
            };
            // Same content as a file that vanished: it was moved or renamed outside Asset Forge.
            if let Some((old_path, id)) = gone_by_hash.get_mut(&hash).and_then(|v| v.pop()) {
                tx.execute(
                    "UPDATE assets SET rel_path = ?2, name = ?3, ext = ?4, mtime = ?5, missing = 0, updated_at = ?6 WHERE id = ?1",
                    params![id, d.rel_path, name, ext, d.mtime, now],
                )
                .map_err(sql)?;
                log(&tx, Some(&id), "Moved", &format!("{old_path} → {}", d.rel_path))?;
                reindex(&tx, &id)?;
                known.remove(&old_path);
                report.moved += 1;
                continue;
            }

            let det = scan::details(&full, ft);
            let category = kinds::guess_category(&d.rel_path, ft, det.duration_ms, d.size);
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO assets(id, folder_id, rel_path, name, ext, file_type, category, size, mtime, hash, width, height, duration_ms, status, added_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                params![id, folder_id, d.rel_path, name, ext, ft.as_str(), category, d.size as i64, d.mtime, hash, det.width, det.height, det.duration_ms.map(|x| x as i64), DEFAULT_STATUS, now],
            )
            .map_err(sql)?;
            for t in kinds::folder_tags(&d.rel_path) {
                tx.execute("INSERT OR IGNORE INTO tags(asset_id, tag, auto) VALUES (?1, ?2, 1)", params![id, t]).map_err(sql)?;
            }
            reindex(&tx, &id)?;
            report.added += 1;
        }

        for (p, k) in &known {
            if !on_disk.contains(p.as_str()) && !k.missing {
                tx.execute("UPDATE assets SET missing = 1 WHERE id = ?1", [&k.id]).map_err(sql)?;
                log(&tx, Some(&k.id), "Missing", "The file is no longer in its folder")?;
                report.missing += 1;
            }
        }
        tx.execute("UPDATE folders SET last_scan = ?2 WHERE id = ?1", params![folder_id, now]).map_err(sql)?;
        tx.commit().map_err(sql)?;
        progress(disk.len(), disk.len());
        Ok(report)
    }

    // ------------------------------------------------------------ browsing

    fn where_clause(q: &AssetQuery) -> (String, Vec<rusqlite::types::Value>) {
        use rusqlite::types::Value as V;
        let mut parts: Vec<String> = Vec::new();
        let mut args: Vec<V> = Vec::new();
        if let Some(text) = q.text.as_deref().and_then(fts_query) {
            parts.push("a.id IN (SELECT id FROM search WHERE search MATCH ?)".into());
            args.push(V::Text(text));
        }
        for (col, val) in [("a.category", &q.category), ("a.status", &q.status), ("a.file_type", &q.file_type), ("a.folder_id", &q.folder_id)] {
            if let Some(v) = val.as_deref().filter(|v| !v.is_empty()) {
                parts.push(format!("{col} = ?"));
                args.push(V::Text(v.to_string()));
            }
        }
        if let Some(t) = q.tag.as_deref().filter(|v| !v.is_empty()) {
            parts.push("a.id IN (SELECT asset_id FROM tags WHERE tag = ?)".into());
            args.push(V::Text(t.to_string()));
        }
        if let Some(m) = q.missing {
            parts.push(format!("a.missing = {}", m as i64));
        }
        if let Some(ids) = &q.ids {
            if ids.is_empty() {
                parts.push("0".into());
            } else {
                parts.push(format!("a.id IN ({})", vec!["?"; ids.len()].join(",")));
                args.extend(ids.iter().map(|i| V::Text(i.clone())));
            }
        }
        let w = if parts.is_empty() { String::new() } else { format!("WHERE {}", parts.join(" AND ")) };
        (w, args)
    }

    pub fn list(&self, q: &AssetQuery) -> Result<Page> {
        let (w, args) = Project::where_clause(q);
        let order = match q.sort.as_deref() {
            Some("newest") => "a.mtime DESC",
            Some("largest") => "a.size DESC",
            Some("category") => "a.category, a.name COLLATE NOCASE",
            Some("path") => "f.path, a.rel_path COLLATE NOCASE",
            _ => "a.name COLLATE NOCASE",
        };
        let total: i64 = self
            .conn
            .query_row(&format!("SELECT COUNT(*) FROM assets a {w}"), params_from_iter(args.iter()), |r| r.get(0))
            .map_err(sql)?;
        let limit = q.limit.unwrap_or(200).clamp(1, 5000);
        let offset = q.offset.unwrap_or(0).max(0);
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {SUMMARY_COLS} FROM assets a JOIN folders f ON f.id = a.folder_id {w} ORDER BY {order} LIMIT {limit} OFFSET {offset}"))
            .map_err(sql)?;
        let rows = stmt.query_map(params_from_iter(args.iter()), summary_row).map_err(sql)?;
        Ok(Page { assets: rows.collect::<std::result::Result<_, _>>().map_err(sql)?, total })
    }

    pub fn summaries(&self, ids: &[String]) -> Result<Vec<AssetSummary>> {
        Ok(self.list(&AssetQuery { ids: Some(ids.to_vec()), limit: Some(5000), ..Default::default() })?.assets)
    }

    /// Every asset, for checks and exports.
    pub fn all(&self) -> Result<Vec<AssetSummary>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {SUMMARY_COLS} FROM assets a JOIN folders f ON f.id = a.folder_id ORDER BY a.rel_path")).map_err(sql)?;
        let rows = stmt.query_map([], summary_row).map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    pub fn facets(&self) -> Result<Facets> {
        let mut f = Facets::default();
        f.total = self.conn.query_row("SELECT COUNT(*) FROM assets WHERE missing = 0", [], |r| r.get(0)).map_err(sql)?;
        f.missing = self.conn.query_row("SELECT COUNT(*) FROM assets WHERE missing = 1", [], |r| r.get(0)).map_err(sql)?;
        for (col, map) in [("category", &mut f.categories), ("status", &mut f.statuses), ("file_type", &mut f.file_types)] {
            let mut stmt = self.conn.prepare(&format!("SELECT {col}, COUNT(*) FROM assets WHERE missing = 0 GROUP BY {col}")).map_err(sql)?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(sql)?;
            for row in rows {
                let (k, n) = row.map_err(sql)?;
                map.insert(k, n);
            }
        }
        let mut stmt = self.conn.prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY COUNT(*) DESC, tag LIMIT 300").map_err(sql)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).map_err(sql)?;
        f.tags = rows.collect::<std::result::Result<_, _>>().map_err(sql)?;
        Ok(f)
    }

    pub fn get(&self, id: &str) -> Result<Asset> {
        let summary = self.summaries(&[id.to_string()])?.pop().ok_or("That asset is no longer in the library")?;
        let (author, notes, license, source, category_set, added_at, updated_at): (String, String, String, String, i64, i64, i64) = self
            .conn
            .query_row("SELECT author, notes, license, source, category_set, added_at, updated_at FROM assets WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })
            .map_err(sql)?;
        let mut stmt = self.conn.prepare("SELECT tag FROM tags WHERE asset_id = ?1 AND auto = 1 ORDER BY tag").map_err(sql)?;
        let auto_tags = stmt.query_map([id], |r| r.get(0)).map_err(sql)?.collect::<std::result::Result<_, _>>().map_err(sql)?;
        let mut stmt = self.conn.prepare("SELECT size, hash, width, height, mtime, recorded_at FROM versions WHERE asset_id = ?1 ORDER BY recorded_at DESC, id DESC").map_err(sql)?;
        let versions = stmt
            .query_map([id], |r| Ok(Version { size: r.get(0)?, hash: r.get(1)?, width: r.get(2)?, height: r.get(3)?, mtime: r.get(4)?, recorded_at: r.get(5)? }))
            .map_err(sql)?
            .collect::<std::result::Result<_, _>>()
            .map_err(sql)?;
        let mut stmt = self.conn.prepare("SELECT at, action, detail FROM events WHERE asset_id = ?1 ORDER BY at DESC, id DESC LIMIT 100").map_err(sql)?;
        let history = stmt
            .query_map([id], |r| Ok(Event { at: r.get(0)?, action: r.get(1)?, detail: r.get(2)? }))
            .map_err(sql)?
            .collect::<std::result::Result<_, _>>()
            .map_err(sql)?;
        let mut stmt = self.conn.prepare("SELECT id FROM assets WHERE hash = ?1 AND id != ?2 AND missing = 0 AND size > 0").map_err(sql)?;
        let duplicates = stmt.query_map(params![summary.hash, id], |r| r.get(0)).map_err(sql)?.collect::<std::result::Result<_, _>>().map_err(sql)?;
        Ok(Asset { summary, author, notes, license, source, category_set: category_set != 0, added_at, updated_at, auto_tags, versions, history, duplicates })
    }

    /// Applies the same change to every asset in `ids`. Returns how many changed.
    pub fn update(&mut self, ids: &[String], patch: &AssetPatch) -> Result<usize> {
        if let Some(s) = &patch.status {
            if !STATUSES.contains(&s.as_str()) {
                return Err(format!("Unknown status \"{s}\""));
            }
        }
        if let Some(c) = &patch.category {
            if !kinds::CATEGORIES.contains(&c.as_str()) {
                return Err(format!("Unknown category \"{c}\""));
            }
        }
        let now = now_ms();
        let tx = self.conn.transaction().map_err(sql)?;
        let mut n = 0;
        for id in ids {
            let old: Option<(String, String)> = tx.query_row("SELECT status, category FROM assets WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(sql)?;
            let Some((old_status, old_cat)) = old else { continue };
            if let Some(s) = &patch.status {
                if *s != old_status {
                    tx.execute("UPDATE assets SET status = ?2 WHERE id = ?1", params![id, s]).map_err(sql)?;
                    log(&tx, Some(id), "Status", &format!("{old_status} → {s}"))?;
                }
            }
            if let Some(c) = &patch.category {
                if *c != old_cat {
                    tx.execute("UPDATE assets SET category = ?2, category_set = 1 WHERE id = ?1", params![id, c]).map_err(sql)?;
                    log(&tx, Some(id), "Category", &format!("{old_cat} → {c}"))?;
                }
            }
            for (col, val) in [("author", &patch.author), ("notes", &patch.notes), ("license", &patch.license), ("source", &patch.source)] {
                if let Some(v) = val {
                    tx.execute(&format!("UPDATE assets SET {col} = ?2 WHERE id = ?1"), params![id, v.trim()]).map_err(sql)?;
                }
            }
            for t in patch.add_tags.iter().filter_map(|t| clean_tag(t)) {
                // Adding a tag by hand makes it a manual tag, even if it was automatic.
                tx.execute("INSERT INTO tags(asset_id, tag, auto) VALUES (?1, ?2, 0) ON CONFLICT DO UPDATE SET auto = 0", params![id, t]).map_err(sql)?;
            }
            for t in &patch.remove_tags {
                tx.execute("DELETE FROM tags WHERE asset_id = ?1 AND tag = ?2", params![id, t]).map_err(sql)?;
            }
            tx.execute("UPDATE assets SET updated_at = ?2 WHERE id = ?1", params![id, now]).map_err(sql)?;
            reindex(&tx, id)?;
            n += 1;
        }
        tx.commit().map_err(sql)?;
        Ok(n)
    }

    /// Forgets assets whose files are missing. Files on disk are untouched.
    pub fn forget(&self, ids: &[String]) -> Result<usize> {
        let mut n = 0;
        for id in ids {
            self.conn.execute("DELETE FROM search WHERE id = ?1", [id]).map_err(sql)?;
            n += self.conn.execute("DELETE FROM assets WHERE id = ?1 AND missing = 1", [id]).map_err(sql)?;
        }
        Ok(n)
    }

    pub fn log(&self, asset_id: Option<&str>, action: &str, detail: &str) -> Result<()> {
        self.conn
            .execute("INSERT INTO events(asset_id, at, action, detail) VALUES (?1, ?2, ?3, ?4)", params![asset_id, now_ms(), action, detail])
            .map_err(sql)?;
        Ok(())
    }

    /// Project-wide history (exports, renames...), newest first.
    pub fn activity(&self, limit: i64) -> Result<Vec<(Option<String>, Event)>> {
        let mut stmt = self.conn.prepare("SELECT asset_id, at, action, detail FROM events ORDER BY at DESC, id DESC LIMIT ?1").map_err(sql)?;
        let rows = stmt.query_map([limit], |r| Ok((r.get(0)?, Event { at: r.get(1)?, action: r.get(2)?, detail: r.get(3)? }))).map_err(sql)?;
        rows.collect::<std::result::Result<_, _>>().map_err(sql)
    }

    /// Records how often each asset is referenced in the game project. Assets not in `counts` get 0.
    pub fn set_refs(&mut self, counts: &HashMap<String, i64>) -> Result<()> {
        let tx = self.conn.transaction().map_err(sql)?;
        tx.execute("UPDATE assets SET refs = 0", []).map_err(sql)?;
        for (id, n) in counts {
            tx.execute("UPDATE assets SET refs = ?2 WHERE id = ?1", params![id, n]).map_err(sql)?;
        }
        tx.commit().map_err(sql)?;
        Ok(())
    }

    /// Points an asset at a new file name after a rename on disk.
    pub fn renamed(&self, id: &str, new_rel: &str) -> Result<()> {
        let name = new_rel.rsplit('/').next().unwrap_or(new_rel).to_string();
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_string()).unwrap_or_default();
        let old: String = self.conn.query_row("SELECT name FROM assets WHERE id = ?1", [id], |r| r.get(0)).map_err(sql)?;
        self.conn
            .execute("UPDATE assets SET rel_path = ?2, name = ?3, ext = ?4, updated_at = ?5 WHERE id = ?1", params![id, new_rel, name, ext, now_ms()])
            .map_err(sql)?;
        self.log(Some(id), "Renamed", &format!("{old} → {name}"))?;
        let tx = self.conn.unchecked_transaction().map_err(sql)?;
        reindex(&tx, id)?;
        tx.commit().map_err(sql)
    }
}

fn log(tx: &Transaction, asset_id: Option<&str>, action: &str, detail: &str) -> Result<()> {
    tx.execute("INSERT INTO events(asset_id, at, action, detail) VALUES (?1, ?2, ?3, ?4)", params![asset_id, now_ms(), action, detail]).map_err(sql)?;
    Ok(())
}

fn reindex(tx: &Transaction, id: &str) -> Result<()> {
    tx.execute("DELETE FROM search WHERE id = ?1", [id]).map_err(sql)?;
    tx.execute(
        "INSERT INTO search(id, name, path, tags, notes)
         SELECT a.id, ?2, ?3, COALESCE((SELECT group_concat(tag, ' ') FROM tags WHERE asset_id = a.id), ''), a.notes || ' ' || a.author || ' ' || a.category || ' ' || a.status
         FROM assets a WHERE a.id = ?1",
        params![
            id,
            tx.query_row("SELECT name FROM assets WHERE id = ?1", [id], |r| r.get::<_, String>(0)).map(|n| search_words(&n)).map_err(sql)?,
            tx.query_row("SELECT rel_path FROM assets WHERE id = ?1", [id], |r| r.get::<_, String>(0)).map(|n| search_words(&n)).map_err(sql)?,
        ],
    )
    .map_err(sql)?;
    Ok(())
}

pub fn human_size(bytes: i64) -> String {
    let b = bytes as f64;
    if b >= 1e9 {
        format!("{:.1} GB", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.1} MB", b / 1e6)
    } else if b >= 1e3 {
        format!("{:.0} KB", b / 1e3)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::scan::tests::{write_png, write_wav};
    use std::fs;

    pub fn sample() -> (tempfile::TempDir, Project, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("game");
        write_png(&root.join("Characters/knight_walk_01.png"), 32, 32, 1);
        write_png(&root.join("Characters/knight_walk_02.png"), 32, 32, 2);
        write_png(&root.join("Characters/knight_walk_04.png"), 32, 32, 3);
        write_png(&root.join("Characters/knight_copy.png"), 32, 32, 1);
        write_png(&root.join("UI/icons/sword.png"), 16, 16, 4);
        write_png(&root.join("UI/icons/shield.png"), 16, 16, 5);
        write_png(&root.join("UI/icons/bow.png"), 16, 16, 6);
        write_png(&root.join("UI/icons/Big Axe.png"), 18, 16, 7);
        write_wav(&root.join("Audio/sfx/hit.wav"), 400);
        let mut p = Project::create(&dir.path().join("lib.assetforge"), "Test").unwrap();
        let f = p.add_folder(&root).unwrap();
        p.scan_all(&|_, _| {}).unwrap();
        (dir, p, f.id)
    }

    #[test]
    fn scans_and_tracks_changes() {
        let (dir, mut p, _) = sample();
        let root = dir.path().join("game");
        let fac = p.facets().unwrap();
        assert_eq!(fac.total, 9);
        assert_eq!(fac.categories["Icon"], 4);
        assert_eq!(fac.categories["Animation"], 3);
        assert_eq!(fac.categories["SFX"], 1);
        assert!(fac.tags.iter().any(|(t, _)| t == "characters"));

        // Nothing changed: a rescan is a no-op.
        let r = p.scan_all(&|_, _| {}).unwrap();
        assert_eq!((r.added, r.changed, r.moved, r.missing), (0, 0, 0, 0));

        // Edit, move, delete and add files on disk.
        write_png(&root.join("UI/icons/sword.png"), 24, 24, 9);
        fs::rename(root.join("UI/icons/shield.png"), root.join("UI/icons/shield_wood.png")).unwrap();
        fs::remove_file(root.join("UI/icons/bow.png")).unwrap();
        write_png(&root.join("UI/icons/potion.png"), 16, 16, 10);
        // Some file systems keep the same mtime for a quick rewrite; force a different one.
        let sword = p.list(&AssetQuery { text: Some("sword".into()), ..Default::default() }).unwrap().assets.pop().unwrap();
        p.conn.execute("UPDATE assets SET mtime = 1 WHERE id = ?1", [&sword.id]).unwrap();

        let r = p.scan_all(&|_, _| {}).unwrap();
        assert_eq!((r.added, r.changed, r.moved, r.missing), (1, 1, 1, 1), "{r:?}");

        let a = p.get(&sword.id).unwrap();
        assert_eq!(a.summary.width, Some(24));
        assert_eq!(a.versions.len(), 1);
        assert_eq!(a.versions[0].width, Some(16));
        let moved = p.list(&AssetQuery { text: Some("shield wood".into()), ..Default::default() }).unwrap();
        assert_eq!(moved.total, 1);
        assert!(p.get(&moved.assets[0].id).unwrap().history.iter().any(|e| e.action == "Moved"));
        assert_eq!(p.list(&AssetQuery { missing: Some(true), ..Default::default() }).unwrap().total, 1);

        // The deleted file comes back.
        write_png(&root.join("UI/icons/bow.png"), 16, 16, 6);
        assert_eq!(p.scan_all(&|_, _| {}).unwrap().returned, 1);
    }

    #[test]
    fn filters_tags_and_bulk_edits() {
        let (_dir, mut p, folder) = sample();
        let icons = p.list(&AssetQuery { category: Some("Icon".into()), sort: Some("name".into()), ..Default::default() }).unwrap();
        assert_eq!(icons.assets.iter().map(|a| a.name.as_str()).collect::<Vec<_>>(), ["Big Axe.png", "bow.png", "shield.png", "sword.png"]);
        let ids: Vec<String> = icons.assets.iter().map(|a| a.id.clone()).collect();
        let n = p.update(&ids, &AssetPatch { status: Some("Approved".into()), add_tags: vec!["Inventory Items".into()], ..Default::default() }).unwrap();
        assert_eq!(n, 4);
        assert_eq!(p.facets().unwrap().statuses["Approved"], 4);
        assert_eq!(p.list(&AssetQuery { tag: Some("inventory-items".into()), ..Default::default() }).unwrap().total, 4);
        assert_eq!(p.list(&AssetQuery { text: Some("inventory".into()), ..Default::default() }).unwrap().total, 4, "tags are searchable");
        assert!(p.update(&ids, &AssetPatch { status: Some("Done-ish".into()), ..Default::default() }).is_err());

        let page = p.list(&AssetQuery { limit: Some(3), offset: Some(3), ..Default::default() }).unwrap();
        assert_eq!((page.total, page.assets.len()), (9, 3));

        let a = p.get(&ids[0]).unwrap();
        assert!(a.history.iter().any(|e| e.action == "Status"));
        let knight = p.list(&AssetQuery { text: Some("knight walk 01".into()), ..Default::default() }).unwrap().assets.pop().unwrap();
        assert_eq!(p.get(&knight.id).unwrap().duplicates.len(), 1, "knight_copy has the same pixels");

        assert!(p.add_folder(&PathBuf::from(&p.folders().unwrap()[0].path).join("UI")).is_err(), "no nested folders");
        p.remove_folder(&folder).unwrap();
        assert_eq!(p.facets().unwrap().total, 0);
    }
}
