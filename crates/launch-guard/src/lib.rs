//! Launch keys for the Forge Suite.
//!
//! Forge Hub calls [`issue_key`] right before it starts an app, and passes the
//! key to the app in the `FORGE_LAUNCH_KEY` environment variable. The app calls
//! [`verify_from_env`] first thing on startup. A key works once and only for a
//! short time, so double-clicking an app's .exe does not open it.
//!
//! This stops casual launching outside the Hub. It is not copy protection.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Environment variable holding the key for the app being launched.
pub const KEY_ENV: &str = "FORGE_LAUNCH_KEY";
/// Environment variable holding the folder where key files live.
pub const DIR_ENV: &str = "FORGE_LAUNCH_DIR";
/// How long a key stays valid after Forge Hub issues it.
pub const KEY_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq, Eq)]
pub enum GuardError {
    /// The app was not started by Forge Hub (no key given).
    NotLaunchedFromHub,
    /// A key was given but no matching key file exists (already used or never issued).
    UnknownKey,
    /// The key does not match the one Forge Hub issued.
    WrongKey,
    /// The key is older than [`KEY_TTL`].
    Expired,
    /// The key file could not be read or removed.
    Io(String),
}

impl fmt::Display for GuardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GuardError::NotLaunchedFromHub => write!(f, "Please open this app from Forge Hub."),
            GuardError::UnknownKey => write!(f, "This launch key was already used. Open the app again from Forge Hub."),
            GuardError::WrongKey => write!(f, "Invalid launch key. Open the app again from Forge Hub."),
            GuardError::Expired => write!(f, "The launch key expired. Open the app again from Forge Hub."),
            GuardError::Io(e) => write!(f, "Could not check the launch key: {e}"),
        }
    }
}

impl std::error::Error for GuardError {}

/// Default folder for key files: `%LOCALAPPDATA%\ForgeSuite\launch` on Windows.
pub fn default_launch_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ForgeSuite")
        .join("launch")
}

fn key_path(dir: &Path, app_id: &str) -> PathBuf {
    // App ids are validated by the manifest rules (lowercase, digits, dashes),
    // but strip anything else defensively so a bad id can't escape the folder.
    let safe: String = app_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    dir.join(format!("{safe}.key"))
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn random_hex(bytes: usize) -> io::Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Forge Hub side: create a fresh single-use key for `app_id` and return it.
/// Any earlier unused key for the same app is replaced.
pub fn issue_key(dir: &Path, app_id: &str) -> io::Result<String> {
    fs::create_dir_all(dir)?;
    let key = random_hex(32)?;
    fs::write(key_path(dir, app_id), format!("{key}\n{}", now_ms()))?;
    Ok(key)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// App side: check `key` against the file Forge Hub wrote, then delete the file
/// so the key can't be used again.
pub fn verify(dir: &Path, app_id: &str, key: &str) -> Result<(), GuardError> {
    verify_at(dir, app_id, key, now_ms())
}

fn verify_at(dir: &Path, app_id: &str, key: &str, now: u128) -> Result<(), GuardError> {
    let path = key_path(dir, app_id);
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Err(GuardError::UnknownKey),
        Err(e) => return Err(GuardError::Io(e.to_string())),
    };
    let mut lines = contents.lines();
    let stored = lines.next().unwrap_or_default().trim();
    let issued: u128 = lines.next().and_then(|l| l.trim().parse().ok()).unwrap_or(0);

    if !constant_time_eq(stored.as_bytes(), key.trim().as_bytes()) {
        return Err(GuardError::WrongKey);
    }
    // Single use: remove before reporting expiry too, so a stale file never lingers.
    fs::remove_file(&path).map_err(|e| GuardError::Io(e.to_string()))?;
    if now.saturating_sub(issued) > KEY_TTL.as_millis() {
        return Err(GuardError::Expired);
    }
    Ok(())
}

/// App side, the usual entry point: read the key and folder from the
/// environment and verify. Debug builds skip the check when `FORGE_DEV=1`,
/// so apps can be run straight from `cargo tauri dev`.
pub fn verify_from_env(app_id: &str) -> Result<(), GuardError> {
    if cfg!(debug_assertions) && std::env::var("FORGE_DEV").as_deref() == Ok("1") {
        return Ok(());
    }
    let key = std::env::var(KEY_ENV).map_err(|_| GuardError::NotLaunchedFromHub)?;
    let dir = std::env::var_os(DIR_ENV).map(PathBuf::from).unwrap_or_else(default_launch_dir);
    verify(&dir, app_id, &key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_works_once() {
        let dir = tempfile::tempdir().unwrap();
        let key = issue_key(dir.path(), "forge-core").unwrap();
        assert_eq!(key.len(), 64);
        assert_eq!(verify(dir.path(), "forge-core", &key), Ok(()));
        assert_eq!(verify(dir.path(), "forge-core", &key), Err(GuardError::UnknownKey));
    }

    #[test]
    fn wrong_key_and_wrong_app_fail() {
        let dir = tempfile::tempdir().unwrap();
        let key = issue_key(dir.path(), "forge-core").unwrap();
        assert_eq!(verify(dir.path(), "forge-core", "nope"), Err(GuardError::WrongKey));
        assert_eq!(verify(dir.path(), "balance-forge", &key), Err(GuardError::UnknownKey));
        // A wrong guess does not burn the real key.
        assert_eq!(verify(dir.path(), "forge-core", &key), Ok(()));
    }

    #[test]
    fn expired_key_fails_and_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let key = issue_key(dir.path(), "pixel-forge").unwrap();
        let later = now_ms() + KEY_TTL.as_millis() + 1_000;
        assert_eq!(verify_at(dir.path(), "pixel-forge", &key, later), Err(GuardError::Expired));
        assert_eq!(verify(dir.path(), "pixel-forge", &key), Err(GuardError::UnknownKey));
    }

    #[test]
    fn reissue_replaces_old_key() {
        let dir = tempfile::tempdir().unwrap();
        let old = issue_key(dir.path(), "asset-forge").unwrap();
        let new = issue_key(dir.path(), "asset-forge").unwrap();
        assert_ne!(old, new);
        assert_eq!(verify(dir.path(), "asset-forge", &old), Err(GuardError::WrongKey));
        assert_eq!(verify(dir.path(), "asset-forge", &new), Ok(()));
    }

    #[test]
    fn app_id_cannot_escape_folder() {
        let dir = Path::new("/tmp/x");
        assert_eq!(key_path(dir, "../../etc/passwd"), dir.join("etcpasswd.key"));
    }
}
