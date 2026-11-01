//! Production readiness: what each game system needs (an item needs an icon,
//! a mob needs sprites and sounds) and which assets fill those needs. Entries
//! usually come from Forge Core; Asset Forge never changes the game systems.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::kinds;
use crate::store::{now_ms, AssetSummary, Project, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub name: String,
    #[serde(default)]
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub id: String,
    /// Forge Core entry id, for requirements imported from a .forgecodex.
    #[serde(default)]
    pub source_id: Option<String>,
    /// Module or group, like "mob" or "item".
    pub group: String,
    pub name: String,
    pub slots: Vec<Slot>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SlotState {
    /// No asset linked yet.
    Missing,
    /// Linked, but the file is gone.
    Broken,
    /// Linked, not approved yet.
    Wip,
    /// Linked and Approved or Final.
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotView {
    pub name: String,
    pub state: SlotState,
    pub asset: Option<AssetSummary>,
    /// Likely matches for an empty slot, by name and category.
    pub suggestions: Vec<AssetSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementView {
    pub id: String,
    pub source_id: Option<String>,
    pub group: String,
    pub name: String,
    pub notes: String,
    pub slots: Vec<SlotView>,
    pub done: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub requirements: Vec<RequirementView>,
    /// Group -> (slots done, slots total).
    pub groups: BTreeMap<String, (usize, usize)>,
    pub done: usize,
    pub total: usize,
}

/// Default asset slots for each Forge Core module. Editable in the app.
pub fn default_templates() -> BTreeMap<String, Vec<String>> {
    let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    BTreeMap::from([
        ("mob".to_string(), t(&["Sprite", "Animations", "Sounds"])),
        ("item".to_string(), t(&["Icon"])),
        ("skill".to_string(), t(&["Icon", "Effect", "Sound"])),
        ("zone".to_string(), t(&["Tileset", "Music"])),
        ("quest".to_string(), t(&[])),
        ("lore".to_string(), t(&[])),
    ])
}

/// Which asset categories fit a slot name, best first.
fn slot_categories(slot: &str) -> &'static [&'static str] {
    let w = kinds::words(slot);
    let has = |k: &str| w.iter().any(|x| x.starts_with(k));
    if has("icon") {
        &["Icon"]
    } else if has("anim") {
        &["Animation", "Sprite"]
    } else if has("sprite") || has("portrait") || has("art") {
        &["Sprite", "Animation"]
    } else if has("music") || has("theme") {
        &["Music"]
    } else if has("sound") || has("sfx") || has("audio") {
        &["SFX", "Music"]
    } else if has("tile") {
        &["Tileset"]
    } else if has("effect") || has("vfx") || has("particle") {
        &["VFX"]
    } else if has("model") || has("mesh") {
        &["Model"]
    } else if has("texture") || has("material") {
        &["Texture"]
    } else if has("ui") || has("button") || has("panel") {
        &["UI"]
    } else {
        &[]
    }
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Requirement> {
    let slots: String = r.get(4)?;
    Ok(Requirement {
        id: r.get(0)?,
        source_id: r.get(1)?,
        group: r.get(2)?,
        name: r.get(3)?,
        slots: serde_json::from_str(&slots).unwrap_or_default(),
        notes: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

fn sql(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

pub fn list(p: &Project) -> Result<Vec<Requirement>> {
    let mut stmt = p
        .conn
        .prepare("SELECT id, source_id, grp, name, slots, notes, created_at, updated_at FROM requirements ORDER BY grp, name COLLATE NOCASE")
        .map_err(sql)?;
    let rows = stmt.query_map([], row).map_err(sql)?;
    rows.collect::<std::result::Result<_, _>>().map_err(sql)
}

pub fn save(p: &Project, mut r: Requirement) -> Result<Requirement> {
    r.name = r.name.trim().to_string();
    r.group = r.group.trim().to_lowercase();
    if r.name.is_empty() {
        return Err("Give the requirement a name".into());
    }
    if r.group.is_empty() {
        r.group = "other".into();
    }
    r.slots.retain(|s| !s.name.trim().is_empty());
    for s in &mut r.slots {
        s.name = s.name.trim().to_string();
    }
    let now = now_ms();
    if r.id.is_empty() {
        r.id = uuid::Uuid::new_v4().to_string();
        r.created_at = now;
    }
    r.updated_at = now;
    p.conn
        .execute(
            "INSERT INTO requirements(id, source_id, grp, name, slots, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET grp = excluded.grp, name = excluded.name, slots = excluded.slots, notes = excluded.notes, updated_at = excluded.updated_at",
            params![r.id, r.source_id, r.group, r.name, serde_json::to_string(&r.slots).unwrap(), r.notes, r.created_at, r.updated_at],
        )
        .map_err(sql)?;
    Ok(r)
}

pub fn delete(p: &Project, id: &str) -> Result<()> {
    p.conn.execute("DELETE FROM requirements WHERE id = ?1", [id]).map_err(sql)?;
    Ok(())
}

pub fn get(p: &Project, id: &str) -> Result<Requirement> {
    p.conn
        .query_row("SELECT id, source_id, grp, name, slots, notes, created_at, updated_at FROM requirements WHERE id = ?1", [id], row)
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "That requirement no longer exists".into())
}

/// Links (or unlinks, with `None`) an asset to one slot.
pub fn link(p: &Project, id: &str, slot: &str, asset_id: Option<String>) -> Result<Requirement> {
    let mut r = get(p, id)?;
    let s = r.slots.iter_mut().find(|s| s.name == slot).ok_or("That slot no longer exists")?;
    s.asset_id = asset_id.clone();
    let r = save(p, r)?;
    if let Some(a) = asset_id {
        p.log(Some(&a), "Linked", &format!("{} → {}", r.name, slot))?;
    }
    Ok(r)
}

/// Adds or refreshes requirements from a Forge Core .forgecodex file. Entries
/// already imported keep their links and extra slots; only the name changes.
pub fn import_codex(p: &Project, path: &Path, templates: &BTreeMap<String, Vec<String>>) -> Result<(usize, usize)> {
    let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| format!("Not a valid .forgecodex file: {e}"))?;
    let mut text = String::new();
    zip.by_name("entities.json").map_err(|_| "This .forgecodex file has no entities.json".to_string())?.read_to_string(&mut text).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Could not read entries: {e}"))?;
    if v.get("formatVersion").and_then(Value::as_u64).unwrap_or(1) > 1 {
        return Err("This file was made by a newer Forge Core. Update Asset Forge to open it.".into());
    }
    let existing: HashMap<String, Requirement> = list(p)?.into_iter().filter_map(|r| r.source_id.clone().map(|s| (s, r))).collect();
    let (mut added, mut updated) = (0, 0);
    for e in v.get("entities").and_then(Value::as_array).cloned().unwrap_or_default() {
        let (Some(id), Some(kind), Some(name)) = (e.get("id").and_then(Value::as_str), e.get("kind").and_then(Value::as_str), e.get("name").and_then(Value::as_str)) else { continue };
        let slots = templates.get(kind).cloned().unwrap_or_default();
        if let Some(old) = existing.get(id) {
            if old.name != name {
                save(p, Requirement { name: name.to_string(), ..old.clone() })?;
            }
            updated += 1;
        } else {
            if slots.is_empty() {
                continue;
            }
            save(
                p,
                Requirement {
                    id: String::new(),
                    source_id: Some(id.to_string()),
                    group: kind.to_string(),
                    name: name.to_string(),
                    slots: slots.into_iter().map(|name| Slot { name, asset_id: None }).collect(),
                    notes: String::new(),
                    created_at: 0,
                    updated_at: 0,
                },
            )?;
            added += 1;
        }
    }
    Ok((added, updated))
}

/// Every requirement with its slots' state and suggestions for empty slots.
pub fn readiness(p: &Project) -> Result<Readiness> {
    let reqs = list(p)?;
    let assets = p.all()?;
    let by_id: HashMap<&str, &AssetSummary> = assets.iter().map(|a| (a.id.as_str(), a)).collect();
    // Words in each live asset's path, for suggestions.
    let words: Vec<(&AssetSummary, Vec<String>)> = assets.iter().filter(|a| !a.missing).map(|a| (a, kinds::words(&a.rel_path))).collect();
    let mut out = Readiness::default();
    for r in reqs {
        let name_words = kinds::words(&r.name);
        let mut slots = Vec::new();
        let mut done = 0;
        for s in &r.slots {
            let asset = s.asset_id.as_deref().and_then(|id| by_id.get(id)).map(|a| (*a).clone());
            let state = match (&s.asset_id, &asset) {
                (None, _) => SlotState::Missing,
                (Some(_), None) => SlotState::Broken,
                (Some(_), Some(a)) if a.missing => SlotState::Broken,
                (Some(_), Some(a)) if a.status == "Approved" || a.status == "Final" => SlotState::Done,
                _ => SlotState::Wip,
            };
            if state == SlotState::Done {
                done += 1;
            }
            let suggestions = if state == SlotState::Missing && !name_words.is_empty() {
                let cats = slot_categories(&s.name);
                let mut hits: Vec<(usize, &AssetSummary)> = words
                    .iter()
                    .filter(|(_, w)| name_words.iter().all(|n| w.contains(n)))
                    .map(|(a, _)| (cats.iter().position(|c| *c == a.category).unwrap_or(cats.len() + 1), *a))
                    .filter(|(rank, _)| cats.is_empty() || *rank <= cats.len())
                    .collect();
                hits.sort_by(|x, y| x.0.cmp(&y.0).then(x.1.name.cmp(&y.1.name)));
                hits.into_iter().take(3).map(|(_, a)| a.clone()).collect()
            } else {
                vec![]
            };
            slots.push(SlotView { name: s.name.clone(), state, asset, suggestions });
        }
        let g = out.groups.entry(r.group.clone()).or_insert((0, 0));
        g.0 += done;
        g.1 += slots.len();
        out.done += done;
        out.total += slots.len();
        out.requirements.push(RequirementView { id: r.id, source_id: r.source_id, group: r.group, name: r.name, notes: r.notes, total: slots.len(), done, slots });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::sample;
    use crate::store::{AssetPatch, AssetQuery};
    use std::io::Write;

    fn codex(path: &Path, entities: Value) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", o).unwrap();
        zip.write_all(b"{\"kind\":\"codex\"}").unwrap();
        zip.start_file("entities.json", o).unwrap();
        zip.write_all(serde_json::json!({ "formatVersion": 1, "entities": entities }).to_string().as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn imports_links_and_tracks_readiness() {
        let (dir, mut p, _) = sample();
        let file = dir.path().join("game.forgecodex");
        codex(
            &file,
            serde_json::json!([
                { "id": "e1", "kind": "item", "name": "Sword" },
                { "id": "e2", "kind": "mob", "name": "Knight" },
                { "id": "e3", "kind": "lore", "name": "The Old War" },
            ]),
        );
        assert_eq!(import_codex(&p, &file, &default_templates()).unwrap(), (2, 0), "lore has no asset slots");

        let r = readiness(&p).unwrap();
        assert_eq!((r.done, r.total), (0, 4));
        let sword = r.requirements.iter().find(|x| x.name == "Sword").unwrap();
        assert_eq!(sword.slots[0].state, SlotState::Missing);
        assert_eq!(sword.slots[0].suggestions[0].name, "sword.png", "suggested by name and category");
        let knight = r.requirements.iter().find(|x| x.name == "Knight").unwrap();
        assert!(knight.slots.iter().find(|s| s.name == "Animations").unwrap().suggestions.iter().all(|a| a.category == "Animation"));

        let icon = sword.slots[0].suggestions[0].id.clone();
        link(&p, &sword.id, "Icon", Some(icon.clone())).unwrap();
        assert_eq!(readiness(&p).unwrap().requirements.iter().find(|x| x.name == "Sword").unwrap().slots[0].state, SlotState::Wip);
        p.update(&[icon.clone()], &AssetPatch { status: Some("Approved".into()), ..Default::default() }).unwrap();
        let r = readiness(&p).unwrap();
        assert_eq!((r.done, r.total), (1, 4));
        assert_eq!(r.groups["item"], (1, 1));

        // Re-import with a renamed entry: links survive.
        codex(&file, serde_json::json!([{ "id": "e1", "kind": "item", "name": "Iron Sword" }]));
        assert_eq!(import_codex(&p, &file, &default_templates()).unwrap(), (0, 1));
        let r = readiness(&p).unwrap();
        let sword = r.requirements.iter().find(|x| x.source_id.as_deref() == Some("e1")).unwrap();
        assert_eq!((sword.name.as_str(), sword.slots[0].state), ("Iron Sword", SlotState::Done));

        // The file disappears: the slot shows as broken.
        let path = p.list(&AssetQuery { ids: Some(vec![icon]), ..Default::default() }).unwrap().assets[0].path.clone();
        std::fs::remove_file(path).unwrap();
        p.scan_all(&|_, _| {}).unwrap();
        let r = readiness(&p).unwrap();
        assert_eq!(r.requirements.iter().find(|x| x.source_id.as_deref() == Some("e1")).unwrap().slots[0].state, SlotState::Broken);
    }
}
