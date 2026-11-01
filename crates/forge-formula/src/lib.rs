//! Formulas like `damage * attackSpeed` or `if(level > 10, hp * 1.2, hp)`.
//!
//! Names are column keys. A name with spaces goes in brackets: `[Attack Speed]`.
//! Operators: `+ - * / % ^`, comparisons `< <= > >= == !=`, `and`, `or`, `not`.
//! Functions: min, max, avg, sum, clamp, abs, round, floor, ceil, sqrt, pow, log, exp, if.

use serde::Serialize;
use std::collections::BTreeSet;
use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Num(f64),
    Var(String),
    Neg(Box<Expr>),
    Not(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Add, Sub, Mul, Div, Rem, Pow, Lt, Le, Gt, Ge, Eq, Ne, And, Or,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FormulaError {
    pub message: String,
    /// Character position in the formula, when the problem has one.
    pub at: Option<usize>,
}

impl fmt::Display for FormulaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.at {
            Some(at) => write!(f, "{} (at character {})", self.message, at + 1),
            None => write!(f, "{}", self.message),
        }
    }
}

impl std::error::Error for FormulaError {}

fn err<T>(message: impl Into<String>, at: Option<usize>) -> Result<T, FormulaError> {
    Err(FormulaError { message: message.into(), at })
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Name(String),
    Op(&'static str),
    LParen,
    RParen,
    Comma,
}

fn tokenize(src: &str) -> Result<Vec<(Tok, usize)>, FormulaError> {
    let chars: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let start = i;
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                let mut j = i + 1;
                if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                    j += 1;
                }
                if j < chars.len() && chars[j].is_ascii_digit() {
                    i = j;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let s: String = chars[start..i].iter().collect();
            let n = s.parse::<f64>().map_err(|_| FormulaError { message: format!("\"{s}\" is not a number"), at: Some(start) })?;
            out.push((Tok::Num(n), start));
        } else if c.is_alphabetic() || c == '_' {
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            out.push((Tok::Name(chars[start..i].iter().collect()), start));
        } else if c == '[' {
            let close = chars[i..].iter().position(|&x| x == ']').map(|p| p + i);
            let Some(close) = close else { return err("Missing ]", Some(start)) };
            let name: String = chars[i + 1..close].iter().collect::<String>().trim().to_string();
            if name.is_empty() {
                return err("Empty [ ]", Some(start));
            }
            out.push((Tok::Name(name), start));
            i = close + 1;
        } else {
            let two: String = chars[i..(i + 2).min(chars.len())].iter().collect();
            let op2 = ["<=", ">=", "==", "!=", "&&", "||"].into_iter().find(|o| *o == two);
            if let Some(o) = op2 {
                out.push((Tok::Op(o), start));
                i += 2;
                continue;
            }
            let tok = match c {
                '+' => Tok::Op("+"),
                '-' => Tok::Op("-"),
                '*' | '×' => Tok::Op("*"),
                '/' | '÷' => Tok::Op("/"),
                '%' => Tok::Op("%"),
                '^' => Tok::Op("^"),
                '<' => Tok::Op("<"),
                '>' => Tok::Op(">"),
                '=' => Tok::Op("=="),
                '!' => Tok::Op("!"),
                '(' => Tok::LParen,
                ')' => Tok::RParen,
                ',' | ';' => Tok::Comma,
                other => return err(format!("Unexpected \"{other}\""), Some(start)),
            };
            out.push((tok, start));
            i += 1;
        }
    }
    Ok(out)
}

