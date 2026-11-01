// Pure helpers for the sheet and the analysis charts. No UI here, so it is easy to test.
import type { Column, Computed, Fighter, Sheet } from "./api";

/** "Attack speed" -> "attackSpeed". */
export function keyFromName(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let out = words.map((w, i) => (i === 0 ? w[0].toLowerCase() : w[0].toUpperCase()) + w.slice(1)).join("");
  if (!out || /^\d/.test(out)) out = "_" + out;
  return out;
}

export function isValidKey(k: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(k);
}

/** A key for a new column that doesn't clash with the others (or with "name"). */
export function uniqueKey(name: string, columns: Column[], except?: string): string {
  const taken = new Set(columns.filter((c) => c.key !== except).map((c) => c.key.toLowerCase()));
  taken.add("name");
  const base = keyFromName(name);
  let key = base;
  for (let n = 2; taken.has(key.toLowerCase()); n++) key = `${base}${n}`;
  return key;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Points formulas that used `oldKey` at `newKey`. Function calls like max( are left alone. */
export function renameInFormula(formula: string, oldKey: string, newKey: string): string {
  return formula.replace(new RegExp(`(?<![\\p{L}\\p{N}_\\[])${escapeRe(oldKey)}(?![\\p{L}\\p{N}_(\\]])`, "gu"), newKey);
}

export function fmt(n: number | undefined | null, decimals?: number | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "";
  if (decimals !== undefined && decimals !== null) return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const abs = Math.abs(n);
  return n.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3 });
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPct(n: number): string {
  const s = (n * 100).toFixed(Math.abs(n) < 0.1 ? 1 : 0);
  return n > 0 ? `+${s}%` : `${s}%`;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function numericColumns(sheet: Sheet): Column[] {
  return sheet.columns.filter((c) => c.kind !== "text");
}

export interface Point { id: string; name: string; x: number; y: number }

/** Rows that have a number in both columns. */
export function points(sheet: Sheet, computed: Computed | undefined, xKey: string, yKey: string): Point[] {
  if (!computed) return [];
  const out: Point[] = [];
  for (const r of sheet.rows) {
    const vals = computed.numbers[r.id];
    const x = vals?.[xKey];
    const y = vals?.[yKey];
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ id: r.id, name: r.name || "Unnamed", x, y });
  }
  return out;
}

export interface Fit { slope: number; intercept: number }

/**
 * A trend line that one overpowered row can't drag around: the slope is the
 * median of the slopes between every pair of rows (Theil-Sen).
 */
export function robustFit(pts: Point[]): Fit | null {
  if (pts.length < 2) return null;
  const sample = pts.length > 1500 ? pts.filter((_, i) => i % Math.ceil(pts.length / 1500) === 0) : pts;
  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dx = sample[j].x - sample[i].x;
      if (dx !== 0) slopes.push((sample[j].y - sample[i].y) / dx);
    }
  }
  if (slopes.length === 0) return { slope: 0, intercept: median(pts.map((p) => p.y)) };
  const slope = median(slopes);
  const intercept = median(pts.map((p) => p.y - slope * p.x));
  return { slope, intercept };
}

export type Verdict = "strong" | "weak" | "ok";

export interface Judged extends Point {
  expected: number;
  /** How far above (+) or below (-) the trend the row is, as a share of the trend. */
  off: number;
  verdict: Verdict;
}

/** Compares each row's power with what the trend says its cost should buy. */
export function judgeCostVsPower(pts: Point[], tolerance: number): { fit: Fit | null; rows: Judged[] } {
  const fit = robustFit(pts);
  if (!fit) return { fit, rows: [] };
  const typical = median(pts.map((p) => Math.abs(p.y))) || 1;
  const rows = pts.map((p) => {
    const expected = fit.slope * p.x + fit.intercept;
    // Near zero, a share of the trend explodes, so measure against a typical value instead.
    const base = Math.max(Math.abs(expected), typical * 0.25);
    const off = (p.y - expected) / base;
    const verdict: Verdict = off > tolerance ? "strong" : off < -tolerance ? "weak" : "ok";
    return { ...p, expected, off, verdict };
  });
  return { fit, rows };
}

export interface CurveLevel {
  x: number;
  /** Median of the rows at this level. */
  y: number;
  names: string[];
  /** y divided by the previous level's y, or null for the first. */
  growth: number | null;
  flag: "jump" | "dip" | null;
}

