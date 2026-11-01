import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, errorText, MAX_RUNS, type CombatRules, type Computed, type DuelResult, type RoundRobinResult, type Sheet } from "../api";
import { fighterFor, fmt, guessStatMap, pct, STATS, winVerdict, type StatMap } from "../analysis";
import { Heatmap } from "../components/Charts";
import { usePersisted } from "../usePersisted";
import type { Notify } from "../App";

interface Setup {
  map: StatMap;
  rules: CombatRules;
  runs: number;
  mode: "duel" | "all";
  a?: string;
  b?: string;
  /** Rows left out of the round-robin. */
  excluded: string[];
}

function RunsInput(props: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="field inline">
      <span>Fights per pair</span>
      <select className="forge-input" value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
        {[100, 1000, 10_000, MAX_RUNS].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
      </select>
    </label>
  );
}

export function CombatPage(props: { sheet: Sheet; computed?: Computed; notify: Notify }) {
  const { sheet, computed, notify } = props;
  const numeric = sheet.columns.filter((c) => c.kind !== "text");
  const [setup, setSetup, ready] = usePersisted<Setup>(`combat:${sheet.id}`, () => ({
    map: guessStatMap(sheet.columns),
    rules: { armorModel: "flat", armorConstant: 100, damageVariance: 0.1, maxTime: 600 },
    runs: 1000,
    mode: "duel",
    a: sheet.rows[0]?.id,
    b: sheet.rows[1]?.id,
    excluded: [],
  }));
  const set = (patch: Partial<Setup>) => setSetup((s) => ({ ...s, ...patch }));
  const setRule = (patch: Partial<CombatRules>) => setSetup((s) => ({ ...s, rules: { ...s.rules, ...patch } }));
  const [seedText, setSeedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [duel, setDuel] = useState<{ seed: number; result: DuelResult; a: string; b: string }>();
  const [rr, setRr] = useState<{ seed: number; result: RoundRobinResult }>();

  const fighter = (id: string) => {
    const r = sheet.rows.find((x) => x.id === id);
    return r ? fighterFor(r.name || "Unnamed", computed?.numbers[r.id], setup.map) : undefined;
  };
  const missing = STATS.filter((s) => (s.key === "health" || s.key === "damage") && !setup.map[s.key]);
  const included = useMemo(() => sheet.rows.filter((r) => !setup.excluded.includes(r.id)), [sheet.rows, setup.excluded]);
  const seed = seedText.trim() ? Number(seedText.trim()) : undefined;
  const seedBad = seedText.trim() !== "" && !(Number.isSafeInteger(seed) && seed! >= 0);

  const run = async () => {
    setBusy(true);
    try {
      if (setup.mode === "duel") {
        const a = setup.a && fighter(setup.a), b = setup.b && fighter(setup.b);
        if (!a || !b) throw "Pick two rows";
        const r = await api.duel(a, b, setup.rules, setup.runs, seed);
        setDuel({ ...r, a: a.name, b: b.name });
      } else {
        const fs = included.map((r) => fighter(r.id)!);
        const r = await api.roundRobin(fs, setup.rules, setup.runs, seed);
        setRr(r);
      }
    } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  };

  if (sheet.rows.length < 2 || numeric.length < 2) {
    return (
      <>
        <PageHeader title="Combat sim" />
        <Card><EmptyState title="Needs at least two rows with stats"><p>Add rows with health and damage on the Stat sheet page first.</p></EmptyState></Card>
      </>
    );
  }
  if (!ready) return null;

  const ranking = rr ? rr.result.names.map((name, i) => ({ name, overall: rr.result.overall[i] })).sort((x, y) => y.overall - x.overall) : [];

  return (
    <div className="stack">
      <PageHeader title="Combat sim" subtitle="Fight rows against each other thousands of times to see who really wins, and by how much." />

      <Card>
        <h3>Which columns are which</h3>
        <p className="muted">Matched by column name where possible. Leave a stat on "Not used" for its default.</p>
        <div className="stat-map">
          {STATS.map((s) => (
            <label key={s.key} className="field">
              <span>{s.label} <span className="muted">· {s.hint}</span></span>
              <select className="forge-input" value={setup.map[s.key] ?? ""} onChange={(e) => set({ map: { ...setup.map, [s.key]: e.target.value || undefined } })}>
                <option value="">{s.key === "health" || s.key === "damage" ? "Pick a column" : `Not used (${s.fallback})`}</option>
                {numeric.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <details className="rules">
          <summary>Combat rules</summary>
          <div className="controls">
            <label className="field inline"><span>Armor works as</span>
              <select className="forge-input" value={setup.rules.armorModel} onChange={(e) => setRule({ armorModel: e.target.value as CombatRules["armorModel"] })}>
                <option value="flat">Flat: damage minus armor</option>
                <option value="percent">Percent: armor reduces damage by a share</option>
              </select>
            </label>
            {setup.rules.armorModel === "percent" && (
              <label className="field inline"><span>Armor that halves damage</span>
                <input className="forge-input num-input" type="number" min={1} value={setup.rules.armorConstant} onChange={(e) => setRule({ armorConstant: Number(e.target.value) || 100 })} />
              </label>
            )}
            <label className="field inline"><span>Damage varies by ±</span>
              <select className="forge-input" value={setup.rules.damageVariance} onChange={(e) => setRule({ damageVariance: Number(e.target.value) })}>
                {[0, 0.05, 0.1, 0.2, 0.3].map((v) => <option key={v} value={v}>{pct(v)}</option>)}
              </select>
            </label>
            <label className="field inline"><span>Call it a draw after (seconds)</span>
              <input className="forge-input num-input" type="number" min={1} value={setup.rules.maxTime} onChange={(e) => setRule({ maxTime: Number(e.target.value) || 600 })} />
            </label>
          </div>
        </details>
      </Card>

      <Card>
        <div className="card-head">
          <div className="seg" role="tablist" aria-label="Mode">
            <button role="tab" aria-pressed={setup.mode === "duel"} onClick={() => set({ mode: "duel" })}>One vs one</button>
            <button role="tab" aria-pressed={setup.mode === "all"} onClick={() => set({ mode: "all" })}>Everyone vs everyone</button>
          </div>
        </div>
        <div className="controls">
          {setup.mode === "duel" ? (
            <>
              {(["a", "b"] as const).map((side) => (
                <label key={side} className="field inline"><span>{side === "a" ? "Fighter A" : "Fighter B"}</span>
                  <select className="forge-input" value={setup[side] ?? ""} onChange={(e) => set({ [side]: e.target.value })}>
                    {sheet.rows.map((r) => <option key={r.id} value={r.id}>{r.name || "Unnamed"}</option>)}
                  </select>
                </label>
              ))}
            </>
          ) : (
            <div className="field inline"><span>Rows in the fight</span><b>{included.length} of {sheet.rows.length}</b></div>
          )}
          <RunsInput value={setup.runs} onChange={(n) => set({ runs: n })} />
          <label className="field inline"><span>Seed (optional)</span>
            <input className={`forge-input seed-input ${seedBad ? "invalid" : ""}`} placeholder="Random" value={seedText} onChange={(e) => setSeedText(e.target.value)} />
          </label>
          <Button variant="primary" disabled={busy || missing.length > 0 || seedBad || (setup.mode === "all" && included.length < 2)} onClick={() => void run()}>
            {busy ? "Running…" : "Run"}
          </Button>
        </div>
        {missing.length > 0 && <p className="bad-text small">Pick the {missing.map((m) => m.label.toLowerCase()).join(" and ")} column above first.</p>}
        {setup.mode === "all" && (
          <details className="rules">
            <summary>Choose rows ({included.length} of {sheet.rows.length})</summary>
            <div className="row-checks">
              {sheet.rows.map((r) => (
                <label key={r.id} className="check">
                  <input type="checkbox" checked={!setup.excluded.includes(r.id)}
                    onChange={(e) => set({ excluded: e.target.checked ? setup.excluded.filter((x) => x !== r.id) : [...setup.excluded, r.id] })} />
                  {r.name || "Unnamed"}
                </label>
              ))}
            </div>
          </details>
        )}

        {setup.mode === "duel" && duel && <DuelView d={duel} onReuseSeed={() => setSeedText(String(duel.seed))} />}
        {setup.mode === "all" && rr && (
          <div className="results">
            <div className="table-head">
              <b>Ranking</b>
              <span className="muted small">{rr.result.runsPerPair.toLocaleString()} fights per pair · seed <button className="link mono" title="Use this seed again" onClick={() => setSeedText(String(rr.seed))}>{rr.seed}</button></span>
            </div>
            <table className="entity-table compact">
              <thead><tr><th>#</th><th>Row</th><th className="num">Wins against the field</th><th>Looks</th></tr></thead>
              <tbody>
                {ranking.map((r, i) => {
                  const v = winVerdict(r.overall);
                  return (
                    <tr key={r.name + i}>
                      <td className="muted">{i + 1}</td>
                      <td className="name">{r.name}</td>
                      <td className="num"><span className="meter"><span style={{ width: pct(r.overall) }} /></span>{pct(r.overall)}</td>
                      <td>{v === "strong" ? <Badge tone="bad">▲ Dominant</Badge> : v === "weak" ? <Badge tone="warn">▼ Falls behind</Badge> : <Badge>Even</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="table-head" style={{ marginTop: 20 }}>
              <b>Head to head</b>
              <span className="legend">
                <span><i className="swatch win" /> Row wins more</span>
                <span><i className="swatch mid" /> Even</span>
                <span><i className="swatch lose" /> Row loses more</span>
              </span>
            </div>
            <p className="muted small" style={{ marginTop: 0 }}>Each number is how often the row beats the column, out of 100. Draws count as half a win.</p>
            <Heatmap names={rr.result.names} rates={rr.result.winRate} />
          </div>
        )}
      </Card>
    </div>
  );
}

function DuelView(props: { d: { seed: number; result: DuelResult; a: string; b: string }; onReuseSeed: () => void }) {
  const { result: r, a, b, seed } = props.d;
  const share = (n: number) => n / r.runs;
  const even = r.draws + r.timeouts;
  const winner = r.winsA === r.winsB ? null : r.winsA > r.winsB ? a : b;
  const margin = Math.abs(share(r.winsA) - share(r.winsB));
  return (
    <div className="results">
      <div className="duel-bar" role="img" aria-label={`${a} ${pct(share(r.winsA))}, ${b} ${pct(share(r.winsB))}, even ${pct(share(even))}`}>
        <span className="a" style={{ flex: r.winsA }} />
        {even > 0 && <span className="even" style={{ flex: even }} />}
        <span className="b" style={{ flex: r.winsB }} />
      </div>
      <div className="duel-labels">
        <span><i className="swatch a" /> <b>{a}</b> wins {pct(share(r.winsA), 1)}</span>
        {even > 0 && <span className="muted"><i className="swatch even" /> Draw or timeout {pct(share(even), 1)}</span>}
        <span><i className="swatch b" /> <b>{b}</b> wins {pct(share(r.winsB), 1)}</span>
      </div>
      <p>
        {winner === null ? "Dead even." : margin < 0.1 ? `Close: ${winner} edges it.` : margin > 0.6 ? `${winner} wins almost every time.` : `${winner} is clearly ahead.`}
        {" "}Fights last about {fmt(r.timeP50)}s (most between {fmt(r.timeP10)}s and {fmt(r.timeP90)}s).
      </p>
      <div className="stat-tiles">
        <div><span>{a} health left when winning</span><b>{pct(r.avgHealthLeftA)}</b></div>
        <div><span>{b} health left when winning</span><b>{pct(r.avgHealthLeftB)}</b></div>
        <div><span>Average fight</span><b>{fmt(r.avgTime)}s</b></div>
        <div><span>Fights run</span><b>{r.runs.toLocaleString()}</b></div>
      </div>
      <p className="muted small">Seed <button className="link mono" title="Use this seed again" onClick={props.onReuseSeed}>{seed}</button>. Run with the same seed to get the same result.</p>
    </div>
  );
}