struct Parser {
    toks: Vec<(Tok, usize)>,
    pos: usize,
    len: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos).map(|t| &t.0)
    }
    fn at(&self) -> usize {
        self.toks.get(self.pos).map(|t| t.1).unwrap_or(self.len)
    }
    fn is_op(&self, ops: &[&str]) -> Option<&'static str> {
        match self.peek() {
            Some(Tok::Op(o)) if ops.contains(o) => Some(o),
            Some(Tok::Name(n)) if ops.contains(&n.to_lowercase().as_str()) => {
                ["and", "or", "not"].into_iter().find(|w| *w == n.to_lowercase())
            }
            _ => None,
        }
    }
    fn expr(&mut self) -> Result<Expr, FormulaError> {
        self.or()
    }
    fn or(&mut self) -> Result<Expr, FormulaError> {
        let mut l = self.and()?;
        while self.is_op(&["||", "or"]).is_some() {
            self.pos += 1;
            l = Expr::Bin(Op::Or, Box::new(l), Box::new(self.and()?));
        }
        Ok(l)
    }
    fn and(&mut self) -> Result<Expr, FormulaError> {
        let mut l = self.cmp()?;
        while self.is_op(&["&&", "and"]).is_some() {
            self.pos += 1;
            l = Expr::Bin(Op::And, Box::new(l), Box::new(self.cmp()?));
        }
        Ok(l)
    }
    fn cmp(&mut self) -> Result<Expr, FormulaError> {
        let l = self.add()?;
        if let Some(o) = self.is_op(&["<", "<=", ">", ">=", "==", "!="]) {
            self.pos += 1;
            let op = match o { "<" => Op::Lt, "<=" => Op::Le, ">" => Op::Gt, ">=" => Op::Ge, "==" => Op::Eq, _ => Op::Ne };
            return Ok(Expr::Bin(op, Box::new(l), Box::new(self.add()?)));
        }
        Ok(l)
    }
    fn add(&mut self) -> Result<Expr, FormulaError> {
        let mut l = self.mul()?;
        while let Some(o) = self.is_op(&["+", "-"]) {
            self.pos += 1;
            let op = if o == "+" { Op::Add } else { Op::Sub };
            l = Expr::Bin(op, Box::new(l), Box::new(self.mul()?));
        }
        Ok(l)
    }
    fn mul(&mut self) -> Result<Expr, FormulaError> {
        let mut l = self.unary()?;
        while let Some(o) = self.is_op(&["*", "/", "%"]) {
            self.pos += 1;
            let op = match o { "*" => Op::Mul, "/" => Op::Div, _ => Op::Rem };
            l = Expr::Bin(op, Box::new(l), Box::new(self.unary()?));
        }
        Ok(l)
    }
    fn unary(&mut self) -> Result<Expr, FormulaError> {
        if self.is_op(&["-"]).is_some() {
            self.pos += 1;
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        if self.is_op(&["+"]).is_some() {
            self.pos += 1;
            return self.unary();
        }
        if self.is_op(&["!", "not"]).is_some() {
            self.pos += 1;
            return Ok(Expr::Not(Box::new(self.unary()?)));
        }
        self.pow()
    }
    fn pow(&mut self) -> Result<Expr, FormulaError> {
        let base = self.primary()?;
        if self.is_op(&["^"]).is_some() {
            self.pos += 1;
            // Right-associative: 2^3^2 = 2^(3^2).
            return Ok(Expr::Bin(Op::Pow, Box::new(base), Box::new(self.unary()?)));
        }
        Ok(base)
    }
    fn primary(&mut self) -> Result<Expr, FormulaError> {
        let at = self.at();
        match self.toks.get(self.pos).cloned() {
            Some((Tok::Num(n), _)) => {
                self.pos += 1;
                Ok(Expr::Num(n))
            }
            Some((Tok::Name(n), _)) => {
                self.pos += 1;
                if self.peek() == Some(&Tok::LParen) {
                    self.pos += 1;
                    let mut args = Vec::new();
                    if self.peek() != Some(&Tok::RParen) {
                        loop {
                            args.push(self.expr()?);
                            match self.peek() {
                                Some(Tok::Comma) => self.pos += 1,
                                Some(Tok::RParen) => break,
                                _ => return err("Expected , or )", Some(self.at())),
                            }
                        }
                    }
                    self.pos += 1;
                    let name = n.to_lowercase();
                    check_call(&name, args.len(), at)?;
                    Ok(Expr::Call(name, args))
                } else {
                    Ok(Expr::Var(n))
                }
            }
            Some((Tok::LParen, _)) => {
                self.pos += 1;
                let e = self.expr()?;
                if self.peek() != Some(&Tok::RParen) {
                    return err("Missing )", Some(self.at()));
                }
                self.pos += 1;
                Ok(e)
            }
            Some((t, _)) => err(format!("Unexpected {}", describe(&t)), Some(at)),
            None => err("The formula ends too early", Some(at)),
        }
    }
}

fn describe(t: &Tok) -> String {
    match t {
        Tok::Op(o) => format!("\"{o}\""),
        Tok::RParen => "\")\"".into(),
        Tok::Comma => "\",\"".into(),
        Tok::LParen => "\"(\"".into(),
        Tok::Num(n) => n.to_string(),
        Tok::Name(n) => n.clone(),
    }
}

