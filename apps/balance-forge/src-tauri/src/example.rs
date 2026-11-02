//! The Emberfall example project. Its Mobs and Items sheets are imported from
//! `examples/emberfall/codex.json` (the entries in Forge Core's example), so
//! the rows carry the same ids; formulas, a hand-made Weapons sheet, a patch
//! snapshot and an economy setup are added on top.

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::exchange;
use crate::projects;
use crate::sheet::{Column, ColumnKind, Row, Sheet};
use crate::store::Project;

const CODEX: &str = include_str!("../../../../examples/emberfall/codex.json");
pub const NAME: &str = "Emberfall (example)";
const FILE_STEM: &str = "Emberfall Example";

pub fn path() -> PathBuf {
    projects::projects_dir().join(format!("{FILE_STEM}.{}", projects::EXTENSION))
}

/// Opens the example project, making it first if it isn't there yet.
pub fn open_or_build() -> Result<(PathBuf, Project), String> {
    let path = path();
    if path.is_file() {
        return Ok((path.clone(), Project::open(&path)?));
    }
    fs::create_dir_all(projects::projects_dir()).map_err(|e| e.to_string())?;
    match build(&path) {
        Ok(p) => Ok((path, p)),
        Err(e) => {
            for ext in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{ext}", path.display()));
            }
            Err(e)
        }
    }
}

fn number(key: &str, name: &str) -> Column {
    Column { key: key.into(), name: name.into(), kind: ColumnKind::Number, formula: None, decimals: None }
}

fn formula(key: &str, name: &str, f: &str, decimals: Option<u8>) -> Column {
    Column { key: key.into(), name: name.into(), kind: ColumnKind::Formula, formula: Some(f.into()), decimals }
}

fn set(sheet: &mut Sheet, source: &str, values: &[(&str, Value)]) {
    let id = format!("emberfall-{source}");
    let row = sheet.rows.iter_mut().find(|r| r.source_id.as_deref() == Some(id.as_str())).unwrap_or_else(|| panic!("example row {id}"));
    for (k, v) in values {
        row.values.insert(k.to_string(), v.clone());
    }
}

/// Level and attacks per second for each mob, which Forge Core doesn't track.
const MOB_EXTRAS: [(&str, i64, f64); 7] = [
    ("mob-moss-slime", 1, 0.8),
    ("mob-bramble-wolf", 3, 1.3),
    ("mob-cave-bat", 5, 1.8),
    ("mob-ember-slime", 7, 1.0),
    ("mob-cinder-golem", 10, 0.6),
    ("mob-ashen-skeleton", 11, 1.1),
    ("mob-hollow-king", 14, 0.9),
];

