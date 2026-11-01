//! Stat sheets: rows of game things (units, weapons...) with number, text and
//! formula columns. Formula columns are worked out here, in dependency order.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColumnKind {
    Number,
    Text,
    Formula,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    /// Name used inside formulas, e.g. "attackSpeed".
    pub key: String,
    /// Header shown in the sheet, e.g. "Attack speed".
    pub name: String,
    pub kind: ColumnKind,
    #[serde(default)]
    pub formula: Option<String>,
    /// Decimal places to show.
    #[serde(default)]
    pub decimals: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    /// The Forge Core entry this row came from, if imported.
    #[serde(default)]
    pub source_id: Option<String>,
    pub name: String,
    /// Number and text column values by key. Formula columns are not stored.
    #[serde(default)]
    pub values: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub id: String,
    pub name: String,
    /// Forge Core module this sheet was imported from ("mob", "item"...).
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub columns: Vec<Column>,
    #[serde(default)]
    pub rows: Vec<Row>,
    #[serde(default)]
    pub updated_at: i64,
}

/// A sheet with every formula worked out.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Computed {
    /// Row id -> column key -> number (number and formula columns).
    pub numbers: HashMap<String, BTreeMap<String, f64>>,
    /// Row id -> column key -> why the formula failed for that row.
    pub cell_errors: HashMap<String, BTreeMap<String, String>>,
    /// Column key -> problem with the formula itself (syntax, unknown name, loop).
    pub column_errors: BTreeMap<String, String>,
}

pub fn is_valid_key(k: &str) -> bool {
    let mut chars = k.chars();
    matches!(chars.next(), Some(c) if c.is_alphabetic() || c == '_') && chars.all(|c| c.is_alphanumeric() || c == '_')
}

impl Sheet {
    /// Checks column keys are valid and unique, and that "name" is free
    /// (it is the row name).
    pub fn validate(&self) -> Result<(), String> {
        let mut seen = HashSet::new();
        for c in &self.columns {
            if !is_valid_key(&c.key) {
                return Err(format!("\"{}\" can't be used as a column key. Use letters, digits and _.", c.key));
            }
            if c.key == "name" {
                return Err("\"name\" is reserved for the row name".into());
            }
            if !seen.insert(c.key.to_lowercase()) {
                return Err(format!("Two columns use the key \"{}\"", c.key));
            }
        }
        Ok(())
    }

    pub fn number(row: &Row, key: &str) -> Option<f64> {
        match row.values.get(key)? {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    }

    /// The column key a formula name points at: a key as written, or a key
    /// or column name in any case, so `[Attack speed]` finds `attackSpeed`.
    fn resolver(&self) -> impl Fn(&str) -> Option<String> + '_ {
        let mut by_lower: HashMap<String, String> = HashMap::new();
        for c in &self.columns {
            by_lower.entry(c.name.trim().to_lowercase()).or_insert_with(|| c.key.clone());
        }
        for c in &self.columns {
            by_lower.insert(c.key.to_lowercase(), c.key.clone());
        }
        move |n: &str| {
            if self.columns.iter().any(|c| c.key == n) {
                Some(n.to_string())
            } else {
                by_lower.get(&n.trim().to_lowercase()).cloned()
            }
        }
    }