/// Every function a formula can call, with its allowed argument counts.
pub const FUNCTIONS: &[(&str, usize, usize, &str)] = &[
    ("min", 1, usize::MAX, "Smallest value"),
    ("max", 1, usize::MAX, "Largest value"),
    ("avg", 1, usize::MAX, "Average"),
    ("sum", 1, usize::MAX, "Total"),
    ("clamp", 3, 3, "clamp(x, low, high)"),
    ("abs", 1, 1, "Absolute value"),
    ("round", 1, 2, "round(x) or round(x, digits)"),
    ("floor", 1, 1, "Round down"),
    ("ceil", 1, 1, "Round up"),
    ("sqrt", 1, 1, "Square root"),
    ("pow", 2, 2, "pow(x, y) = x^y"),
    ("log", 1, 2, "Natural log, or log(x, base)"),
    ("exp", 1, 1, "e^x"),
    ("if", 3, 3, "if(condition, then, else)"),
];

fn check_call(name: &str, n: usize, at: usize) -> Result<(), FormulaError> {
    let Some((_, lo, hi, help)) = FUNCTIONS.iter().find(|f| f.0 == name) else {
        return err(format!("Unknown function \"{name}\""), Some(at));
    };
    if n < *lo || n > *hi {
        return err(format!("{name} takes {} ({help})", if lo == hi { format!("{lo} values") } else if *hi == usize::MAX { format!("at least {lo} value") } else { format!("{lo} to {hi} values") }), Some(at));
    }
    Ok(())
}

pub fn parse(src: &str) -> Result<Expr, FormulaError> {
    let toks = tokenize(src)?;
    if toks.is_empty() {
        return err("The formula is empty", None);
    }
    let mut p = Parser { toks, pos: 0, len: src.chars().count() };
    let e = p.expr()?;
    if p.pos < p.toks.len() {
        return err(format!("Unexpected {}", describe(&p.toks[p.pos].0)), Some(p.at()));
    }
    Ok(e)
}

impl Expr {
    /// Every name the formula reads.
    pub fn references(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        fn walk(e: &Expr, out: &mut BTreeSet<String>) {
            match e {
                Expr::Var(v) => {
                    out.insert(v.clone());
                }
                Expr::Num(_) => {}
                Expr::Neg(x) | Expr::Not(x) => walk(x, out),
                Expr::Bin(_, a, b) => {
                    walk(a, out);
                    walk(b, out);
                }
                Expr::Call(_, args) => args.iter().for_each(|a| walk(a, out)),
            }
        }
        walk(self, &mut out);
        out
    }

    /// Evaluates with `lookup` supplying each name's value.
    pub fn eval(&self, lookup: &dyn Fn(&str) -> Option<f64>) -> Result<f64, FormulaError> {
        let b = |x: bool| if x { 1.0 } else { 0.0 };
        Ok(match self {
            Expr::Num(n) => *n,
            Expr::Var(v) => lookup(v).ok_or_else(|| FormulaError { message: format!("No value for \"{v}\""), at: None })?,
            Expr::Neg(x) => -x.eval(lookup)?,
            Expr::Not(x) => b(x.eval(lookup)? == 0.0),
            Expr::Bin(op, l, r) => {
                let a = l.eval(lookup)?;
                // Short-circuit so `x > 0 and y / x > 2` never divides by zero.
                match op {
                    Op::And if a == 0.0 => return Ok(0.0),
                    Op::Or if a != 0.0 => return Ok(1.0),
                    _ => {}
                }
                let c = r.eval(lookup)?;
                match op {
                    Op::Add => a + c,
                    Op::Sub => a - c,
                    Op::Mul => a * c,
                    Op::Div => {
                        if c == 0.0 {
                            return err("Division by zero", None);
                        }
                        a / c
                    }
                    Op::Rem => {
                        if c == 0.0 {
                            return err("Division by zero", None);
                        }
                        a % c
                    }
                    Op::Pow => a.powf(c),
                    Op::Lt => b(a < c),
                    Op::Le => b(a <= c),
                    Op::Gt => b(a > c),
                    Op::Ge => b(a >= c),
                    Op::Eq => b((a - c).abs() < 1e-9),
                    Op::Ne => b((a - c).abs() >= 1e-9),
                    Op::And | Op::Or => b(c != 0.0),
                }
            }
            Expr::Call(name, args) => {
                if name == "if" {
                    return if args[0].eval(lookup)? != 0.0 { args[1].eval(lookup) } else { args[2].eval(lookup) };
                }
                let v: Vec<f64> = args.iter().map(|a| a.eval(lookup)).collect::<Result<_, _>>()?;
                match name.as_str() {
                    "min" => v.iter().cloned().fold(f64::INFINITY, f64::min),
                    "max" => v.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
                    "sum" => v.iter().sum(),
                    "avg" => v.iter().sum::<f64>() / v.len() as f64,
                    "clamp" => v[0].max(v[1]).min(v[2]),
                    "abs" => v[0].abs(),
                    "round" => {
                        let d = 10f64.powi(v.get(1).copied().unwrap_or(0.0) as i32);
                        (v[0] * d).round() / d
                    }
                    "floor" => v[0].floor(),
                    "ceil" => v[0].ceil(),
                    "sqrt" => {
                        if v[0] < 0.0 {
                            return err("Square root of a negative number", None);
                        }
                        v[0].sqrt()
                    }
                    "pow" => v[0].powf(v[1]),
                    "log" => {
                        if v[0] <= 0.0 {
                            return err("Log of zero or a negative number", None);
                        }
                        match v.get(1) {
                            Some(base) => v[0].ln() / base.ln(),
                            None => v[0].ln(),
                        }
                    }
                    "exp" => v[0].exp(),
                    other => return err(format!("Unknown function \"{other}\""), None),
                }
            }
        })
    }
}

