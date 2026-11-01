//! A Forge Core project is one SQLite file. This module owns its schema and
//! every read and write: entries, tags, links, version history and search.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const SCHEMA_VERSION: i64 = 1;

/// The modules in the first version. The UI defines each module's fields.
pub const KINDS: [&str; 6] = ["lore", "quest", "zone", "mob", "item", "skill"];

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub to_id: String,
    /// What the link means, e.g. "relatedQuests" or "questGiver".
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub kind: String,
    pub name: String,
    /// The module's own type list, e.g. "Religion" for lore or "Boss" for a mob.
    #[serde(default)]
    pub entity_type: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub summary: String,
    /// Long description, Markdown.
    #[serde(default)]
    pub body: String,
    /// Module-specific fields (health, rewards, level range...).
    #[serde(default)]
    pub fields: Map<String, Value>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub links: Vec<Link>,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub version: i64,
}

/// One row in a list or search result.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EntitySummary {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub entity_type: String,
    pub status: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub fields: Map<String, Value>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub from_id: String,
    pub from_name: String,
    pub from_kind: String,
    pub relation: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub version: i64,
    pub saved_at: i64,
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    pub kind: Option<String>,
    /// Free text. Matches whole words and word starts ("drag" finds "Dragon").
    pub text: Option<String>,
    pub tag: Option<String>,
    pub status: Option<String>,
    pub entity_type: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug)]
pub enum DbError {
    Sql(rusqlite::Error),
    Invalid(String),
    NotFound(String),
}

impl std::fmt::Display for DbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DbError::Sql(e) => write!(f, "Database error: {e}"),
            DbError::Invalid(m) | DbError::NotFound(m) => write!(f, "{m}"),
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sql(e)
    }
}

pub type Result<T> = std::result::Result<T, DbError>;

pub struct Project {
    conn: Connection,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS entities_kind ON entities(kind, name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS tags (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  tag TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (entity_id, tag)
);
CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
CREATE TABLE IF NOT EXISTS links (
  from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  PRIMARY KEY (from_id, to_id, relation)
);
CREATE INDEX IF NOT EXISTS links_to ON links(to_id);
CREATE TABLE IF NOT EXISTS versions (
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (entity_id, version)
);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  id UNINDEXED, name, summary, body, tags, fields,
  tokenize = 'unicode61 remove_diacritics 2'
);
"#;

fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for t in tags {
        let t = t.trim();
        if !t.is_empty() && seen.insert(t.to_lowercase()) {
            out.push(t.to_string());
        }
    }
    out
}

/// Text from field values, so "Fire" in a Resistances field is searchable.
fn fields_text(fields: &Map<String, Value>) -> String {
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => out.push(s.clone()),
            Value::Number(n) => out.push(n.to_string()),
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o.values().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    fields.values().for_each(|v| walk(v, &mut out));
    out.join(" ")
}

/// Turns what the user typed into a safe FTS5 query: each word becomes a
/// quoted prefix match, so punctuation can't break the query.
pub fn fts_query(text: &str) -> Option<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

impl Project {
    pub fn create(path: &Path, name: &str) -> Result<Project> {
        if path.exists() {
            return Err(DbError::Invalid(format!("{} already exists", path.display())));
        }
        let p = Project::open_unchecked(path)?;
        let info = ProjectInfo { id: uuid::Uuid::new_v4().to_string(), name: name.trim().to_string(), created_at: now_ms() };
        p.conn.execute(
            "INSERT INTO meta(key, value) VALUES ('project', ?1), ('schema', ?2)",
            params![serde_json::to_string(&info).unwrap(), SCHEMA_VERSION.to_string()],
        )?;
        Ok(p)
    }

    pub fn open(path: &Path) -> Result<Project> {
        if !path.is_file() {
            return Err(DbError::NotFound(format!("No project file at {}", path.display())));
        }
        let p = Project::open_unchecked(path)?;
        p.info()?;
        Ok(p)
    }

