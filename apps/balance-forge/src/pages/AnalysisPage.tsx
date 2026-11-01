import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, PageHeader } from "@forge/ui";
import type { Column, Computed, Sheet } from "../api";
import { fmt, judgeCostVsPower, median, numericColumns, points, powerCurve, signedPct } from "../analysis";
import { CurveChart, Legend, ScatterChart } from "../components/Charts";
import { usePersisted } from "../usePersisted";
import type { Notify } from "../App";

/** The first column matching a word, trying words in order of preference. */
function guess(cols: Column[], words: string[], prefer?: (c: Column) => boolean): string {
  const hit = (c: Column, w: string) => c.key.toLowerCase().includes(w) || c.name.toLowerCase().includes(w);
  for (const w of words) {
    const c = cols.find((c) => hit(c, w) && (!prefer || prefer(c))) ?? cols.find((c) => hit(c, w));
    if (c) return c.key;
  }
  return (cols.find((c) => !prefer || prefer(c)) ?? cols[0])?.key ?? "";
}

interface Setup { costKey: string; powerKey: string; tolerance: number; levelKey: string; curveKey: string; curveTolerance: number }

function ColumnSelect(props: { label: string; value: string; columns: Column[]; onChange: (k: string) => void }) {
  return (
    <label className="field inline">
      <span>{props.label}</span>
      <select className="forge-input" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.columns.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      </select>
    </label>
  );
}

function Tolerance(props: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="field inline">
      <span>{props.label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="range" min={5} max={60} step={5} value={Math.round(props.value * 100)} onChange={(e) => props.onChange(Number(e.target.value) / 100)} />
        <span className="mono" style={{ width: 40 }}>±{Math.round(props.value * 100)}%</span>
      </div>
    </label>
  );
}

