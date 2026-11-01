import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "@forge/ui";
import { api, errorText, type ExportFormat } from "../api";
import { MODULES } from "../modules";

const FORMATS: { id: ExportFormat; label: string; hint: string; ext: string }[] = [
  { id: "codex", label: ".forgecodex", hint: "For Balance Forge and Asset Forge, or another Forge Core project.", ext: "forgecodex" },
  { id: "json", label: "JSON", hint: "A full backup you can import again.", ext: "json" },
  { id: "csv", label: "CSV", hint: "Opens in Excel or Google Sheets. One row per entry.", ext: "csv" },
  { id: "markdown", label: "Markdown", hint: "A readable design document.", ext: "md" },
];

export function ExportDialog(props: { projectName: string; onClose: () => void; notify: (msg: string, bad?: boolean) => void }) {
  const [format, setFormat] = useState<ExportFormat>("codex");
  const [kinds, setKinds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const f = FORMATS.find((x) => x.id === format)!;
    const path = await save({ defaultPath: `${props.projectName}.${f.ext}`, filters: [{ name: f.label, extensions: [f.ext] }] });
    if (!path) return;
    setBusy(true);
    try {
      const n = await api.exportTo(format, kinds, path);
      props.notify(`Exported ${n} ${n === 1 ? "entry" : "entries"}`);
      props.onClose();
    } catch (e) {
      props.notify(errorText(e), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal">
        <Card>
          <h3>Export</h3>
          <div className="radios" role="radiogroup">
            {FORMATS.map((f) => (
              <div key={f.id}>
                <label><input type="radio" name="fmt" checked={format === f.id} onChange={() => setFormat(f.id)} /> {f.label}</label>
                <div className="hint">{f.hint}</div>
              </div>
            ))}
          </div>
          <div className="muted">Modules (none ticked exports everything)</div>
          <div className="checks">
            {MODULES.map((m) => (
              <label key={m.kind}>
                <input type="checkbox" checked={kinds.includes(m.kind)} onChange={(e) => setKinds((k) => (e.target.checked ? [...k, m.kind] : k.filter((x) => x !== m.kind)))} />
                {m.label}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? "Exporting…" : "Choose where to save"}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
