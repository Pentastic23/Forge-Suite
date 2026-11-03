//! The person's own API keys, one per service. They are kept in the Windows
//! Credential Manager (encrypted for this Windows user), or on Android in the
//! app's private storage. A key never goes back to the window, never into the
//! project file, and is only sent to its own service.

use serde::Serialize;

const SERVICE: &str = "ForgeSuite.AIForge";

/// The services AI Forge can hold a key for.
pub const SERVICES: [&str; 3] = ["anthropic", "openai", "meshy"];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    pub anthropic: bool,
    pub openai: bool,
    pub meshy: bool,
}

pub fn status() -> KeyStatus {
    KeyStatus { anthropic: read("anthropic").is_some(), openai: read("openai").is_some(), meshy: read("meshy").is_some() }
}

fn known(service: &str) -> Result<&'static str, String> {
    SERVICES.iter().find(|s| **s == service).copied().ok_or_else(|| format!("Unknown service {service}"))
}

fn plain(key: &str) -> bool {
    key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Catches pasting the wrong thing (or the wrong service's key) before it is saved.
pub fn check(service: &str, key: &str) -> Result<(), String> {
    let ok = match service {
        "anthropic" => key.starts_with("sk-ant-") && key.len() >= 30 && plain(key),
        "openai" => key.starts_with("sk-") && !key.starts_with("sk-ant-") && key.len() >= 23 && plain(key),
        "meshy" => key.len() >= 16 && plain(key),
        _ => false,
    };
    if ok {
        return Ok(());
    }
    Err(match service {
        "anthropic" => "That doesn't look like an Anthropic API key (they start with \"sk-ant-\")".into(),
        "openai" => "That doesn't look like an OpenAI API key (they start with \"sk-\")".into(),
        "meshy" => "That doesn't look like a Meshy API key".into(),
        other => format!("Unknown service {other}"),
    })
}

pub fn read(service: &str) -> Option<String> {
    let s = known(service).ok()?;
    store::read(s).map(|k| k.trim().to_string()).filter(|k| !k.is_empty())
}

pub fn save(service: &str, key: &str) -> Result<(), String> {
    let s = known(service)?;
    let key = key.trim();
    check(s, key)?;
    store::save(s, key)
}

pub fn clear(service: &str) -> Result<(), String> {
    store::clear(known(service)?)
}

/// Desktop: the Windows Credential Manager.
#[cfg(not(target_os = "android"))]
mod store {
    use super::SERVICE;

    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, &format!("{account}-api-key")).map_err(|e| format!("Windows couldn't open its credential store: {e}"))
    }

    pub fn read(account: &str) -> Option<String> {
        entry(account).ok()?.get_password().ok()
    }

    pub fn save(account: &str, key: &str) -> Result<(), String> {
        entry(account)?.set_password(key).map_err(|e| format!("Windows couldn't save the key: {e}"))
    }

    pub fn clear(account: &str) -> Result<(), String> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Windows couldn't remove the key: {e}")),
        }
    }
}

/// Android (Forge Suite for Android): files in the app's private storage,
/// which other apps can't read. There is no credential store to use instead.
#[cfg(target_os = "android")]
mod store {
    use std::fs;
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::path::PathBuf;

    fn path(account: &str) -> PathBuf {
        dirs::data_local_dir().unwrap_or_else(std::env::temp_dir).join("ForgeSuite").join("ai-forge").join(format!("{account}-key"))
    }

    pub fn read(account: &str) -> Option<String> {
        fs::read_to_string(path(account)).ok()
    }

    pub fn save(account: &str, key: &str) -> Result<(), String> {
        let path = path(account);
        let fail = |e: std::io::Error| format!("Couldn't save the key: {e}");
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(fail)?;
        }
        let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&path).map_err(fail)?;
        file.write_all(key.as_bytes()).map_err(fail)
    }

    pub fn clear(account: &str) -> Result<(), String> {
        match fs::remove_file(path(account)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Couldn't remove the key: {e}")),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_keys() {
        assert!(check("anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz").is_ok());
        assert!(check("anthropic", "sk-proj-abcdefghijklmnopqrstuvwxyz").is_err());
        assert!(check("openai", "sk-proj-abcdefghijklmnopqrstuvwxyz_0123").is_ok());
        assert!(check("openai", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz").unwrap_err().contains("OpenAI"), "an Anthropic key in the OpenAI box");
        assert!(check("openai", "sk-abc def").is_err());
        assert!(check("meshy", "msy_abcdefghijklmnop1234").is_ok());
        assert!(check("meshy", "short").is_err());
        assert!(save("dropbox", "x").is_err());
    }
}
