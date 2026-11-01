import { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, errorText, when, type Computed, type Diff, type Sheet, type SnapshotInfo } from "../api";
import type { Notify } from "../App";

const CURRENT = "current";

function nextName(snaps: SnapshotInfo[]): string {
  const nums = snaps.map((s) => /(\d+)(?:\.(\d+))?\s*$/.exec(s.name)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2] ?? 0)] as const);
  if (!nums.length) return "Patch 1.0";
  const [maj, min] = nums.sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  return `Patch ${maj}.${min + 1}`;
}

export function PatchesPage(props: { sheet: Sheet; computed?: Computed; notify: Notify; flush: () => Promise<void> }) {
  const { sheet, notify, flush } = props;
  const [snaps, setSnaps] = useState<SnapshotInfo[]>();
  const [name, setName] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState(CURRENT);
  const [title, setTitle] = useState("");
  const [diff, setDiff] = useState<Diff>();
  const [notes, setNotes] = useState("");
  const [showDerived, setShowDerived] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.snapshots(sheet.id);
      setSnaps(s);
      setName((n) => n || nextName(s));
      setBefore((b) => (b && s.some((x) => x.id === b) ? b : s[0]?.id ?? ""));
    } catch (e) { notify(errorText(e), true); }
  }, [sheet.id, notify]);
  useEffect(() => { void load(); }, [load]);

  const take = async () => {
    try {
      await flush();
      const s = await api.snapshot(sheet.id, name);
      notify(`Saved "${s.name}"`);
      setName("");
      await load();
    } catch (e) { notify(errorText(e), true); }
  };

  const remove = async (s: SnapshotInfo) => {
    if (!window.confirm(`Delete the snapshot "${s.name}"?`)) return;
    try {
      await api.deleteSnapshot(s.id);
      if (after === s.id) setAfter(CURRENT);
      if (before === s.id) setBefore("");
      await load();
    } catch (e) { notify(errorText(e), true); }
  };

  const afterName = after === CURRENT ? "" : snaps?.find((s) => s.id === after)?.name ?? "";
  const compare = useCallback(async () => {
    if (!before) return;
    try {
      await flush();
      const d = await api.diff(sheet.id, before, after === CURRENT ? null : after, title.trim() || afterName || "Next patch");
      setDiff(d);
      setNotes(d.notes);
    } catch (e) { notify(errorText(e), true); }
  }, [before, after, title, afterName, sheet.id, flush, notify]);
  // Compare again whenever the choice changes, so the result never shows stale picks.
  useEffect(() => { setDiff(undefined); if (before) void compare(); }, [before, after]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(notes); notify("Patch notes copied"); } catch { notify("Couldn't copy. Select the text and copy it instead.", true); }
  };
  const saveNotes = async () => {
    const path = await save({ defaultPath: `${(title.trim() || afterName || "Patch notes").replace(/[\\/:*?"<>|]/g, " ")}.md`, filters: [{ name: "Markdown", extensions: ["md"] }, { name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try { await api.saveNotes(path, notes); notify("Patch notes saved"); } catch (e) { notify(errorText(e), true); }
  };

  const direct = diff?.changes.filter((c) => !c.derived) ?? [];
  const derived = diff?.changes.filter((c) => c.derived) ?? [];
  const shown = showDerived ? diff?.changes ?? [] : direct;

  return (
    <div className="stack">
      <PageHeader title="Patches" subtitle={`Snapshot "${sheet.name}" before you change it, then compare to see every change and get patch notes.`} />

      <Card>
        <h3>Snapshots</h3>
        <div className="controls">
          <label className="field inline" style={{ flex: 1, maxWidth: 320 }}><span>Name</span>
            <input className="forge-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void take()} />
          </label>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void take()}>Take snapshot</Button>
          <span className="muted small">Saves the sheet as it is now. Your sheet stays as it is.</span>
        </div>
        {snaps && snaps.length > 0 && (
          <ul className="list-plain">
            {snaps.map((s) => (
              <li key={s.id}>
                <span><b>{s.name}</b> <span className="muted small">· {when(s.createdAt)}</span></span>
                <Button variant="ghost" onClick={() => void remove(s)} aria-label={`Delete ${s.name}`}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {snaps && snaps.length === 0 ? (
        <Card><EmptyState title="No snapshots yet"><p>Take one now, make your balance changes, then come back to compare.</p></EmptyState></Card>
      ) : snaps && (
        <Card>
          <h3>Compare</h3>
          <div className="controls">
            <label className="field inline"><span>Before</span>
              <select className="forge-input" value={before} onChange={(e) => setBefore(e.target.value)}>
                {snaps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field inline"><span>After</span>
              <select className="forge-input" value={after} onChange={(e) => setAfter(e.target.value)}>
                <option value={CURRENT}>The sheet now</option>
                {snaps.filter((s) => s.id !== before).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="field inline"><span>Notes title</span>
              <input className="forge-input" placeholder={afterName || "Next patch"} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void compare()} />
            </label>
            <Button onClick={() => void compare()}>Refresh</Button>
          </div>

          {diff && (
            <>
              <div className="badges">
                <Badge>{direct.length} direct {direct.length === 1 ? "change" : "changes"}</Badge>
                {derived.length > 0 && <Badge>{derived.length} knock-on {derived.length === 1 ? "effect" : "effects"}</Badge>}
                {diff.added.length > 0 && <Badge tone="good">+ {diff.added.length} new</Badge>}
                {diff.removed.length > 0 && <Badge tone="bad">− {diff.removed.length} removed</Badge>}
              </div>
              {diff.changes.length > 0 && (
                <>
                  <div className="table-head">
                    <b>Changes</b>
                    {derived.length > 0 && <label className="check"><input type="checkbox" checked={showDerived} onChange={(e) => setShowDerived(e.target.checked)} /> Show knock-on effects in formula columns</label>}
                  </div>
                  <table className="entity-table compact">
                    <thead><tr><th>Row</th><th>Stat</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th><th /></tr></thead>
                    <tbody>
                      {shown.map((c) => (
                        <tr key={c.rowId + c.column}>
                          <td className="name">{c.rowName}</td>
                          <td>{c.columnName}</td>
                          <td className="num muted">{c.before ?? "—"}</td>
                          <td className="num">{c.after ?? "—"}</td>
                          <td className="num">{c.percent === null ? "" : <span className={c.percent > 0 ? "up" : "down"}>{c.percent > 0 ? "▲ +" : "▼ "}{c.percent.toFixed(1)}%</span>}</td>
                          <td>{c.derived && <Badge>knock-on</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="table-head" style={{ marginTop: 20 }}>
                <b>Patch notes</b>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button onClick={() => void copy()}>Copy</Button>
                  <Button onClick={() => void saveNotes()}>Save as file</Button>
                </div>
              </div>
              <p className="muted small" style={{ marginTop: 0 }}>Lists the stats you changed directly. Edit the text freely before you share it.</p>
              <textarea className="forge-input mono notes" rows={Math.min(24, Math.max(6, notes.split("\n").length + 1))} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Patch notes" />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
