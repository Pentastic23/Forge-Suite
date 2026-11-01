import { useEffect, useState } from "react";
import { Button, Card } from "@forge/ui";
import { api, errorText, type NamingRule, type RenamePlanned, type RenameSpec } from "../api";
import type { Notify } from "../App";

export const CASES: { value: NamingRule; label: string }[] = [
  { value: "none", label: "Keep as typed" },
  { value: "snakeCase", label: "snake_case" },
  { value: "kebabCase", label: "kebab-case" },
  { value: "pascalCase", label: "PascalCase" },
  { value: "camelCase", label: "camelCase" },
];

/** Renames the selected files on disk, with a preview first. */
export function RenameDialog(props: { ids: string[]; onClose: () => void; onDone: () => void; notify: Notify }) {
  const [spec, setSpec] = useState<RenameSpec>({ pattern: "{name}", case: "snakeCase", find: "", replace: "", start: 1, pad: 2, lowerExt: true });
  const [plan, setPlan] = useState<RenamePlanned[]>();
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<RenameSpec>) => setSpec((s) => ({ ...s, ...p }));

  useEffect(() => {
    const t = setTimeout(() => { api.renamePlan(props.ids, spec).then(setPlan).catch((e) => props.notify(errorText(e), true)); }, 150);
    return () => clearTimeout(t);
  }, [spec, props.ids]);

  const changing = plan?.filter((p) => p.from !== p.to && !p.problem) ?? [];
  const problems = plan?.filter((p) => p.problem) ?? [];

  const apply = async () => {
    if (!window.confirm(`Rename ${changing.length} files on disk? Files in a game engine project may need their references updated. You can undo this batch afterwards.`)) return;
    setBusy(true);
    try {
      const n = await api.renameApply(props.ids, spec);
      props.notify(`Renamed ${n} files`);
      props.onDone();
    } catch (e) {
      props.notify(errorText(e), true);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Rename files">
        <Card>
          <h3>Rename {props.ids.length} files</h3>
          <div className="controls" style={{ marginTop: 0 }}>
            <label className="field" style={{ flex: 2, minWidth: 220 }}><span>New name</span>
              <input className="forge-input mono" value={spec.pattern} onChange={(e) => set({ pattern: e.target.value })} />
            </label>
            <label className="field"><span>Style</span>
              <select className="forge-input" value={spec.case} onChange={(e) => set({ case: e.target.value as NamingRule })}>
                {CASES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small" style={{ marginTop: -6 }}>
            Use <code>{"{name}"}</code> for the current name, <code>{"{n}"}</code> for a number, <code>{"{folder}"}</code>, <code>{"{category}"}</code>, <code>{"{w}"}</code> and <code>{"{h}"}</code>. The extension stays.
          </p>
          <div className="controls">
            <label className="field"><span>Replace text</span><input className="forge-input" value={spec.find} onChange={(e) => set({ find: e.target.value })} /></label>
            <label className="field"><span>With</span><input className="forge-input" value={spec.replace} onChange={(e) => set({ replace: e.target.value })} /></label>
            <label className="field"><span>Numbers start at</span><input className="forge-input num-input" type="number" min={0} value={spec.start} onChange={(e) => set({ start: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="field"><span>Digits</span>
              <select className="forge-input" value={spec.pad} onChange={(e) => set({ pad: Number(e.target.value) })}>{[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}</select>
            </label>
            <label className="check"><input type="checkbox" checked={spec.lowerExt} onChange={(e) => set({ lowerExt: e.target.checked })} /> Lowercase extensions</label>
          </div>
          <div className="rename-list">
            <table className="entity-table compact">
              <thead><tr><th>Now</th><th /><th>After</th></tr></thead>
              <tbody>
                {plan?.slice(0, 300).map((p) => (
                  <tr key={p.id} className={p.problem ? "bad-row" : p.from === p.to ? "same-row" : undefined}>
                    <td className="mono">{p.from}</td>
                    <td className="muted">→</td>
                    <td className="mono">{p.to}{p.problem && <div className="bad-text small">{p.problem}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
            <span className="muted small">{changing.length} will change{problems.length ? `, ${problems.length} can't` : ""}.</span>
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy || changing.length === 0 || problems.length > 0} onClick={() => void apply()}>
              {problems.length ? "Fix the problems first" : busy ? "Renaming…" : `Rename ${changing.length}`}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
