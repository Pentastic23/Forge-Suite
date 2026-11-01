//! Moving data in and out: .forgecodex from Forge Core in, .forgebalance and
//! CSV out.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use crate::sheet::{Column, ColumnKind, Row, Sheet};
use crate::store::{now_ms, Project};

/// "aggroRadius" -> "Aggro radius".
pub fn label_from_key(key: &str) -> String {
    let mut out = String::new();
    for (i, c) in key.chars().enumerate() {
        if i == 0 {
            out.extend(c.to_uppercase());
        } else if c.is_uppercase() {
            out.push(' ');
            out.extend(c.to_lowercase());
        } else if c == '_' {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

fn read_codex_entities(path: &Path) -> Result<Vec<Value>, String> {
    let mut zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| format!("Not a valid .forgecodex file: {e}"))?;
    let mut text = String::new();
    zip.by_name("entities.json")
        .map_err(|_| "This .forgecodex file has no entities.json".to_string())?
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Could not read entries: {e}"))?;
    if v.get("formatVersion").and_then(Value::as_u64).unwrap_or(1) > 1 {
        return Err("This file was made by a newer Forge Core. Update Balance Forge to open it.".into());
    }
    Ok(v.get("entities").and_then(Value::as_array).cloned().unwrap_or_default())
}

/// How many entries of each module a .forgecodex holds.
pub fn codex_kinds(path: &Path) -> Result<BTreeMap<String, usize>, String> {
    let mut out = BTreeMap::new();
    for e in read_codex_entities(path)? {
        if let Some(k) = e.get("kind").and_then(Value::as_str) {
            *out.entry(k.to_string()).or_insert(0) += 1;
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub sheet: Sheet,
    pub added: usize,
    pub updated: usize,
    pub new_columns: Vec<String>,
}

/// Builds or refreshes a sheet from one Forge Core module. Rows are matched to
/// entries by id, so re-importing updates names and imported stats while
/// keeping columns and rows you added yourself.
pub fn import_codex(path: &Path, kind: &str, existing: Option<Sheet>) -> Result<ImportSummary, String> {
    let entities: Vec<Value> = read_codex_entities(path)?.into_iter().filter(|e| e.get("kind").and_then(Value::as_str) == Some(kind)).collect();
    if entities.is_empty() {
        return Err(format!("This file has no {kind} entries"));
    }
    let mut sheet = existing.unwrap_or_else(|| Sheet {
        id: String::new(),
        name: label_from_key(match kind {
            "mob" => "mobs",
            "item" => "items",
            "skill" => "skills",
            "quest" => "quests",
            "zone" => "zones",
            other => other,
        }),
        source_kind: Some(kind.to_string()),
        columns: vec![Column { key: "type".into(), name: "Type".into(), kind: ColumnKind::Text, formula: None, decimals: None }],
        rows: vec![],
        updated_at: now_ms(),
    });

    let mut new_columns = Vec::new();
    for e in &entities {
        if let Some(fields) = e.get("fields").and_then(Value::as_object) {
            for (k, v) in fields {
                if v.is_number() && crate::sheet::is_valid_key(k) && k != "name" && !sheet.columns.iter().any(|c| c.key == *k) {
                    sheet.columns.push(Column { key: k.clone(), name: label_from_key(k), kind: ColumnKind::Number, formula: None, decimals: None });
                    new_columns.push(k.clone());
                }
            }
        }
    }

    let (mut added, mut updated) = (0, 0);
    for e in &entities {
        let Some(id) = e.get("id").and_then(Value::as_str) else { continue };
        let name = e.get("name").and_then(Value::as_str).unwrap_or("Unnamed").to_string();
        let mut values = Map::new();
        if let Some(t) = e.get("entityType").and_then(Value::as_str).filter(|t| !t.is_empty()) {
            if sheet.columns.iter().any(|c| c.key == "type") {
                values.insert("type".into(), json!(t));
            }
        }
        if let Some(fields) = e.get("fields").and_then(Value::as_object) {
            for (k, v) in fields {
                if v.is_number() && sheet.columns.iter().any(|c| c.key == *k && c.kind == ColumnKind::Number) {
                    values.insert(k.clone(), v.clone());
                }
            }
        }
        match sheet.rows.iter_mut().find(|r| r.source_id.as_deref() == Some(id)) {
            Some(row) => {
                row.name = name;
                for (k, v) in values {
                    row.values.insert(k, v);
                }
                updated += 1;
            }
            None => {
                sheet.rows.push(Row { id: uuid::Uuid::new_v4().to_string(), source_id: Some(id.to_string()), name, values });
                added += 1;
            }
        }
    }
    Ok(ImportSummary { sheet, added, updated, new_columns })
}

fn number_out(v: f64) -> Value {
    serde_json::Number::from_f64(v).map(Value::Number).unwrap_or(Value::Null)
}

/// The .forgebalance exchange file: every sheet with computed stats, keyed by
/// Forge Core entry ids where rows came from Forge Core.
pub fn export_balance(p: &Project, path: &Path) -> Result<usize, String> {
    let info = p.info()?;
    let mut sheets = Vec::new();
    let mut entity_ids = Vec::new();
    let mut count = 0;
    for s in p.sheets()? {
        let sheet = p.sheet(&s.id)?;
        let computed = sheet.compute();
        let rows: Vec<Value> = sheet
            .rows
            .iter()
            .map(|r| {
                if let Some(id) = &r.source_id {
                    entity_ids.push(id.clone());
                }
                let mut values = Map::new();
                for c in &sheet.columns {
                    let v = match c.kind {
                        ColumnKind::Text => r.values.get(&c.key).cloned().unwrap_or(Value::Null),
                        _ => computed.numbers.get(&r.id).and_then(|m| m.get(&c.key)).map(|v| number_out(*v)).unwrap_or(Value::Null),
                    };
                    values.insert(c.key.clone(), v);
                }
                count += 1;
                json!({ "id": r.id, "sourceId": r.source_id, "name": r.name, "values": values })
            })
            .collect();
        sheets.push(json!({ "id": sheet.id, "name": sheet.name, "sourceKind": sheet.source_kind, "columns": sheet.columns, "rows": rows }));
    }
    let manifest = json!({
        "formatVersion": 1,
        "kind": "balance",
        "sourceApp": "balance-forge",
        "sourceAppVersion": env!("CARGO_PKG_VERSION"),
        "createdAt": now_ms(),
        "project": { "id": info.id, "name": info.name },
        "entityIds": entity_ids,
    });
    let mut zip = zip::ZipWriter::new(File::create(path).map_err(|e| e.to_string())?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in [("manifest.json", manifest), ("stats.json", json!({ "formatVersion": 1, "sheets": sheets }))] {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(serde_json::to_string_pretty(&body).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(count)
}

fn csv_cell(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// One sheet as CSV, formulas included as their results.
pub fn export_csv(sheet: &Sheet, path: &Path) -> Result<usize, String> {
    let computed = sheet.compute();
    let mut out = String::from("\u{feff}");
    let header: Vec<String> = std::iter::once("Name".to_string()).chain(sheet.columns.iter().map(|c| c.name.clone())).collect();
    out.push_str(&header.iter().map(|h| csv_cell(h)).collect::<Vec<_>>().join(","));
    out.push_str("\r\n");
    for r in &sheet.rows {
        let mut cells = vec![r.name.clone()];
        for c in &sheet.columns {
            cells.push(match c.kind {
                ColumnKind::Text => r.values.get(&c.key).and_then(Value::as_str).unwrap_or_default().to_string(),
                _ => computed
                    .numbers
                    .get(&r.id)
                    .and_then(|m| m.get(&c.key))
                    .map(|v| if v.fract() == 0.0 { format!("{v:.0}") } else { format!("{v}") })
                    .unwrap_or_default(),
            });
        }
        out.push_str(&cells.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(sheet.rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::tests::units;

    fn codex(dir: &Path, entities: Value) -> std::path::PathBuf {
        let path = dir.join("in.forgecodex");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("entities.json", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(json!({ "formatVersion": 1, "entities": entities }).to_string().as_bytes()).unwrap();
        zip.finish().unwrap();
        path
    }

    #[test]
    fn imports_and_reimports_forge_core_mobs() {
        let dir = tempfile::tempdir().unwrap();
        let path = codex(dir.path(), json!([
            { "id": "m1", "kind": "mob", "name": "Cave Rat", "entityType": "Beast", "fields": { "health": 40, "damage": 6, "rarity": "Common" } },
            { "id": "m2", "kind": "mob", "name": "Ember Dragon", "entityType": "Boss", "fields": { "health": 48000, "armor": 320 } },
            { "id": "i1", "kind": "item", "name": "Sword", "fields": { "buyPrice": 10 } }
        ]));
        assert_eq!(codex_kinds(&path).unwrap(), BTreeMap::from([("item".to_string(), 1), ("mob".to_string(), 2)]));

        let first = import_codex(&path, "mob", None).unwrap();
        assert_eq!((first.added, first.updated), (2, 0));
        assert_eq!(first.sheet.name, "Mobs");
        let keys: Vec<_> = first.sheet.columns.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, ["type", "damage", "health", "armor"]);
        assert_eq!(first.sheet.columns[1].name, "Damage");
        let rat = &first.sheet.rows[0];
        assert_eq!(rat.values["type"], "Beast");
        assert!(!rat.values.contains_key("rarity"), "text fields other than type are not imported");

        // The designer adds a formula and edits a value, then re-imports.
        let mut sheet = first.sheet;
        sheet.columns.push(Column { key: "ehp".into(), name: "EHP".into(), kind: ColumnKind::Formula, formula: Some("health * 2".into()), decimals: None });
        sheet.rows[0].values.insert("damage".into(), json!(7));
        let path2 = codex(dir.path(), json!([{ "id": "m1", "kind": "mob", "name": "Giant Cave Rat", "fields": { "health": 60 } }]));
        let again = import_codex(&path2, "mob", Some(sheet)).unwrap();
        assert_eq!((again.added, again.updated), (0, 1));
        let rat = &again.sheet.rows[0];
        assert_eq!(rat.name, "Giant Cave Rat");
        assert_eq!(rat.values["health"], 60);
        assert_eq!(rat.values["damage"], 7, "values not in the file are kept");
        assert!(again.sheet.columns.iter().any(|c| c.key == "ehp"));
        assert!(import_codex(&path2, "skill", None).is_err());
    }

    #[test]
    fn exports_balance_file_and_csv() {
        let dir = tempfile::tempdir().unwrap();
        let p = Project::create(&dir.path().join("p.balanceforge"), "Arena").unwrap();
        let mut s = units();
        s.rows[0].source_id = Some("core-1".into());
        let s = p.save_sheet(s).unwrap();

        let out = dir.path().join("o.forgebalance");
        assert_eq!(export_balance(&p, &out).unwrap(), 3);
        let mut zip = zip::ZipArchive::new(File::open(&out).unwrap()).unwrap();
        let mut text = String::new();
        zip.by_name("stats.json").unwrap().read_to_string(&mut text).unwrap();
        let stats: Value = serde_json::from_str(&text).unwrap();
        let knight = &stats["sheets"][0]["rows"][0];
        assert_eq!(knight["sourceId"], "core-1");
        assert_eq!(knight["values"]["dps"], 40.0);
        let mut m = String::new();
        zip.by_name("manifest.json").unwrap().read_to_string(&mut m).unwrap();
        assert!(m.contains("\"kind\": \"balance\"") && m.contains("core-1"));

        let csv = dir.path().join("o.csv");
        export_csv(&s, &csv).unwrap();
        let text = fs::read_to_string(&csv).unwrap();
        let lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().collect();
        assert_eq!(lines[0], "Name,health,damage,attackSpeed,cost,role,valuePerGold,dps");
        assert_eq!(lines[1], "Knight,500,40,1,100,Tank,200,40");
    }

    #[test]
    fn labels() {
        assert_eq!(label_from_key("aggroRadius"), "Aggro radius");
        assert_eq!(label_from_key("buy_price"), "Buy price");
    }
}