export function AnalysisPage(props: { sheet: Sheet; computed?: Computed; notify: Notify }) {
  const { sheet, computed } = props;
  const cols = numericColumns(sheet);
  const colName = (k: string) => sheet.columns.find((c) => c.key === k)?.name ?? k;
  const [setup, setSetup] = usePersisted<Setup>(`analysis:${sheet.id}`, () => ({
    costKey: guess(cols, ["cost", "price", "gold", "mana"]),
    powerKey: guess(cols, ["power", "value", "score", "dps", "rating"], (c) => c.kind === "formula"),
    tolerance: 0.2,
    levelKey: guess(cols, ["level", "tier", "rank", "stage"]),
    curveKey: guess(cols, ["health", "hp", "power", "damage"]),
    curveTolerance: 0.15,
  }));
  const set = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));
  const [showAll, setShowAll] = useState(false);
  const has = (k: string) => cols.some((c) => c.key === k);

  const cvp = useMemo(() => judgeCostVsPower(points(sheet, computed, setup.costKey, setup.powerKey), setup.tolerance), [sheet, computed, setup.costKey, setup.powerKey, setup.tolerance]);
  const curvePts = useMemo(() => points(sheet, computed, setup.levelKey, setup.curveKey), [sheet, computed, setup.levelKey, setup.curveKey]);
  const curve = useMemo(() => powerCurve(curvePts, setup.curveTolerance), [curvePts, setup.curveTolerance]);

  const summary = useMemo(() => cols.map((c) => {
    const vals = sheet.rows.map((r) => computed?.numbers[r.id]?.[c.key]).filter((v): v is number => Number.isFinite(v));
    const min = vals.length ? Math.min(...vals) : NaN, max = vals.length ? Math.max(...vals) : NaN;
    return { col: c, n: vals.length, min, med: median(vals), max };
  }), [cols, sheet.rows, computed]);

  if (cols.length < 2) {
    return (
      <>
        <PageHeader title="Analysis" />
        <Card><EmptyState title="Add some numbers first"><p>Charts need at least two number or formula columns, like cost and power.</p></EmptyState></Card>
      </>
    );
  }

  const flagged = cvp.rows.filter((r) => r.verdict !== "ok").sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
  const tableRows = showAll ? [...cvp.rows].sort((a, b) => b.off - a.off) : flagged;
  const curveFlags = curve.levels.filter((r) => r.flag);
  const powerDecimals = sheet.columns.find((c) => c.key === setup.powerKey)?.decimals;
  const skipped = sheet.rows.length - cvp.rows.length;

  return (
    <div className="stack">
      <PageHeader title="Analysis" subtitle="Spot rows that are out of line with the rest. These are hints to look at, not rules." />

      <Card>
        <div className="card-head">
          <div>
            <h3>Cost vs power</h3>
            <p className="muted">Each row against a trend line through the others. Rows well above it give more for their cost.</p>
          </div>
          {has(setup.costKey) && has(setup.powerKey) && (
            <div style={{ display: "flex", gap: 6 }}>
              <Badge tone={flagged.some((f) => f.verdict === "strong") ? "bad" : undefined}>▲ {flagged.filter((f) => f.verdict === "strong").length} too strong</Badge>
              <Badge tone={flagged.some((f) => f.verdict === "weak") ? "warn" : undefined}>▼ {flagged.filter((f) => f.verdict === "weak").length} too weak</Badge>
            </div>
          )}
        </div>
        <div className="controls">
          <ColumnSelect label="Cost (across)" value={setup.costKey} columns={cols} onChange={(k) => set({ costKey: k })} />
          <ColumnSelect label="Power (up)" value={setup.powerKey} columns={cols} onChange={(k) => set({ powerKey: k })} />
          <Tolerance label="Flag rows off the trend by more than" value={setup.tolerance} onChange={(v) => set({ tolerance: v })} />
        </div>
        {cvp.rows.length < 3 ? (
          <p className="muted">Needs at least three rows with both values. {skipped > 0 && `${skipped} rows are missing one.`}</p>
        ) : (
          <>
            <Legend items={[{ label: "Within range", shape: "dot" }, { label: "Too strong for its cost", shape: "up" }, { label: "Too weak for its cost", shape: "down" }, { label: "Trend", shape: "line" }]} />
            <ScatterChart rows={cvp.rows} fit={cvp.fit} xLabel={colName(setup.costKey)} yLabel={colName(setup.powerKey)} />
            {cvp.fit && (
              <p className="muted small">
                Trend: each 1 {colName(setup.costKey).toLowerCase()} buys about {fmt(cvp.fit.slope)} {colName(setup.powerKey).toLowerCase()}.
                It's a median fit, so one extreme row doesn't bend it. {skipped > 0 && `${skipped} rows without both values are left out.`}
              </p>
            )}
            <div className="table-head">
              <b>{showAll ? "All rows" : flagged.length ? "Flagged rows" : "Nothing flagged at this range"}</b>
              <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all rows</label>
            </div>
            {tableRows.length > 0 && (
              <table className="entity-table compact">
                <thead><tr><th>Row</th><th className="num">{colName(setup.costKey)}</th><th className="num">{colName(setup.powerKey)}</th><th className="num">Trend expects</th><th className="num">Off by</th><th>Looks</th></tr></thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.id}>
                      <td className="name">{r.name}</td>
                      <td className="num">{fmt(r.x)}</td>
                      <td className="num">{fmt(r.y, powerDecimals)}</td>
                      <td className="num">{fmt(r.expected, powerDecimals)}</td>
                      <td className="num">{signedPct(r.off)}</td>
                      <td>{r.verdict === "strong" ? <Badge tone="bad">▲ Too strong</Badge> : r.verdict === "weak" ? <Badge tone="warn">▼ Too weak</Badge> : <Badge>In range</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Power curve</h3>
            <p className="muted">How a stat grows from one level or tier to the next. Flags steps much bigger or smaller than the usual step.</p>
          </div>
          {curve.typicalGrowth !== null && <Badge>Usual step {signedPct(curve.typicalGrowth - 1)}</Badge>}
        </div>
        <div className="controls">
          <ColumnSelect label="Level or tier (across)" value={setup.levelKey} columns={cols} onChange={(k) => set({ levelKey: k })} />
          <ColumnSelect label="Stat (up)" value={setup.curveKey} columns={cols} onChange={(k) => set({ curveKey: k })} />
          <Tolerance label="Flag steps off the usual by more than" value={setup.curveTolerance} onChange={(v) => set({ curveTolerance: v })} />
        </div>
        {curve.levels.length < 3 ? <p className="muted">Needs at least three different {colName(setup.levelKey).toLowerCase()} values.</p> : (
          <>
            <Legend items={[
              { label: curvePts.length > curve.levels.length ? `Median ${colName(setup.curveKey).toLowerCase()} per ${colName(setup.levelKey).toLowerCase()}` : colName(setup.curveKey), shape: "dot" },
              { label: "Spike", shape: "up" },
              { label: "Flat spot or drop", shape: "down" },
            ]} />
            <CurveChart levels={curve.levels} points={curvePts} xLabel={colName(setup.levelKey)} yLabel={colName(setup.curveKey)} />
            {curveFlags.length > 0 && (
              <ul className="flag-list">
                {curveFlags.map((r) => (
                  <li key={r.x}>
                    {r.flag === "jump" ? <Badge tone="bad">▲ Spike</Badge> : <Badge tone="warn">▼ Flat</Badge>}
                    <span>
                      <b>{colName(setup.levelKey)} {fmt(r.x)}</b>{r.names.length === 1 ? ` (${r.names[0]})` : ` (${r.names.length} rows, median)`}:{" "}
                      {signedPct((r.growth ?? 1) - 1)} on the level before, where the usual step is {signedPct((curve.typicalGrowth ?? 1) - 1)}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>

      <Card>
        <h3>Column spread</h3>
        <p className="muted">The range of each stat. A large gap between the lowest and highest value is worth a look.</p>
        <table className="entity-table compact">
          <thead><tr><th>Column</th><th className="num">Rows</th><th className="num">Lowest</th><th className="num">Median</th><th className="num">Highest</th><th className="num">Highest ÷ lowest</th></tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.col.key}>
                <td className="name">{s.col.name}</td>
                <td className="num">{s.n}</td>
                <td className="num">{fmt(s.min, s.col.decimals)}</td>
                <td className="num">{fmt(s.med, s.col.decimals)}</td>
                <td className="num">{fmt(s.max, s.col.decimals)}</td>
                <td className="num">{s.min > 0 ? `×${fmt(s.max / s.min)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
