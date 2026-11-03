//! Reads a `.forgecodex` from Forge Core (or Forge Core's JSON export), so the
//! assistant knows the game's lore, zones, mobs, items, skills and quests. Only
//! the names and summaries are kept, in the project's settings.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEntry {
    pub kind: String,
    pub name: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Codex {
    /// The Forge Core project's name.
    pub project: String,
    pub entries: Vec<CodexEntry>,
}

/// Entries from the JSON inside a .forgecodex (or a Forge Core JSON export).
pub fn from_json(text: &str) -> Result<Codex, String> {
    let v: Value = serde_json::from_str(text).map_err(|_| "That file isn't a Forge Core export".to_string())?;
    let list = v["entities"].as_array().ok_or("That file has no Forge Core entries")?;
    let entries = list
        .iter()
        .filter_map(|e| {
            let name = e["name"].as_str()?.trim();
            (!name.is_empty()).then(|| CodexEntry {
                kind: e["kind"].as_str().unwrap_or("entry").to_string(),
                name: name.chars().take(120).collect(),
                summary: e["summary"].as_str().unwrap_or_default().trim().chars().take(400).collect(),
            })
        })
        .take(2000)
        .collect();
    Ok(Codex { project: v["project"]["name"].as_str().unwrap_or("Forge Core project").to_string(), entries })
}

pub fn read(path: &Path) -> Result<Codex, String> {
    let lower = path.to_string_lossy().to_lowercase();
    let meta = std::fs::metadata(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?;
    if meta.len() > 64 * 1024 * 1024 {
        return Err("That file is too large to be a codex".into());
    }
    let text = if lower.ends_with(".forgecodex") {
        let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| format!("Not a valid .forgecodex file: {e}"))?;
        let mut f = zip.by_name("entities.json").map_err(|_| "The .forgecodex has no entities.json".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        s
    } else {
        std::fs::read_to_string(path).map_err(|e| format!("Couldn't read {}: {e}", path.display()))?
    };
    from_json(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_emberfall_codex() {
        let c = from_json(crate::example::CODEX).unwrap();
        assert_eq!(c.project, "Emberfall (example)");
        assert_eq!(c.entries.len(), 32);
        assert!(c.entries.iter().any(|e| e.kind == "mob" && e.name == "Cave Bat"));
        assert!(from_json("{}").is_err());
        assert!(from_json("nope").is_err());
    }

    #[test]
    fn reads_a_forgecodex_zip() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.forgecodex");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("entities.json", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(br#"{"project":{"name":"Mice"},"entities":[{"kind":"mob","name":"Cat","summary":"Big."},{"kind":"item","name":" "}]}"#).unwrap();
        zip.finish().unwrap();
        let c = read(&path).unwrap();
        assert_eq!(c, Codex { project: "Mice".into(), entries: vec![CodexEntry { kind: "mob".into(), name: "Cat".into(), summary: "Big.".into() }] });
    }
}
