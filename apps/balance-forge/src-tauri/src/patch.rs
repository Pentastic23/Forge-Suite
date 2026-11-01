//! Compare two versions of a sheet and write patch notes.

use serde::Serialize;
use serde_json::Value;

use crate::sheet::{ColumnKind, Sheet};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub row_id: String,
    pub row_name: String,
    pub column: String,
    pub column_name: String,
    pub before: Option<String>,
    pub after: Option<String>,
    /// Percent change for numbers, when both sides have a value.
    pub percent: Option<f64>,
    /// True for formula columns (a knock-on effect, not a direct edit).
    pub derived: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub changes: Vec<Change>,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub notes: String,
}

fn show(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{v:.0}")
    } else {
        let s = format!("{v:.2}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

pub fn diff(before: &Sheet, after: &Sheet, title: &str) -> Diff {
    let (cb, ca) = (before.compute(), after.compute());
    let mut changes = Vec::new();
    let mut added = Vec::new();
    for row in &after.rows {
        let Some(old) = before.rows.iter().find(|r| r.id == row.id) else {
            added.push(row.name.clone());
            continue;
        };
        for c in &after.columns {
            let (b, a, pct) = match c.kind {
                ColumnKind::Text => {
                    let t = |v: Option<&Value>| v.and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
                    (t(old.values.get(&c.key)), t(row.values.get(&c.key)), None)
                }
                _ => {
                    let nb = cb.numbers.get(&old.id).and_then(|m| m.get(&c.key)).copied();
                    let na = ca.numbers.get(&row.id).and_then(|m| m.get(&c.key)).copied();
                    if let (Some(x), Some(y)) = (nb, na) {
                        if (x - y).abs() < 1e-9 {
                            continue;
                        }
                    }
                    let pct = match (nb, na) {
                        (Some(x), Some(y)) if x != 0.0 => Some((y - x) / x.abs() * 100.0),
                        _ => None,
                    };
                    (nb.map(show), na.map(show), pct)
                }
            };
            if b != a {
                changes.push(Change {
                    row_id: row.id.clone(),
                    row_name: row.name.clone(),
                    column: c.key.clone(),
                    column_name: c.name.clone(),
                    before: b,
                    after: a,
                    percent: pct,
                    derived: c.kind == ColumnKind::Formula,
                });
            }
        }
    }
    let removed: Vec<String> = before.rows.iter().filter(|r| !after.rows.iter().any(|a| a.id == r.id)).map(|r| r.name.clone()).collect();

    // Patch notes: direct changes, grouped by row, buffs and nerfs worded plainly.
    let mut notes = format!("## {title}\n");
    let mut rows: Vec<&str> = Vec::new();
    for ch in changes.iter().filter(|c| !c.derived) {
        if !rows.contains(&ch.row_name.as_str()) {
            rows.push(&ch.row_name);
        }
    }
    for name in &rows {
        notes.push_str(&format!("\n**{name}**\n"));
        for ch in changes.iter().filter(|c| !c.derived && c.row_name == *name) {
            let line = match (&ch.before, &ch.after, ch.percent) {
                (Some(b), Some(a), Some(p)) => format!("- {}: {b} → {a} ({}{:.1}%)", ch.column_name, if p > 0.0 { "+" } else { "" }, p),
                (Some(b), Some(a), None) => format!("- {}: {b} → {a}", ch.column_name),
                (None, Some(a), _) => format!("- {}: now {a}", ch.column_name),
                (Some(b), None, _) => format!("- {}: removed (was {b})", ch.column_name),
                (None, None, _) => continue,
            };
            notes.push_str(&line);
            notes.push('\n');
        }
    }
    if !added.is_empty() {
        notes.push_str(&format!("\n**New:** {}\n", added.join(", ")));
    }
    if !removed.is_empty() {
        notes.push_str(&format!("\n**Removed:** {}\n", removed.join(", ")));
    }
    if rows.is_empty() && added.is_empty() && removed.is_empty() {
        notes.push_str("\nNo changes.\n");
    }
    Diff { changes, added, removed, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::tests::{row, units};
    use serde_json::json;

    #[test]
    fn finds_changes_and_writes_notes() {
        let before = units();
        let mut after = units();
        after.rows[0].values.insert("damage".into(), json!(44));
        after.rows[0].values.insert("role".into(), json!("Bruiser"));
        after.rows.retain(|r| r.id != "c");
        after.rows.push(row("d", "Mage", json!({"health": 120})));
        let d = diff(&before, &after, "Patch 1.1");

        let dmg = d.changes.iter().find(|c| c.column == "damage").unwrap();
        assert_eq!((dmg.before.as_deref(), dmg.after.as_deref()), (Some("40"), Some("44")));
        assert!((dmg.percent.unwrap() - 10.0).abs() < 1e-9);
        let dps = d.changes.iter().find(|c| c.column == "dps").unwrap();
        assert!(dps.derived, "formula knock-on changes are marked");
        assert_eq!(d.added, ["Mage"]);
        assert_eq!(d.removed, ["Peasant"]);
        assert!(d.notes.contains("**Knight**\n- damage: 40 → 44 (+10.0%)\n- role: Tank → Bruiser"));
        assert!(!d.notes.contains("dps"), "notes list direct edits only");
        assert!(d.notes.contains("**New:** Mage") && d.notes.contains("**Removed:** Peasant"));
    }

    #[test]
    fn no_changes() {
        let d = diff(&units(), &units(), "Same");
        assert!(d.changes.is_empty());
        assert!(d.notes.contains("No changes."));
        assert_eq!(show(2.50), "2.5");
        assert_eq!(show(3.0), "3");
    }
}