/**
 * Groups rows by x (level, tier...) and follows the median at each level.
 * Flags a step whose growth is far from the typical step: a spike, or a
 * flat spot or drop in the curve.
 */
export function powerCurve(pts: Point[], tolerance: number): { levels: CurveLevel[]; typicalGrowth: number | null } {
  const byX = new Map<number, Point[]>();
  for (const p of pts) byX.set(p.x, [...(byX.get(p.x) ?? []), p]);
  const xs = [...byX.keys()].sort((a, b) => a - b);
  const base = xs.map((x) => {
    const group = byX.get(x)!;
    return { x, y: median(group.map((p) => p.y)), names: group.map((p) => p.name).sort((a, b) => a.localeCompare(b)) };
  });
  const growths = base.map((l, i) => (i > 0 && base[i - 1].y > 0 && l.y > 0 ? l.y / base[i - 1].y : null));
  const valid = growths.filter((g): g is number => g !== null);
  const typical = valid.length >= 2 ? median(valid) : null;
  const levels = base.map((l, i) => {
    const g = growths[i];
    let flag: CurveLevel["flag"] = null;
    if (typical !== null && g !== null) {
      // Compare step sizes in log space so +50% and -33% count the same.
      const d = Math.log(g) - Math.log(typical);
      const t = Math.log(1 + tolerance);
      if (d > t) flag = "jump";
      else if (d < -t) flag = "dip";
    }
    return { ...l, growth: g, flag };
  });
  return { levels, typicalGrowth: typical };
}

/** Nice round axis ticks covering [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) {
    const pad = Math.abs(lo) || 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------- combat mapping

export type StatKey = Exclude<keyof Fighter, "name">;

export const STATS: { key: StatKey; label: string; hint: string; fallback: number; guesses: string[] }[] = [
  { key: "health", label: "Health", hint: "Hit points", fallback: 0, guesses: ["health", "hp", "hitpoints", "maxhealth", "maxhp", "life"] },
  { key: "damage", label: "Damage", hint: "Per hit", fallback: 0, guesses: ["damage", "dmg", "attack", "atk", "power"] },
  { key: "attackSpeed", label: "Attack speed", hint: "Hits per second", fallback: 1, guesses: ["attackspeed", "atkspeed", "aps", "speed", "attackrate", "rate"] },
  { key: "armor", label: "Armor", hint: "Leave empty for none", fallback: 0, guesses: ["armor", "armour", "defense", "defence", "def"] },
  { key: "critChance", label: "Crit chance", hint: "0 to 1, or a percent", fallback: 0, guesses: ["critchance", "crit", "critrate"] },
  { key: "critMultiplier", label: "Crit damage", hint: "Multiplier, default 2", fallback: 2, guesses: ["critmultiplier", "critdamage", "critmult"] },
  { key: "hitChance", label: "Hit chance", hint: "0 to 1, or a percent", fallback: 1, guesses: ["hitchance", "accuracy", "hit"] },
];

export type StatMap = Partial<Record<StatKey, string>>;

export function guessStatMap(columns: Column[]): StatMap {
  const out: StatMap = {};
  const numeric = columns.filter((c) => c.kind !== "text");
  for (const s of STATS) {
    const found = numeric.find((c) => s.guesses.includes(c.key.toLowerCase()) || s.guesses.includes(keyFromName(c.name).toLowerCase()));
    if (found) out[s.key] = found.key;
  }
  return out;
}

function chance(v: number): number {
  return v > 1 ? v / 100 : v;
}

export function fighterFor(name: string, vals: Record<string, number> | undefined, map: StatMap): Fighter {
  const get = (k: StatKey, fallback: number) => {
    const col = map[k];
    const v = col ? vals?.[col] : undefined;
    return Number.isFinite(v) ? (v as number) : fallback;
  };
  return {
    name,
    health: get("health", 0),
    damage: get("damage", 0),
    attackSpeed: get("attackSpeed", 1),
    armor: get("armor", 0),
    critChance: chance(get("critChance", 0)),
    critMultiplier: get("critMultiplier", 2),
    hitChance: chance(get("hitChance", 1)),
  };
}

export function winVerdict(overall: number): Verdict {
  return overall >= 0.65 ? "strong" : overall <= 0.35 ? "weak" : "ok";
}
