//! Forge Hub's activity log (JSON lines) and the "recently used" list.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub time: u64,
    pub level: Level,
    /// "hub" for Forge Hub itself, otherwise an app id.
    pub source: String,
    pub message: String,
}

const LOG_FILE: &str = "activity.log";
const RECENT_FILE: &str = "recent.json";

/// Serialises writes so two threads (e.g. a launch and an app exiting) never interleave lines.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn log(dir: &Path, level: Level, source: &str, message: impl Into<String>) {
    let entry = LogEntry { time: now_ms(), level, source: source.into(), message: message.into() };
    let _guard = WRITE_LOCK.lock();
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    if let (Ok(mut f), Ok(line)) = (
        OpenOptions::new().create(true).append(true).open(dir.join(LOG_FILE)),
        serde_json::to_string(&entry),
    ) {
        let _ = writeln!(f, "{line}");
    }
}

/// Newest first, at most `limit` entries. Unreadable lines are skipped.
pub fn read(dir: &Path, limit: usize) -> Vec<LogEntry> {
    let Ok(text) = fs::read_to_string(dir.join(LOG_FILE)) else { return Vec::new() };
    text.lines().rev().filter_map(|l| serde_json::from_str(l).ok()).take(limit).collect()
}

/// Drops entries older than `days`. Returns how many were removed.
pub fn prune(dir: &Path, days: u32) -> usize {
    let _guard = WRITE_LOCK.lock();
    let path = dir.join(LOG_FILE);
    let Ok(text) = fs::read_to_string(&path) else { return 0 };
    let cutoff = now_ms().saturating_sub(days as u64 * 86_400_000);
    let mut kept = Vec::new();
    let mut removed = 0;
    for line in text.lines() {
        match serde_json::from_str::<LogEntry>(line) {
            Ok(e) if e.time < cutoff => removed += 1,
            Ok(_) => kept.push(line),
            Err(_) => removed += 1,
        }
    }
    if removed > 0 {
        let mut out = kept.join("\n");
        if !out.is_empty() {
            out.push('\n');
        }
        let _ = fs::write(&path, out);
    }
    removed
}

/// App id -> last launch time (ms).
pub fn read_recent(dir: &Path) -> HashMap<String, u64> {
    fs::read_to_string(dir.join(RECENT_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn mark_launched(dir: &Path, app_id: &str) {
    let _guard = WRITE_LOCK.lock();
    let mut recent = read_recent(dir);
    recent.insert(app_id.to_string(), now_ms());
    if fs::create_dir_all(dir).is_ok() {
        if let Ok(json) = serde_json::to_string_pretty(&recent) {
            let _ = fs::write(dir.join(RECENT_FILE), json);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_read_newest_first_and_prune() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        log(d, Level::Info, "hub", "one");
        log(d, Level::Error, "forge-core", "two");
        let old = LogEntry { time: 1, level: Level::Info, source: "hub".into(), message: "ancient".into() };
        let mut f = OpenOptions::new().append(true).open(d.join(LOG_FILE)).unwrap();
        writeln!(f, "{}", serde_json::to_string(&old).unwrap()).unwrap();
        writeln!(f, "garbage").unwrap();

        let all = read(d, 10);
        assert_eq!(all.iter().map(|e| e.message.as_str()).collect::<Vec<_>>(), ["ancient", "two", "one"]);
        assert_eq!(read(d, 1).len(), 1);
        assert_eq!(prune(d, 30), 2);
        assert_eq!(read(d, 10).len(), 2);
    }

    #[test]
    fn recent_tracks_last_launch() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_recent(tmp.path()).is_empty());
        mark_launched(tmp.path(), "forge-core");
        assert!(read_recent(tmp.path())["forge-core"] > 0);
    }
}