    fn open_unchecked(path: &Path) -> Result<Project> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Project { conn })
    }

    pub fn info(&self) -> Result<ProjectInfo> {
        let raw: Option<String> =
            self.conn.query_row("SELECT value FROM meta WHERE key = 'project'", [], |r| r.get(0)).optional()?;
        let raw = raw.ok_or_else(|| DbError::Invalid("This file is not a Forge Core project".into()))?;
        serde_json::from_str(&raw).map_err(|e| DbError::Invalid(format!("Project info is damaged: {e}")))
    }

    pub fn rename(&self, name: &str) -> Result<ProjectInfo> {
        let mut info = self.info()?;
        info.name = name.trim().to_string();
        self.conn.execute("UPDATE meta SET value = ?1 WHERE key = 'project'", params![serde_json::to_string(&info).unwrap()])?;
        Ok(info)
    }

    /// Creates or updates an entry. An update keeps the previous state in the
    /// version history. Returns the saved entry.
    pub fn save(&mut self, mut e: Entity) -> Result<Entity> {
        e.name = e.name.trim().to_string();
        if e.name.is_empty() {
            return Err(DbError::Invalid("Every entry needs a name".into()));
        }
        if !KINDS.contains(&e.kind.as_str()) {
            return Err(DbError::Invalid(format!("Unknown module \"{}\"", e.kind)));
        }
        e.tags = clean_tags(&e.tags);
        let mut seen = BTreeSet::new();
        e.links.retain(|l| !l.to_id.is_empty() && l.to_id != e.id && seen.insert((l.to_id.clone(), l.relation.clone())));

        let tx = self.conn.transaction()?;
        for l in &e.links {
            let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1)", [&l.to_id], |r| r.get(0))?;
            if !exists {
                return Err(DbError::Invalid(format!("Linked entry {} no longer exists", l.to_id)));
            }
        }

        let now = now_ms();
        let previous = if e.id.is_empty() { None } else { get_in(&tx, &e.id)? };
        match previous {
            Some(prev) => {
                if prev.kind != e.kind {
                    return Err(DbError::Invalid("An entry can't move to another module".into()));
                }
                tx.execute(
                    "INSERT INTO versions(entity_id, version, saved_at, snapshot) VALUES (?1, ?2, ?3, ?4)",
                    params![prev.id, prev.version, prev.updated_at, serde_json::to_string(&prev).unwrap()],
                )?;
                e.created_at = prev.created_at;
                e.version = prev.version + 1;
            }
            None => {
                if e.id.is_empty() {
                    e.id = uuid::Uuid::new_v4().to_string();
                }
                e.created_at = if e.created_at > 0 { e.created_at } else { now };
                e.version = 1;
            }
        }
        e.updated_at = now;

        tx.execute(
            "INSERT INTO entities(id, kind, name, entity_type, status, author, summary, body, fields, created_at, updated_at, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, entity_type=excluded.entity_type, status=excluded.status,
               author=excluded.author, summary=excluded.summary, body=excluded.body, fields=excluded.fields,
               updated_at=excluded.updated_at, version=excluded.version",
            params![
                e.id, e.kind, e.name, e.entity_type, e.status, e.author, e.summary, e.body,
                Value::Object(e.fields.clone()).to_string(), e.created_at, e.updated_at, e.version
            ],
        )?;
        tx.execute("DELETE FROM tags WHERE entity_id = ?1", [&e.id])?;
        for t in &e.tags {
            tx.execute("INSERT INTO tags(entity_id, tag) VALUES (?1, ?2)", params![e.id, t])?;
        }
        tx.execute("DELETE FROM links WHERE from_id = ?1", [&e.id])?;
        for l in &e.links {
            tx.execute("INSERT INTO links(from_id, to_id, relation) VALUES (?1, ?2, ?3)", params![e.id, l.to_id, l.relation])?;
        }
        index(&tx, &e)?;
        tx.commit()?;
        Ok(e)
    }

    pub fn get(&self, id: &str) -> Result<Entity> {
        get_in(&self.conn, id)?.ok_or_else(|| DbError::NotFound(format!("No entry with id {id}")))
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM entities WHERE id = ?1", [id])?;
        tx.execute("DELETE FROM search WHERE id = ?1", [id])?;
        tx.commit()?;
        if n == 0 {
            return Err(DbError::NotFound(format!("No entry with id {id}")));
        }
        Ok(())
    }

    pub fn list(&self, q: &ListQuery) -> Result<Vec<EntitySummary>> {
        let mut sql = String::from(
            "SELECT e.id, e.kind, e.name, e.entity_type, e.status, e.summary, e.fields, e.updated_at FROM entities e",
        );
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        let fts = q.text.as_deref().and_then(fts_query);
        if let Some(f) = &fts {
            sql.push_str(" JOIN search ON search.id = e.id");
            args.push(Box::new(f.clone()));
            conds.push(format!("search MATCH ?{}", args.len()));
        }
        if let Some(k) = q.kind.as_ref().filter(|s| !s.is_empty()) {
            args.push(Box::new(k.clone()));
            conds.push(format!("e.kind = ?{}", args.len()));
        }
        if let Some(t) = q.tag.as_ref().filter(|s| !s.is_empty()) {
            args.push(Box::new(t.clone()));
            conds.push(format!("EXISTS(SELECT 1 FROM tags t WHERE t.entity_id = e.id AND t.tag = ?{})", args.len()));
        }
        if let Some(s) = q.status.as_ref().filter(|s| !s.is_empty()) {
            args.push(Box::new(s.clone()));
            conds.push(format!("e.status = ?{}", args.len()));
        }
        if let Some(t) = q.entity_type.as_ref().filter(|s| !s.is_empty()) {
            args.push(Box::new(t.clone()));
            conds.push(format!("e.entity_type = ?{}", args.len()));
        }
        if !conds.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conds.join(" AND "));
        }
        sql.push_str(if fts.is_some() { " ORDER BY bm25(search, 0, 10, 4, 1, 6, 2)" } else { " ORDER BY e.name COLLATE NOCASE" });
        args.push(Box::new(q.limit.unwrap_or(5000).clamp(1, 100_000)));
        sql.push_str(&format!(" LIMIT ?{}", args.len()));

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(args.iter().map(|b| b.as_ref())), |r| {
            let fields: String = r.get(6)?;
            Ok(EntitySummary {
                id: r.get(0)?,
                kind: r.get(1)?,
                name: r.get(2)?,
                entity_type: r.get(3)?,
                status: r.get(4)?,
                summary: r.get(5)?,
                tags: Vec::new(),
                fields: serde_json::from_str(&fields).unwrap_or_default(),
                updated_at: r.get(7)?,
            })
        })?;
        let mut out = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        let mut tag_stmt = self.conn.prepare_cached("SELECT tag FROM tags WHERE entity_id = ?1 ORDER BY tag")?;
        for s in &mut out {
            s.tags = tag_stmt.query_map([&s.id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        }
        Ok(out)
    }

    /// Entries that link to this one.
    pub fn backlinks(&self, id: &str) -> Result<Vec<Backlink>> {
        let mut stmt = self.conn.prepare(
            "SELECT l.from_id, e.name, e.kind, l.relation FROM links l JOIN entities e ON e.id = l.from_id
             WHERE l.to_id = ?1 ORDER BY e.kind, e.name COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([id], |r| {
            Ok(Backlink { from_id: r.get(0)?, from_name: r.get(1)?, from_kind: r.get(2)?, relation: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Every tag in the project with how many entries use it.
    pub fn tags(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag COLLATE NOCASE ORDER BY tag COLLATE NOCASE")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Entry count per module.
    pub fn counts(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare("SELECT kind, COUNT(*) FROM entities GROUP BY kind")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn versions(&self, id: &str) -> Result<Vec<VersionInfo>> {
        let mut stmt = self.conn.prepare("SELECT version, saved_at, snapshot FROM versions WHERE entity_id = ?1 ORDER BY version DESC")?;
        let rows = stmt.query_map([id], |r| {
            let snap: String = r.get(2)?;
            let name = serde_json::from_str::<Entity>(&snap).map(|e| e.name).unwrap_or_default();
            Ok(VersionInfo { version: r.get(0)?, saved_at: r.get(1)?, name })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn version(&self, id: &str, version: i64) -> Result<Entity> {
        let snap: Option<String> = self
            .conn
            .query_row("SELECT snapshot FROM versions WHERE entity_id = ?1 AND version = ?2", params![id, version], |r| r.get(0))
            .optional()?;
        let snap = snap.ok_or_else(|| DbError::NotFound(format!("No version {version} of this entry")))?;
        serde_json::from_str(&snap).map_err(|e| DbError::Invalid(format!("Saved version is damaged: {e}")))
    }

    /// Brings back an old version as a new save, so nothing is lost. Links to
    /// entries deleted since then are dropped.
    pub fn restore(&mut self, id: &str, version: i64) -> Result<Entity> {
        let mut old = self.version(id, version)?;
        let mut keep = Vec::new();
        for l in old.links.drain(..) {
            let exists: bool = self.conn.query_row("SELECT EXISTS(SELECT 1 FROM entities WHERE id = ?1)", [&l.to_id], |r| r.get(0))?;
            if exists {
                keep.push(l);
            }
        }
        old.links = keep;
        self.save(old)
    }

    /// Every entry in full, for export.
    pub fn all(&self) -> Result<Vec<Entity>> {
        let ids: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT id FROM entities ORDER BY kind, name COLLATE NOCASE")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        ids.iter().map(|id| self.get(id)).collect()
    }

    /// Adds or updates entries from another file, keeping their ids so links
    /// survive. Entries are written first without links, then links are added,
    /// so the order inside the file doesn't matter. Returns (added, updated).
    pub fn import(&mut self, entities: Vec<Entity>) -> Result<(usize, usize)> {
        let mut added = 0;
        let mut updated = 0;
        for e in &entities {
            let exists = get_in(&self.conn, &e.id)?.is_some();
            let mut bare = e.clone();
            bare.links.clear();
            if exists {
                // Keep existing links until the second pass rewrites them.
                bare.links = self.get(&e.id)?.links;
                updated += 1;
            } else {
                added += 1;
            }
            self.save(bare)?;
        }
        for e in entities {
            let known: BTreeSet<String> = {
                let mut s = BTreeSet::new();
                for l in &e.links {
                    if get_in(&self.conn, &l.to_id)?.is_some() {
                        s.insert(l.to_id.clone());
                    }
                }
                s
            };
            let mut current = self.get(&e.id)?;
            let links: Vec<Link> = e.links.into_iter().filter(|l| known.contains(&l.to_id)).collect();
            if current.links != links {
                current.links = links;
                // Re-save without creating an extra history step for the import.
                write_links(&mut self.conn, &current)?;
            }
        }
        Ok((added, updated))
    }
}

fn write_links(conn: &mut Connection, e: &Entity) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM links WHERE from_id = ?1", [&e.id])?;
    for l in &e.links {
        tx.execute("INSERT OR IGNORE INTO links(from_id, to_id, relation) VALUES (?1, ?2, ?3)", params![e.id, l.to_id, l.relation])?;
    }
    tx.commit()?;
    Ok(())
}

fn index(tx: &Transaction, e: &Entity) -> Result<()> {
    tx.execute("DELETE FROM search WHERE id = ?1", [&e.id])?;
    tx.execute(
        "INSERT INTO search(id, name, summary, body, tags, fields) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![e.id, e.name, e.summary, e.body, e.tags.join(" "), format!("{} {} {}", e.entity_type, e.status, fields_text(&e.fields))],
    )?;
    Ok(())
}

fn get_in(conn: &Connection, id: &str) -> Result<Option<Entity>> {
    let row = conn
        .query_row(
            "SELECT id, kind, name, entity_type, status, author, summary, body, fields, created_at, updated_at, version
             FROM entities WHERE id = ?1",
            [id],
            |r| {
                let fields: String = r.get(8)?;
                Ok(Entity {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    entity_type: r.get(3)?,
                    status: r.get(4)?,
                    author: r.get(5)?,
                    summary: r.get(6)?,
                    body: r.get(7)?,
                    fields: serde_json::from_str(&fields).unwrap_or_default(),
                    tags: Vec::new(),
                    links: Vec::new(),
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                    version: r.get(11)?,
                })
            },
        )
        .optional()?;
    let Some(mut e) = row else { return Ok(None) };
    let mut stmt = conn.prepare_cached("SELECT tag FROM tags WHERE entity_id = ?1 ORDER BY tag COLLATE NOCASE")?;
    e.tags = stmt.query_map([id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    let mut stmt = conn.prepare_cached("SELECT to_id, relation FROM links WHERE from_id = ?1 ORDER BY relation, to_id")?;
    e.links = stmt
        .query_map([id], |r| Ok(Link { to_id: r.get(0)?, relation: r.get(1)? }))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(Some(e))
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;

    pub fn entity(kind: &str, name: &str) -> Entity {
        Entity {
            id: String::new(),
            kind: kind.into(),
            name: name.into(),
            entity_type: String::new(),
            status: String::new(),
            author: String::new(),
            summary: String::new(),
            body: String::new(),
            fields: Map::new(),
            tags: vec![],
            links: vec![],
            created_at: 0,
            updated_at: 0,
            version: 0,
        }
    }

    fn project() -> (tempfile::TempDir, Project) {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("test.forgecore"), "Test").unwrap();
        (dir, p)
    }

    #[test]
    fn create_open_and_rename() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.forgecore");
        let id = Project::create(&path, " Mouse Kingdom ").unwrap().info().unwrap().id;
        assert!(Project::create(&path, "again").is_err());
        let p = Project::open(&path).unwrap();
        assert_eq!(p.info().unwrap().name, "Mouse Kingdom");
        assert_eq!(p.rename("Rat Empire").unwrap().id, id);
        assert!(Project::open(&dir.path().join("missing.forgecore")).is_err());
    }

    #[test]
    fn save_get_update_keeps_history() {
        let (_d, mut p) = project();
        let mut e = entity("mob", "Cave Rat");
        e.tags = vec!["Rodent".into(), "rodent".into(), " ".into(), "Early".into()];
        e.fields.insert("health".into(), json!(40));
        let saved = p.save(e).unwrap();
        assert_eq!(saved.version, 1);
        assert_eq!(saved.tags, ["Rodent", "Early"]);

        let mut changed = saved.clone();
        changed.name = "Giant Cave Rat".into();
        changed.fields.insert("health".into(), json!(120));
        let v2 = p.save(changed).unwrap();
        assert_eq!(v2.version, 2);
        assert_eq!(v2.created_at, saved.created_at);

        let got = p.get(&saved.id).unwrap();
        assert_eq!(got.fields["health"], json!(120));
        assert_eq!(got.tags, ["Early", "Rodent"]);
        let history = p.versions(&saved.id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].name, "Cave Rat");

        let restored = p.restore(&saved.id, 1).unwrap();
        assert_eq!(restored.name, "Cave Rat");
        assert_eq!(restored.version, 3);
        assert_eq!(p.versions(&saved.id).unwrap().len(), 2);
    }

    #[test]
    fn rejects_bad_entries() {
        let (_d, mut p) = project();
        assert!(p.save(entity("mob", "  ")).is_err());
        assert!(p.save(entity("vehicle", "Cart")).is_err());
        let mut dangling = entity("quest", "Lost");
        dangling.links.push(Link { to_id: "nope".into(), relation: "zone".into() });
        assert!(p.save(dangling).is_err());
        let rat = p.save(entity("mob", "Rat")).unwrap();
        let mut moved = rat.clone();
        moved.kind = "item".into();
        assert!(p.save(moved).is_err());
    }

    #[test]
    fn links_backlinks_and_delete_cascade() {
        let (_d, mut p) = project();
        let zone = p.save(entity("zone", "Whisker Woods")).unwrap();
        let npc = p.save(entity("lore", "King Squeak")).unwrap();
        let mut q = entity("quest", "Cheese Heist");
        q.links = vec![
            Link { to_id: zone.id.clone(), relation: "zone".into() },
            Link { to_id: npc.id.clone(), relation: "questGiver".into() },
            Link { to_id: npc.id.clone(), relation: "questGiver".into() },
        ];
        let q = p.save(q).unwrap();
        assert_eq!(q.links.len(), 2);
        let back = p.backlinks(&zone.id).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].from_name, "Cheese Heist");

        p.delete(&zone.id).unwrap();
        assert_eq!(p.get(&q.id).unwrap().links.len(), 1);
        assert!(p.delete(&zone.id).is_err());
        assert!(p.list(&ListQuery { text: Some("whisker".into()), ..Default::default() }).unwrap().is_empty());
    }

    #[test]
    fn list_filters_and_search() {
        let (_d, mut p) = project();
        let mut dragon = entity("mob", "Ember Dragon");
        dragon.entity_type = "Boss".into();
        dragon.tags = vec!["fire".into()];
        dragon.fields.insert("weaknesses".into(), json!(["Frost"]));
        p.save(dragon).unwrap();
        let mut sword = entity("item", "Frostbrand");
        sword.summary = "A blade that never warms.".into();
        sword.status = "Draft".into();
        p.save(sword).unwrap();
        p.save(entity("mob", "Mouse Guard")).unwrap();

        let all = p.list(&ListQuery::default()).unwrap();
        assert_eq!(all.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["Ember Dragon", "Frostbrand", "Mouse Guard"]);
        let q = |q: ListQuery| p.list(&q).unwrap().into_iter().map(|e| e.name).collect::<Vec<_>>();
        assert_eq!(q(ListQuery { kind: Some("mob".into()), ..Default::default() }), ["Ember Dragon", "Mouse Guard"]);
        assert_eq!(q(ListQuery { text: Some("drag".into()), ..Default::default() }), ["Ember Dragon"]);
        // Field values are searchable; the name match ranks first.
        assert_eq!(q(ListQuery { text: Some("frost".into()), ..Default::default() }), ["Frostbrand", "Ember Dragon"]);
        assert_eq!(q(ListQuery { tag: Some("FIRE".into()), ..Default::default() }), ["Ember Dragon"]);
        assert_eq!(q(ListQuery { status: Some("Draft".into()), ..Default::default() }), ["Frostbrand"]);
        assert_eq!(q(ListQuery { entity_type: Some("Boss".into()), ..Default::default() }), ["Ember Dragon"]);
        assert!(q(ListQuery { text: Some("\"*(".into()), ..Default::default() }).len() == 3);
        assert_eq!(p.tags().unwrap(), [("fire".to_string(), 1)]);
        let mut counts = p.counts().unwrap();
        counts.sort();
        assert_eq!(counts, [("item".to_string(), 1), ("mob".to_string(), 2)]);
    }

    #[test]
    fn import_keeps_ids_and_links_in_any_order() {
        let (_d, mut src) = project();
        let zone = src.save(entity("zone", "Whisker Woods")).unwrap();
        let mut q = entity("quest", "Cheese Heist");
        q.links = vec![Link { to_id: zone.id.clone(), relation: "zone".into() }];
        let q = src.save(q).unwrap();
        let mut all = src.all().unwrap();
        all.reverse(); // quest before the zone it links to

        let (_d2, mut dst) = project();
        assert_eq!(dst.import(all.clone()).unwrap(), (2, 0));
        assert_eq!(dst.get(&q.id).unwrap().links, q.links);
        assert_eq!(dst.import(all).unwrap(), (0, 2));
        assert_eq!(dst.list(&ListQuery::default()).unwrap().len(), 2);
    }

    #[test]
    fn handles_many_entries_quickly() {
        let (_d, mut p) = project();
        let start = std::time::Instant::now();
        for i in 0..2000 {
            let mut e = entity("item", &format!("Item {i}"));
            e.summary = format!("Generated test item number {i}");
            p.save(e).unwrap();
        }
        let found = p.list(&ListQuery { text: Some("number 1999".into()), ..Default::default() }).unwrap();
        assert_eq!(found[0].name, "Item 1999");
        assert!(start.elapsed().as_secs() < 30);
    }

    #[test]
    fn fts_query_is_safe() {
        assert_eq!(fts_query("ember drag").as_deref(), Some("\"ember\"* \"drag\"*"));
        assert_eq!(fts_query("  \"*( ").as_deref(), None);
    }
}
