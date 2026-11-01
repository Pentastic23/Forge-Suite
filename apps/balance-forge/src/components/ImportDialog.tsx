import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "@forge/ui";
import { api, errorText, type Sheet, type SheetInfo } from "../api";
import type { Notify } from "../App";

const MODULE_LABELS: Record<string, string> = { lore: "Lore", quest: "Quests", zone: "Zones", mob: "Mobs", item: "Items", skill: "Skills" };

/** Brings one Forge Core module (mobs, items...) into a sheet. */
export function ImportDialog(props: {
  sheets: SheetInfo[];
  currentSheetId?: string;
  beforeImport: () => Promise<void>;
  onClose: () => void;
  onImported: (s: Sheet) => void;
  notify: Notify;
}) {
  const [path, setPath] = useState<string>();
  const [kinds, setKinds] = useState<Record<string, number>>();
  const [kind, setKind] = useState("");
  const [target, setTarget] = useState("new");
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    const p = await open({ multiple: false, filters: [{ name: "Forge Core export", extensions: ["forgecodex"] }] });
    if (typeof p !== "string") return;
    try {
      const k = await api.codexKinds(p);
      setPath(p);
      setKinds(k);
      const first = Object.keys(k).find((x) => x === "mob") ?? Object.keys(k)[0] ?? "";
      setKind(first);
      // Refresh a sheet that came from the same module, if there is one.
      setTarget(props.sheets.find((s) => s.sourceKind === first)?.id ?? "new");
    } catch (e) { props.notify(errorText(e), true); }
  };

  const chooseKind = (k: string) => {
    setKind(k);
    setTarget(props.sheets.find((s) => s.sourceKind === k)?.id ?? "new");
  };

  const run = async () => {
    if (!path || !kind) return;
    setBusy(true);
    try {
      await props.beforeImport();
      const r = await api.codexImport(path, kind, target === "new" ? undefined : target);
      const cols = r.newColumns.length ? `, new columns: ${r.newColumns.join(", ")}` : "";
      props.notify(`Imported ${r.added} new and updated ${r.updated} rows${cols}`);
      props.onImported(r.sheet);
    } catch (e) {
      props.notify(errorText(e), true);
      setBusy(false);
    }
  };

  const label = (k: string) => MODULE_LABELS[k] ?? k;

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label="Import from Forge Core">
        <Card>
          <h3>Import from Forge Core</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            In Forge Core, use Export and pick <b>.forgecodex</b>. Each entry becomes a row, and its number fields become columns.
            Importing again updates those rows and keeps anything you added here.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <Button onClick={() => void pick()}>{path ? "Choose another file" : "Choose a .forgecodex file"}</Button>
            {path && <span className="muted ellipsis" title={path}>{path.split(/[\\/]/).pop()}</span>}
          </div>
          {kinds && (
            Object.keys(kinds).length === 0 ? <p className="muted">This file has no entries.</p> : (
              <>
                <div className="field" style={{ marginBottom: 12 }}>
                  <span>Module</span>
                  <div className="radios" style={{ margin: 0 }}>
                    {Object.entries(kinds).map(([k, n]) => (
                      <label key={k}><input type="radio" name="kind" checked={kind === k} onChange={() => chooseKind(k)} /> {label(k)} <span className="muted">({n})</span></label>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Into</span>
                  <select className="forge-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="new">A new sheet called "{label(kind)}"</option>
                    {props.sheets.map((s) => <option key={s.id} value={s.id}>Update "{s.name}"{s.sourceKind === kind ? " (same module)" : ""}</option>)}
                  </select>
                </label>
              </>
            )
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!path || !kind || busy} onClick={() => void run()}>{busy ? "Importing…" : "Import"}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
