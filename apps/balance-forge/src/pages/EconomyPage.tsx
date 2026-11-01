import { useState } from "react";
import { Badge, Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type Computed, type EconomyConfig, type EconomyResult, type Income, type Sheet, type Spend } from "../api";
import { fmt, pct } from "../analysis";
import { BandChart, Legend } from "../components/Charts";
import { usePersisted } from "../usePersisted";
import type { Notify } from "../App";

const START: EconomyConfig = {
  players: 1000,
  steps: 100,
  startBalance: 0,
  incomes: [{ name: "Quest reward", min: 20, max: 60, chance: 1 }],
  spends: [{ name: "Potion", cost: 25, every: 1, repeat: true }],
};

function Num(props: { value: number; onChange: (n: number) => void; min?: number; step?: number; label: string; suffix?: string }) {
  return (
    <span className="num-wrap">
      <input className="forge-input num-input" type="number" aria-label={props.label} min={props.min} step={props.step ?? "any"} value={Number.isFinite(props.value) ? props.value : ""}
        onChange={(e) => props.onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
      {props.suffix && <span className="muted">{props.suffix}</span>}
    </span>
  );
}

export function EconomyPage(props: { sheet: Sheet; computed?: Computed; notify: Notify }) {
  const { sheet, computed, notify } = props;
  // One economy per project: it usually spans several sheets.
  const [cfg, setCfg, ready] = usePersisted<EconomyConfig>("economy", () => START);
  const [seedText, setSeedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ seed: number; result: EconomyResult }>();
  const [costKey, setCostKey] = useState("");

  const set = (patch: Partial<EconomyConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const setIncome = (i: number, patch: Partial<Income>) => set({ incomes: cfg.incomes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setSpend = (i: number, patch: Partial<Spend>) => set({ spends: cfg.spends.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const numeric = sheet.columns.filter((c) => c.kind !== "text");
  const seed = seedText.trim() ? Number(seedText.trim()) : undefined;
  const seedBad = seedText.trim() !== "" && !(Number.isSafeInteger(seed) && seed! >= 0);

  const addFromSheet = () => {
    const key = costKey || numeric.find((c) => /cost|price|gold/i.test(c.key + c.name))?.key;
    if (!key) return;
    const have = new Set(cfg.spends.map((s) => s.name));
    const add: Spend[] = sheet.rows
      .map((r) => ({ name: r.name || "Unnamed", cost: computed?.numbers[r.id]?.[key] ?? NaN }))
      .filter((s) => Number.isFinite(s.cost) && !have.has(s.name))
      .map((s) => ({ ...s, every: 1, repeat: false }));
    if (!add.length) { notify("Nothing new to add from that column"); return; }
    set({ spends: [...cfg.spends, ...add] });
    notify(`Added ${add.length} one-time purchases from "${sheet.name}"`);
  };

  const run = async () => {
    setBusy(true);
    try { setOut(await api.economy(cfg, seed)); } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  };

  if (!ready) return null;
  const r = out?.result;
  const net = r ? r.avgIncomePerStep - r.avgSpendPerStep : 0;

  return (
    <div className="stack">
      <PageHeader title="Economy sim" subtitle="Simulate many players earning and spending one currency over time, to find inflation and items nobody can afford." />

      <Card>
        <div className="controls">
          <label className="field inline"><span>Players</span><Num label="Players" min={1} step={1} value={cfg.players} onChange={(n) => set({ players: Math.max(1, Math.round(n)) })} /></label>
          <label className="field inline"><span>Steps (sessions, days, turns)</span><Num label="Steps" min={1} step={1} value={cfg.steps} onChange={(n) => set({ steps: Math.max(1, Math.round(n)) })} /></label>
          <label className="field inline"><span>Starting balance</span><Num label="Starting balance" min={0} value={cfg.startBalance} onChange={(n) => set({ startBalance: n })} /></label>
        </div>

        <div className="econ-grid">
          <div>
            <div className="table-head"><b>Income each step</b><Button onClick={() => set({ incomes: [...cfg.incomes, { name: "Income", min: 10, max: 10, chance: 1 }] })}>Add income</Button></div>
            <table className="entity-table compact edit-table">
              <thead><tr><th>Source</th><th className="num">Min</th><th className="num">Max</th><th className="num">Chance</th><th /></tr></thead>
              <tbody>
                {cfg.incomes.map((x, i) => (
                  <tr key={i}>
                    <td><input className="forge-input" aria-label="Income name" value={x.name} onChange={(e) => setIncome(i, { name: e.target.value })} /></td>
                    <td><Num label="Min" min={0} value={x.min} onChange={(n) => setIncome(i, { min: n })} /></td>
                    <td><Num label="Max" min={0} value={x.max} onChange={(n) => setIncome(i, { max: n })} /></td>
                    <td><Num label="Chance" min={0} step={5} value={Math.round(x.chance * 100)} suffix="%" onChange={(n) => setIncome(i, { chance: Math.min(1, Math.max(0, n / 100)) })} /></td>
                    <td><button className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => set({ incomes: cfg.incomes.filter((_, j) => j !== i) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="table-head">
              <b>Spending</b>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {numeric.length > 0 && (
                  <>
                    <select className="forge-input" aria-label="Cost column" value={costKey} onChange={(e) => setCostKey(e.target.value)} style={{ padding: "6px 8px" }}>
                      <option value="">Cost column…</option>
                      {numeric.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                    </select>
                    <Button onClick={addFromSheet} title={`Add each row of "${sheet.name}" as a one-time purchase`}>Add from sheet</Button>
                  </>
                )}
                <Button onClick={() => set({ spends: [...cfg.spends, { name: "Item", cost: 100, every: 1, repeat: false }] })}>Add</Button>
              </div>
            </div>
            <table className="entity-table compact edit-table">
              <thead><tr><th>Item</th><th className="num">Cost</th><th className="num">Try every</th><th>Buys</th><th /></tr></thead>
              <tbody>
                {cfg.spends.map((x, i) => (
                  <tr key={i}>
                    <td><input className="forge-input" aria-label="Item name" value={x.name} onChange={(e) => setSpend(i, { name: e.target.value })} /></td>
                    <td><Num label="Cost" min={0} value={x.cost} onChange={(n) => setSpend(i, { cost: n })} /></td>
                    <td><Num label="Try every" min={1} step={1} value={x.every} suffix="steps" onChange={(n) => setSpend(i, { every: Math.max(1, Math.round(n)) })} /></td>
                    <td>
                      <select className="forge-input" aria-label="Buys" value={x.repeat ? "r" : "o"} onChange={(e) => setSpend(i, { repeat: e.target.value === "r" })}>
                        <option value="o">Once</option>
                        <option value="r">Again and again</option>
                      </select>
                    </td>
                    <td><button className="icon-btn" aria-label={`Remove ${x.name}`} onClick={() => set({ spends: cfg.spends.filter((_, j) => j !== i) })}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Players buy in list order whenever they can afford it, so put the things they want most first.</p>
          </div>
        </div>

        <div className="controls" style={{ marginTop: 16 }}>
          <label className="field inline"><span>Seed (optional)</span>
            <input className={`forge-input seed-input ${seedBad ? "invalid" : ""}`} placeholder="Random" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
          <Button variant="primary" disabled={busy || seedBad || cfg.incomes.length === 0} onClick={() => void run()}>{busy ? "Running…" : "Run"}</Button>
          <span className="muted small">{(cfg.players * cfg.steps).toLocaleString()} player-steps</span>
        </div>
      </Card>

      {r && out && (
        <Card>
          <div className="card-head">
            <div>
              <h3>Balance over time</h3>
              <p className="muted">Seed <button className="link mono" title="Use this seed again" onClick={() => setSeedText(String(out.seed))}>{out.seed}</button></p>
            </div>
            {r.warnings.length === 0 && <Badge tone="good">✓ No warnings</Badge>}
          </div>
          {r.warnings.length > 0 && (
            <ul className="flag-list">
              {r.warnings.map((w) => {
                const [head, ...rest] = w.split(": ");
                const text = rest.join(": ");
                return <li key={w}><Badge tone="warn">⚠ {head}</Badge><span>{text.charAt(0).toUpperCase() + text.slice(1)}</span></li>;
              })}
            </ul>
          )}
          <Legend items={[{ label: "Typical player (median)", shape: "line", tone: "series" }, { label: "Middle 80% of players", shape: "band" }]} />
          <BandChart steps={r.steps} p10={r.p10} p50={r.p50} p90={r.p90} xLabel="Step" yLabel="Balance" />
          <div className="stat-tiles">
            <div><span>Earned per step</span><b>{fmt(r.avgIncomePerStep)}</b></div>
            <div><span>Spent per step</span><b>{fmt(r.avgSpendPerStep)}</b></div>
            <div><span>Left over per step</span><b>{net >= 0 ? "+" : ""}{fmt(net)}</b></div>
            <div><span>Typical balance at the end</span><b>{fmt(r.p50[r.p50.length - 1])}</b></div>
          </div>
          <table className="entity-table compact" style={{ marginTop: 16 }}>
            <thead><tr><th>Item</th><th className="num">Players who bought it</th><th className="num">Usually first bought at step</th><th className="num">Buys per player</th><th className="num">Tried but couldn't afford</th></tr></thead>
            <tbody>
              {r.spends.map((s) => (
                <tr key={s.name}>
                  <td className="name">{s.name}</td>
                  <td className="num">{s.reached < 0.5 ? <Badge tone="warn">{pct(s.reached)}</Badge> : pct(s.reached)}</td>
                  <td className="num">{s.medianFirstStep ?? "Never"}</td>
                  <td className="num">{fmt(s.avgPurchases)}</td>
                  <td className="num">{pct(s.missRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
