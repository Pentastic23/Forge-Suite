//! Exports (JSON, CSV, Markdown, .forgecodex) and imports (JSON, .forgecodex).
//! The .forgecodex file is how Balance Forge and Asset Forge receive entries.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use crate::db::{self, Entity, Project};

pub const CODEX_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub format_version: u32,
    pub source_app: String,
    pub source_app_version: String,
    pub created_at: String,
    pub project: db::ProjectInfo,
    pub entities: Vec<Entity>,
}

fn iso_now() -> String {
    // Seconds since the epoch, formatted as UTC without pulling in a date crate.
    let secs = (db::now_ms() / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn pick(p: &Project, kinds: &[String]) -> Result<Vec<Entity>, String> {
    let all = p.all().map_err(|e| e.to_string())?;
    Ok(if kinds.is_empty() { all } else { all.into_iter().filter(|e| kinds.contains(&e.kind)).collect() })
}

fn export_file(p: &Project, entities: Vec<Entity>) -> Result<ExportFile, String> {
    Ok(ExportFile {
        format_version: CODEX_FORMAT_VERSION,
        source_app: "forge-core".into(),
        source_app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: iso_now(),
        project: p.info().map_err(|e| e.to_string())?,
        entities,
    })
}

pub fn to_json(p: &Project, kinds: &[String], path: &Path) -> Result<usize, String> {
    let entities = pick(p, kinds)?;
    let n = entities.len();
    let file = export_file(p, entities)?;
    fs::write(path, serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(n)
}

fn csv_cell(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn value_text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(value_text).collect::<Vec<_>>().join("; "),
        other => other.to_string(),
    }
}

/// One row per entry. Module fields become their own columns.
pub fn to_csv(p: &Project, kinds: &[String], path: &Path) -> Result<usize, String> {
    let entities = pick(p, kinds)?;
    let names: HashMap<String, String> = p.all().map_err(|e| e.to_string())?.into_iter().map(|e| (e.id, e.name)).collect();
    let field_keys: BTreeSet<String> = entities.iter().flat_map(|e| e.fields.keys().cloned()).collect();
    let mut out = String::from("\u{feff}"); // BOM so Excel reads UTF-8
    let mut header = vec!["id", "module", "type", "name", "status", "tags", "summary", "links"].into_iter().map(String::from).collect::<Vec<_>>();
    header.extend(field_keys.iter().cloned());
    out.push_str(&header.iter().map(|h| csv_cell(h)).collect::<Vec<_>>().join(","));
    out.push_str("\r\n");
    for e in &entities {
        let links = e
            .links
            .iter()
            .map(|l| format!("{}: {}", l.relation, names.get(&l.to_id).cloned().unwrap_or_else(|| l.to_id.clone())))
            .collect::<Vec<_>>()
            .join("; ");
        let mut row = vec![e.id.clone(), e.kind.clone(), e.entity_type.clone(), e.name.clone(), e.status.clone(), e.tags.join("; "), e.summary.clone(), links];
        row.extend(field_keys.iter().map(|k| e.fields.get(k).map(value_text).unwrap_or_default()));
        out.push_str(&row.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(entities.len())
}

fn title(kind: &str) -> &str {
    match kind {
        "lore" => "Lore",
        "quest" => "Quests",
        "zone" => "Zones",
        "mob" => "Mobs",
        "item" => "Items",
        "skill" => "Skills",
        other => other,
    }
}

/// A readable design document, grouped by module.
pub fn to_markdown(p: &Project, kinds: &[String], path: &Path) -> Result<usize, String> {
    let entities = pick(p, kinds)?;
    let names: HashMap<String, String> = p.all().map_err(|e| e.to_string())?.into_iter().map(|e| (e.id, e.name)).collect();
    let info = p.info().map_err(|e| e.to_string())?;
    let mut md = format!("# {}\n\nExported from Forge Core on {}.\n", info.name, &iso_now()[..10]);
    let mut current = "";
    for e in &entities {
        if e.kind != current {
            current = &e.kind;
            md.push_str(&format!("\n## {}\n", title(current)));
        }
        md.push_str(&format!("\n### {}\n\n", e.name));
        let mut meta = Vec::new();
        if !e.entity_type.is_empty() {
            meta.push(format!("**Type:** {}", e.entity_type));
        }
        if !e.status.is_empty() {
            meta.push(format!("**Status:** {}", e.status));
        }
        if !e.tags.is_empty() {
            meta.push(format!("**Tags:** {}", e.tags.join(", ")));
        }
        if !meta.is_empty() {
            md.push_str(&meta.join(" · "));
            md.push_str("\n\n");
        }
        if !e.summary.is_empty() {
            md.push_str(&format!("{}\n\n", e.summary));
        }
        for (k, v) in &e.fields {
            let t = value_text(v);
            if !t.is_empty() {
                md.push_str(&format!("- **{k}:** {t}\n"));
            }
        }
        if !e.fields.is_empty() {
            md.push('\n');
        }
        if !e.links.is_empty() {
            let l = e
                .links
                .iter()
                .map(|l| format!("{} ({})", names.get(&l.to_id).cloned().unwrap_or_default(), l.relation))
                .collect::<Vec<_>>()
                .join(", ");
            md.push_str(&format!("**Linked to:** {l}\n\n"));
        }
        if !e.body.trim().is_empty() {
            md.push_str(e.body.trim());
            md.push_str("\n\n");
        }
    }
    fs::write(path, md).map_err(|e| e.to_string())?;
    Ok(entities.len())
}

/// The exchange file other Forge apps open: a zip with manifest.json and entities.json.
pub fn to_codex(p: &Project, kinds: &[String], path: &Path) -> Result<usize, String> {
    let entities = pick(p, kinds)?;
    let n = entities.len();
    let info = p.info().map_err(|e| e.to_string())?;
    let manifest = json!({
        "formatVersion": CODEX_FORMAT_VERSION,
        "kind": "codex",
        "sourceApp": "forge-core",
        "sourceAppVersion": env!("CARGO_PKG_VERSION"),
        "createdAt": iso_now(),
        "project": { "id": info.id, "name": info.name },
        "entityIds": entities.iter().map(|e| e.id.clone()).collect::<Vec<_>>(),
    });
    let body = export_file(p, entities)?;
    let mut zip = zip::ZipWriter::new(File::create(path).map_err(|e| e.to_string())?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    zip.start_file("entities.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string(&body).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(n)
}

/// Reads entries from a .forgecodex or a Forge Core JSON export.
pub fn read_entities(path: &Path) -> Result<Vec<Entity>, String> {
    let lower = path.to_string_lossy().to_lowercase();
    let text = if lower.ends_with(".forgecodex") {
        let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| format!("Not a valid .forgecodex file: {e}"))?;
        let mut f = zip.by_name("entities.json").map_err(|_| "This .forgecodex file has no entities.json".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        s
    } else {
        fs::read_to_string(path).map_err(|e| e.to_string())?
    };
    let file: ExportFile = serde_json::from_str(&text).map_err(|e| format!("Could not read entries: {e}"))?;
    if file.format_version > CODEX_FORMAT_VERSION {
        return Err("This file was made by a newer Forge Core. Update Forge Core to open it.".into());
    }
    Ok(file.entities.into_iter().filter(|e| db::KINDS.contains(&e.kind.as_str()) && !e.id.is_empty()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::entity;
    use crate::db::Link;
    use serde_json::json;

    fn sample() -> (tempfile::TempDir, Project) {
        let dir = tempfile::tempdir().unwrap();
        let mut p = Project::create(&dir.path().join("p.forgecore"), "Mouse Kingdom").unwrap();
        let zone = p.save(entity("zone", "Whisker Woods")).unwrap();
        let mut mob = entity("mob", "Cave Rat, \"Elder\"");
        mob.fields.insert("health".into(), json!(40));
        mob.fields.insert("resistances".into(), json!(["Poison", "Dark"]));
        mob.tags = vec!["rodent".into()];
        mob.links = vec![Link { to_id: zone.id, relation: "spawnLocations".into() }];
        p.save(mob).unwrap();
        (dir, p)
    }

    #[test]
    fn csv_quotes_and_flattens_fields() {
        let (dir, p) = sample();
        let path = dir.path().join("out.csv");
        assert_eq!(to_csv(&p, &["mob".into()], &path).unwrap(), 1);
        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().collect();
        assert_eq!(lines[0], "id,module,type,name,status,tags,summary,links,health,resistances");
        assert!(lines[1].contains(",\"Cave Rat, \"\"Elder\"\"\","));
        assert!(lines[1].ends_with(",spawnLocations: Whisker Woods,40,Poison; Dark"));
    }

    #[test]
    fn markdown_groups_by_module() {
        let (dir, p) = sample();
        let path = dir.path().join("out.md");
        to_markdown(&p, &[], &path).unwrap();
        let md = fs::read_to_string(&path).unwrap();
        assert!(md.starts_with("# Mouse Kingdom"));
        let mobs = md.find("## Mobs").unwrap();
        let zones = md.find("## Zones").unwrap();
        assert!(mobs < zones);
        assert!(md.contains("**Linked to:** Whisker Woods (spawnLocations)"));
        assert!(md.contains("- **resistances:** Poison; Dark"));
    }

    #[test]
    fn codex_and_json_round_trip_into_a_new_project() {
        let (dir, p) = sample();
        for name in ["out.forgecodex", "out.json"] {
            let path = dir.path().join(name);
            if name.ends_with("codex") {
                to_codex(&p, &[], &path).unwrap();
            } else {
                to_json(&p, &[], &path).unwrap();
            }
            let entities = read_entities(&path).unwrap();
            assert_eq!(entities.len(), 2);
            let mut fresh = Project::create(&dir.path().join(format!("{name}.forgecore")), "Copy").unwrap();
            assert_eq!(fresh.import(entities).unwrap(), (2, 0));
            let rat = fresh.list(&db::ListQuery { kind: Some("mob".into()), ..Default::default() }).unwrap();
            assert_eq!(fresh.get(&rat[0].id).unwrap().links.len(), 1);
        }
        let mut zip = zip::ZipArchive::new(File::open(dir.path().join("out.forgecodex")).unwrap()).unwrap();
        let mut s = String::new();
        zip.by_name("manifest.json").unwrap().read_to_string(&mut s).unwrap();
        let m: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(m["kind"], "codex");
        assert_eq!(m["entityIds"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn rejects_files_from_newer_versions_and_junk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.json");
        fs::write(&path, r#"{"formatVersion":99,"sourceApp":"forge-core","sourceAppVersion":"9","createdAt":"","project":{"id":"a","name":"b","createdAt":0},"entities":[]}"#).unwrap();
        assert!(read_entities(&path).unwrap_err().contains("newer"));
        fs::write(&path, "not json").unwrap();
        assert!(read_entities(&path).is_err());
        let codex = dir.path().join("x.forgecodex");
        fs::write(&codex, "not a zip").unwrap();
        assert!(read_entities(&codex).is_err());
    }

    #[test]
    fn dates_format() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_758), (2026, 11, 1));
        assert_eq!(iso_now().len(), 20);
    }
}