pub fn build(path: &Path) -> Result<Project, String> {
    let p = Project::create(path, NAME)?;
    let entities = exchange::parse_codex_entities(CODEX)?;

    // ---- Mobs: imported, then level, attack speed and formulas added.
    let mut mobs = exchange::import_entities(entities.clone(), "mob", None)?.sheet;
    mobs.name = "Mobs".into();
    mobs.columns.push(number("level", "Level"));
    mobs.columns.push(number("attackSpeed", "Attack speed"));
    mobs.columns.push(formula("dps", "DPS", "damage * attackSpeed", Some(1)));
    mobs.columns.push(formula("ehp", "Effective HP", "health * (1 + armor / 50)", Some(0)));
    mobs.columns.push(formula("power", "Power", "round(sqrt(dps * ehp))", Some(0)));
    mobs.columns.push(formula("xpReward", "XP reward", "round(power * 1.5)", Some(0)));
    for (id, level, speed) in MOB_EXTRAS {
        set(&mut mobs, id, &[("level", json!(level)), ("attackSpeed", json!(speed))]);
    }
    // Patch 0.1 had a few different numbers; snapshot them, then apply 0.2.
    let current: Vec<(&str, &str, Value)> = vec![
        ("mob-cave-bat", "health", json!(22)),
        ("mob-cinder-golem", "damage", json!(28)),
        ("mob-ember-slime", "armor", json!(4)),
        ("mob-bramble-wolf", "attackSpeed", json!(1.3)),
    ];
    let mut old = mobs.clone();
    set(&mut old, "mob-cave-bat", &[("health", json!(16))]);
    set(&mut old, "mob-cinder-golem", &[("damage", json!(34))]);
    set(&mut old, "mob-ember-slime", &[("armor", json!(2))]);
    set(&mut old, "mob-bramble-wolf", &[("attackSpeed", json!(1.6))]);
    let old = p.save_sheet(old)?;
    p.snapshot(&old.id, "Patch 0.1")?;
    let mut mobs = old;
    for (id, k, v) in current {
        set(&mut mobs, id, &[(k, v)]);
    }
    let mobs = p.save_sheet(mobs)?;

    // ---- Items: imported prices with a resale formula.
    let mut items = exchange::import_entities(entities, "item", None)?.sheet;
    items.name = "Items".into();
    items.columns.push(formula("resale", "Resale share", "if(buyPrice > 0, sellPrice / buyPrice, 0)", Some(2)));
    p.save_sheet(items)?;

    // ---- Weapons: typed in by hand. Two rows are off the curve on purpose.
    let weapons_rows: [(&str, Option<&str>, i64, i64, f64, f64, i64); 8] = [
        ("Rusty Sword", Some("item-rusty-sword"), 1, 0, 4.0, 1.0, 0),
        ("Oak Club", None, 1, 40, 6.0, 0.9, 0),
        ("Iron Sword", None, 2, 120, 8.0, 1.1, 5),
        ("Hunter's Bow", None, 2, 150, 7.0, 1.3, 10),
        ("Frost Dagger", None, 3, 160, 9.0, 2.2, 15),
        ("Warden Spear", None, 3, 280, 12.0, 1.0, 5),
        ("Ember Blade", Some("item-ember-blade"), 4, 450, 14.0, 1.2, 10),
        ("Greatsword of Ash", None, 5, 900, 18.0, 0.6, 5),
    ];
    let weapons = Sheet {
        id: String::new(),
        name: "Weapons".into(),
        source_kind: None,
        columns: vec![
            number("tier", "Tier"),
            number("cost", "Cost"),
            number("damage", "Damage"),
            number("attackSpeed", "Attack speed"),
            number("critChance", "Crit chance %"),
            formula("dps", "DPS", "damage * attackSpeed * (1 + critChance / 100)", Some(1)),
            formula("dpsPerGold", "DPS per 100 gold", "if(cost > 0, dps / cost * 100, 0)", Some(2)),
        ],
        rows: weapons_rows
            .iter()
            .map(|(name, source, tier, cost, dmg, speed, crit)| {
                let mut values = Map::new();
                values.insert("tier".into(), json!(tier));
                values.insert("cost".into(), json!(cost));
                values.insert("damage".into(), json!(dmg));
                values.insert("attackSpeed".into(), json!(speed));
                values.insert("critChance".into(), json!(crit));
                Row { id: String::new(), source_id: source.map(|s| format!("emberfall-{s}")), name: name.to_string(), values }
            })
            .collect(),
        updated_at: 0,
    };
    let weapons = p.save_sheet(weapons)?;

    // ---- Screen setups, so the analysis and economy pages open ready to run.
    p.set_setting(
        &format!("analysis:{}", mobs.id),
        &json!({ "costKey": "level", "powerKey": "power", "tolerance": 0.25, "levelKey": "level", "curveKey": "power", "curveTolerance": 0.2 }),
    )?;
    p.set_setting(
        &format!("analysis:{}", weapons.id),
        &json!({ "costKey": "cost", "powerKey": "dps", "tolerance": 0.2, "levelKey": "tier", "curveKey": "dps", "curveTolerance": 0.15 }),
    )?;
    p.set_setting(
        "economy",
        &json!({
            "players": 1000,
            "steps": 60,
            "startBalance": 20,
            "incomes": [
                { "name": "Gold from mobs", "min": 8, "max": 25, "chance": 1 },
                { "name": "Quest reward", "min": 40, "max": 120, "chance": 0.3 },
                { "name": "Selling slime gel", "min": 4, "max": 12, "chance": 0.6 }
            ],
            "spends": [
                { "name": "Health Potion", "cost": 25, "every": 1, "repeat": true },
                { "name": "Mana Tonic", "cost": 40, "every": 3, "repeat": true },
                { "name": "Oak Shield", "cost": 60, "every": 1, "repeat": false },
                { "name": "Ember Blade", "cost": 450, "every": 1, "repeat": false }
            ]
        }),
    )?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sheets_with_working_formulas() {
        let dir = tempfile::tempdir().unwrap();
        let p = build(&dir.path().join("e.balanceforge")).unwrap();
        let sheets = p.sheets().unwrap();
        assert_eq!(sheets.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["Mobs", "Items", "Weapons"]);
        for info in &sheets {
            let s = p.sheet(&info.id).unwrap();
            let c = s.compute();
            assert!(c.column_errors.is_empty(), "{}: {:?}", s.name, c.column_errors);
            assert!(c.cell_errors.values().all(|m| m.is_empty()), "{}: {:?}", s.name, c.cell_errors);
            assert!(s.rows.len() >= 7);
        }
        let mobs = p.sheet(&sheets[0].id).unwrap();
        assert!(mobs.rows.iter().all(|r| r.source_id.as_deref().is_some_and(|id| id.starts_with("emberfall-mob-"))));
        let king = mobs.rows.iter().find(|r| r.name == "The Hollow King").unwrap();
        assert!(mobs.compute().numbers[&king.id]["power"] > 100.0);
        assert_eq!(p.snapshots(&mobs.id).unwrap().len(), 1);
        let snap = p.snapshot_sheet(&p.snapshots(&mobs.id).unwrap()[0].id).unwrap();
        let bat = |s: &Sheet| s.rows.iter().find(|r| r.name == "Cave Bat").unwrap().values["health"].clone();
        assert_ne!(bat(&snap), bat(&mobs));
        assert!(p.setting("economy").unwrap().is_some());
    }
}