/// Parses and evaluates in one go.
pub fn eval(src: &str, lookup: &dyn Fn(&str) -> Option<f64>) -> Result<f64, FormulaError> {
    parse(src)?.eval(lookup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn run(src: &str) -> Result<f64, FormulaError> {
        let vars: HashMap<&str, f64> = [("damage", 50.0), ("attackSpeed", 1.5), ("Attack Speed", 2.0), ("level", 12.0), ("zero", 0.0)].into();
        eval(src, &|n| vars.get(n).copied())
    }

    #[test]
    fn arithmetic_and_precedence() {
        assert_eq!(run("1 + 2 * 3").unwrap(), 7.0);
        assert_eq!(run("(1 + 2) * 3").unwrap(), 9.0);
        assert_eq!(run("2 ^ 3 ^ 2").unwrap(), 512.0);
        assert_eq!(run("-2 ^ 2").unwrap(), -4.0);
        assert_eq!(run("10 % 4").unwrap(), 2.0);
        assert_eq!(run("1.5e2").unwrap(), 150.0);
        assert_eq!(run("6 × 7 ÷ 2").unwrap(), 21.0);
    }

    #[test]
    fn names_and_brackets() {
        assert_eq!(run("damage * attackSpeed").unwrap(), 75.0);
        assert_eq!(run("damage * [Attack Speed]").unwrap(), 100.0);
        assert_eq!(parse("a + [b c] * a").unwrap().references().into_iter().collect::<Vec<_>>(), ["a", "b c"]);
    }

    #[test]
    fn functions_and_logic() {
        assert_eq!(run("if(level > 10, damage * 1.2, damage)").unwrap(), 60.0);
        assert_eq!(run("max(1, damage, 3)").unwrap(), 50.0);
        assert_eq!(run("avg(2, 4)").unwrap(), 3.0);
        assert_eq!(run("clamp(damage, 0, 20)").unwrap(), 20.0);
        assert_eq!(run("round(10 / 3, 2)").unwrap(), 3.33);
        assert_eq!(run("log(8, 2)").unwrap(), 3.0);
        assert_eq!(run("level >= 12 and not (damage < 10)").unwrap(), 1.0);
        assert_eq!(run("zero != 0 and damage / zero > 1").unwrap(), 0.0);
        assert_eq!(run("level = 12").unwrap(), 1.0);
        assert_eq!(run("MAX(1, 2)").unwrap(), 2.0);
    }

    #[test]
    fn helpful_errors() {
        assert_eq!(run("").unwrap_err().message, "The formula is empty");
        assert!(run("damage *").unwrap_err().message.contains("ends too early"));
        assert_eq!(run("1 + (2").unwrap_err().message, "Missing )");
        assert_eq!(run("health * 2").unwrap_err().message, "No value for \"health\"");
        assert!(run("frobnicate(2)").unwrap_err().message.contains("Unknown function"));
        assert!(run("clamp(1, 2)").unwrap_err().message.contains("clamp takes 3 values"));
        assert_eq!(run("damage / zero").unwrap_err().message, "Division by zero");
        let e = run("2 $ 3").unwrap_err();
        assert_eq!(e.at, Some(2));
        assert!(run("1 2").unwrap_err().message.starts_with("Unexpected"));
        assert!(run("sqrt(-1)").is_err());
    }
}