    pub fn compute(&self) -> Computed {
        let mut column_errors = BTreeMap::new();
        let resolve = self.resolver();

        // Each formula with the column keys it reads.
        let mut parsed: Vec<(&Column, forge_formula::Expr, HashMap<String, String>)> = Vec::new();
        for c in self.columns.iter().filter(|c| c.kind == ColumnKind::Formula) {
            match forge_formula::parse(c.formula.as_deref().unwrap_or("")) {
                Ok(e) => {
                    let mut refs = HashMap::new();
                    let mut unknown = Vec::new();
                    for r in e.references() {
                        match resolve(&r) {
                            Some(k) => {
                                refs.insert(r, k);
                            }
                            None => unknown.push(r),
                        }
                    }
                    if unknown.is_empty() {
                        parsed.push((c, e, refs));
                    } else {
                        column_errors.insert(c.key.clone(), format!("Unknown column {}", unknown.iter().map(|u| format!("\"{u}\"")).collect::<Vec<_>>().join(", ")));
                    }
                }
                Err(e) => {
                    column_errors.insert(c.key.clone(), e.to_string());
                }
            }
        }

        // Order formulas so each runs after the formulas it reads.
        let formula_keys: HashSet<String> = parsed.iter().map(|(c, _, _)| c.key.clone()).collect();
        let mut order: Vec<usize> = Vec::new();
        let mut done: HashSet<String> = HashSet::new();
        let mut remaining: Vec<usize> = (0..parsed.len()).collect();
        while !remaining.is_empty() {
            let before = remaining.len();
            remaining.retain(|&i| {
                let ready = parsed[i].2.values().all(|d| !formula_keys.contains(d) || done.contains(d));
                if ready {
                    done.insert(parsed[i].0.key.clone());
                    order.push(i);
                }
                !ready
            });
            if remaining.len() == before {
                for &i in &remaining {
                    column_errors.insert(parsed[i].0.key.clone(), "This formula depends on itself through other columns".into());
                }
                break;
            }
        }
        // Columns whose formula is broken count as missing for formulas that read them.
        let broken: HashSet<String> = column_errors.keys().cloned().collect();

        let mut numbers = HashMap::new();
        let mut cell_errors: HashMap<String, BTreeMap<String, String>> = HashMap::new();
        for row in &self.rows {
            let mut vals: BTreeMap<String, f64> = BTreeMap::new();
            for c in self.columns.iter().filter(|c| c.kind == ColumnKind::Number) {
                if let Some(n) = Sheet::number(row, &c.key) {
                    vals.insert(c.key.clone(), n);
                }
            }
            for &i in &order {
                let (c, e, refs) = &parsed[i];
                let bad_dep = refs.values().find(|k| broken.contains(*k));
                let result = match bad_dep {
                    Some(d) => Err(format!("Column \"{d}\" has a problem")),
                    None => e.eval(&|n| refs.get(n).and_then(|k| vals.get(k)).copied()).map_err(|e| e.message),
                };
                match result {
                    Ok(v) if v.is_finite() => {
                        vals.insert(c.key.clone(), v);
                    }
                    Ok(_) => {
                        cell_errors.entry(row.id.clone()).or_default().insert(c.key.clone(), "Result is too large".into());
                    }
                    Err(m) => {
                        cell_errors.entry(row.id.clone()).or_default().insert(c.key.clone(), m);
                    }
                }
            }
            numbers.insert(row.id.clone(), vals);
        }
        Computed { numbers, cell_errors, column_errors }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use serde_json::json;

    pub fn col(key: &str, kind: ColumnKind, formula: Option<&str>) -> Column {
        Column { key: key.into(), name: key.into(), kind, formula: formula.map(String::from), decimals: None }
    }

    pub fn row(id: &str, name: &str, vals: Value) -> Row {
        Row { id: id.into(), source_id: None, name: name.into(), values: vals.as_object().unwrap().clone() }
    }

    pub fn units() -> Sheet {
        Sheet {
            id: "s".into(),
            name: "Units".into(),
            source_kind: None,
            columns: vec![
                col("health", ColumnKind::Number, None),
                col("damage", ColumnKind::Number, None),
                col("attackSpeed", ColumnKind::Number, None),
                col("cost", ColumnKind::Number, None),
                col("role", ColumnKind::Text, None),
                // Declared before the column it reads, to check ordering.
                col("valuePerGold", ColumnKind::Formula, Some("(dps * health) / cost")),
                col("dps", ColumnKind::Formula, Some("damage * attackSpeed")),
            ],
            rows: vec![
                row("a", "Knight", json!({"health": 500, "damage": 40, "attackSpeed": 1, "cost": 100, "role": "Tank"})),
                row("b", "Archer", json!({"health": 200, "damage": "30", "attackSpeed": 2, "cost": 0})),
                row("c", "Peasant", json!({"health": 50})),
            ],
            updated_at: 0,
        }
    }

    #[test]
    fn computes_in_dependency_order() {
        let c = units().compute();
        assert!(c.column_errors.is_empty());
        assert_eq!(c.numbers["a"]["dps"], 40.0);
        assert_eq!(c.numbers["a"]["valuePerGold"], 200.0);
        assert_eq!(c.numbers["b"]["dps"], 60.0, "numbers typed as text still count");
        assert_eq!(c.cell_errors["b"]["valuePerGold"], "Division by zero");
        assert_eq!(c.cell_errors["c"]["dps"], "No value for \"damage\"");
    }

    #[test]
    fn reports_bad_formulas_and_loops() {
        let mut s = units();
        s.columns.push(col("x", ColumnKind::Formula, Some("y + 1")));
        s.columns.push(col("y", ColumnKind::Formula, Some("x + 1")));
        s.columns.push(col("bad", ColumnKind::Formula, Some("damage *")));
        s.columns.push(col("ghost", ColumnKind::Formula, Some("mana * 2")));
        s.columns.push(col("usesBad", ColumnKind::Formula, Some("bad + 1")));
        let c = s.compute();
        assert!(c.column_errors["x"].contains("depends on itself"));
        assert!(c.column_errors["y"].contains("depends on itself"));
        assert!(c.column_errors["bad"].contains("ends too early"));
        assert_eq!(c.column_errors["ghost"], "Unknown column \"mana\"");
        assert_eq!(c.cell_errors["a"]["usesBad"], "Column \"bad\" has a problem");
        assert_eq!(c.numbers["a"]["dps"], 40.0, "good columns still work");
    }

    #[test]
    fn formulas_can_use_column_names() {
        let mut s = units();
        s.columns[2].name = "Attack speed".into();
        s.columns.push(col("burst", ColumnKind::Formula, Some("[attack speed] * DAMAGE * 3")));
        let c = s.compute();
        assert!(c.column_errors.is_empty(), "{:?}", c.column_errors);
        assert_eq!(c.numbers["a"]["burst"], 120.0);
    }

    #[test]
    fn keys() {
        assert!(is_valid_key("hp_max2") && !is_valid_key("2hp") && !is_valid_key("a b"));
        let mut s = units();
        assert!(s.validate().is_ok());
        s.columns.push(col("Health", ColumnKind::Number, None));
        assert!(s.validate().unwrap_err().contains("Two columns"));
    }
}
