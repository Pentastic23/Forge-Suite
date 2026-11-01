import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Badge, Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type ExportPlanned, type ExportReport, type ExportSpec, type ExportTarget, type NamingRule } from "../api";
import { CASES } from "../components/RenameDialog";
import { usePersisted } from "../usePersisted";
import type { Notify } from "../App";

export const DEFAULT_SPEC: ExportSpec = {
  target: "folder", dest: "", scope: "approved", ids: [], layout: "category", naming: "none",
  scale: 1, pixelArt: true, pixelsPerUnit: 16, prefixes: true, overwrite: true, manifest: true,
};

const TARGETS: { value: ExportTarget; label: string; hint: string }[] = [
  { value: "folder", label: "Folder", hint: "Plain copies, for any engine or for sending to someone." },
  { value: "unity", label: "Unity", hint: "Pick a folder inside Assets. Writes .meta import settings for new files and never touches existing ones, so references stay." },
  { value: "godot", label: "Godot", hint: "Pick a folder inside your Godot project. Godot imports the files itself; for pixel art set the default texture filter to Nearest." },
  { value: "unreal", label: "Unreal", hint: "Copies into a staging folder named the Unreal way (T_, A_, SM_). Import that folder into the Content Browser." },
];

interface Pipeline { name: string; spec: ExportSpec }

export function ExportPage(props: { version: number; onChanged: () => void; notify: Notify; projectName: string; selection: string[] }) {
  const { notify } = props;
  const [pipelines, setPipelines, ready] = usePersisted<Pipeline[]>("pipelines", () => []);
  const [spec, setSpec, specReady] = usePersisted<ExportSpec>("exportDraft", () => DEFAULT_SPEC);
  const [preview, setPreview] = useState<{ total: number; files: ExportPlanned[] }>();
  const [previewError, setPreviewError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ExportReport>();
  const set = (p: Partial<ExportSpec>) => setSpec((s) => ({ ...DEFAULT_SPEC, ...s, ...p }));
  const full: ExportSpec = { ...DEFAULT_SPEC, ...spec, ids: spec.scope === "selection" ? props.selection : [] };

  // Coming from the library with assets chosen: export those. A saved draft
  // that pointed at a selection which is gone falls back to approved assets.
  useEffect(() => {
    if (!specReady) return;
    if (props.selection.length) set({ scope: "selection" });
    else if (spec.scope === "selection") set({ scope: "approved" });
  }, [specReady, props.selection]);

  useEffect(() => {
    if (!specReady) return;
    const t = setTimeout(() => {
      api.exportPreview(full).then((p) => { setPreview(p); setPreviewError(undefined); }).catch((e) => { setPreview(undefined); setPreviewError(errorText(e)); });
    }, 200);
    return () => clearTimeout(t);
  }, [JSON.stringify(full), specReady, props.version]);

  const pickDest = async () => {
    const path = await open({ directory: true, multiple: false, title: spec.target === "unity" ? "Choose a folder inside Assets" : "Choose where the files go", defaultPath: spec.dest || undefined });
    if (typeof path === "string") set({ dest: path });
  };

  const run = async () => {
    if (!full.dest) return pickDest();
    setBusy(true);
    setReport(undefined);
    try {
      const r = await api.exportRun(full);
      setReport(r);
      notify(r.errors.length ? `Exported with ${r.errors.length} problems` : `Exported ${r.assets.toLocaleString()} assets`, r.errors.length > 0);
      props.onChanged();
    } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  };

  const savePipeline = () => {
    const name = window.prompt("Name this export, so you can run it again", TARGETS.find((t) => t.value === spec.target)?.label ?? "Export");
    if (!name?.trim()) return;
    setPipelines((ps) => [...ps.filter((p) => p.name !== name.trim()), { name: name.trim(), spec: { ...full, ids: [] } }]);
    notify(`Saved "${name.trim()}"`);
  };

  const exchange = async () => {
    const path = await save({ title: "Share the library with other Forge apps", defaultPath: `${props.projectName}.forgeasset`, filters: [{ name: "Forge asset list", extensions: ["forgeasset"] }] });
    if (!path) return;
    try { const n = await api.exportExchange(path); notify(`Saved ${n.toLocaleString()} assets to ${path.split(/[\\/]/).pop()}`); } catch (e) { notify(errorText(e), true); }
  };

  const t = TARGETS.find((x) => x.value === spec.target)!;
  const canScale = spec.scale > 1;
  return (
    <div className="stack">
      <PageHeader
        title="Export"
        subtitle="Copy finished assets into your engine project, laid out and named the way it expects. Your originals stay where they are."
        actions={<Button onClick={savePipeline}>Save as preset</Button>}
      />

      {ready && pipelines.length > 0 && (
        <div className="presets">
          <span className="muted small">Presets</span>
          {pipelines.map((p) => (
            <span key={p.name} className="chip preset">
              <button className="link-plain" onClick={() => setSpec({ ...DEFAULT_SPEC, ...p.spec })} title={p.spec.dest}>{p.name}</button>
              <button aria-label={`Delete preset ${p.name}`} onClick={() => window.confirm(`Delete the preset "${p.name}"?`) && setPipelines((ps) => ps.filter((x) => x.name !== p.name))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="two-col export-cols">
        <Card>
          <h3>Where to</h3>
          <div className="seg" role="group" aria-label="Engine" style={{ marginTop: 8 }}>
            {TARGETS.map((x) => <button key={x.value} aria-pressed={spec.target === x.value} onClick={() => set({ target: x.value, layout: x.value === "folder" ? spec.layout : "category" })}>{x.label}</button>)}
          </div>
          <p className="muted small">{t.hint}</p>
          <div className="dest">
            <span className={`mono small ellipsis ${spec.dest ? "" : "muted"}`} title={spec.dest}>{spec.dest || "No folder chosen"}</span>
            <Button onClick={() => void pickDest()}>{spec.dest ? "Change" : "Choose folder"}</Button>
          </div>

          <h3 style={{ marginTop: 18 }}>What</h3>
          <div className="radios">
            <label><input type="radio" name="scope" checked={spec.scope === "approved"} onChange={() => set({ scope: "approved" })} /> Approved and Final assets</label>
            <label><input type="radio" name="scope" checked={spec.scope === "all"} onChange={() => set({ scope: "all" })} /> Everything in the library</label>
            <label className={props.selection.length ? undefined : "muted"}>
              <input type="radio" name="scope" disabled={!props.selection.length} checked={spec.scope === "selection"} onChange={() => set({ scope: "selection" })} />
              {props.selection.length ? `The ${props.selection.length} assets chosen in the library` : "Assets chosen in the library (select some, then Export)"}
            </label>
          </div>
          <p className="muted small" style={{ marginTop: -8 }}>Missing files are skipped.</p>
        </Card>

        <Card>
          <h3>How</h3>
          <div className="rules-grid">
            <label className="field"><span>Folders</span>
              <select className="forge-input" value={spec.layout} onChange={(e) => set({ layout: e.target.value as ExportSpec["layout"] })}>
                <option value="category">One per category (Sprite, SFX…)</option>
                <option value="source">Same as your folders</option>
                <option value="flat">All in one folder</option>
              </select>
            </label>
            <label className="field"><span>File names</span>
              <select className="forge-input" value={spec.naming} onChange={(e) => set({ naming: e.target.value as NamingRule })}>
                {CASES.map((c) => <option key={c.value} value={c.value}>{c.value === "none" ? "Keep as they are" : c.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Scale images</span>
              <select className="forge-input" value={spec.scale} onChange={(e) => set({ scale: Number(e.target.value) })}>
                {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n === 1 ? "As they are" : `${n}× (sharp pixels)`}</option>)}
              </select>
            </label>
            {spec.target === "unity" && (
              <label className="field"><span>Pixels per unit</span>
                <input className="forge-input" type="number" min={1} value={spec.pixelsPerUnit} onChange={(e) => set({ pixelsPerUnit: Math.max(1, Number(e.target.value) || 16) })} />
              </label>
            )}
          </div>
          {canScale && <p className="muted small">Scaled copies are saved as PNG with no smoothing. Other files are copied as they are.</p>}
          <div className="radios" style={{ marginBottom: 0 }}>
            {spec.target === "unity" && <label className="check"><input type="checkbox" checked={spec.pixelArt} onChange={(e) => set({ pixelArt: e.target.checked })} /> Pixel art import settings (no filtering, no compression)</label>}
            {spec.target === "unreal" && <label className="check"><input type="checkbox" checked={spec.prefixes} onChange={(e) => set({ prefixes: e.target.checked })} /> Add Unreal name prefixes (T_, A_, SM_)</label>}
            <label className="check"><input type="checkbox" checked={spec.overwrite} onChange={(e) => set({ overwrite: e.target.checked })} /> Replace files that changed since the last export</label>
            <label className="check"><input type="checkbox" checked={spec.manifest} onChange={(e) => set({ manifest: e.target.checked })} /> Write a list of what was exported (assetforge-export.json)</label>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-head">
          <div>
            <h3>Preview</h3>
            <p className="muted">{previewError ? <span className="bad-text">{previewError}</span> : preview ? `${preview.total.toLocaleString()} files${preview.total > preview.files.length ? `, first ${preview.files.length} shown` : ""}` : "Working it out…"}</p>
          </div>
          <Button variant="primary" disabled={busy || !preview?.total} onClick={() => void run()}>
            {busy ? "Exporting…" : !spec.dest ? "Choose folder and export" : `Export ${preview?.total.toLocaleString() ?? ""} files`}
          </Button>
        </div>
        {preview && preview.files.length > 0 && (
          <div className="table-wrap preview-table">
            <table className="entity-table compact">
              <thead><tr><th>From</th><th /><th>To</th></tr></thead>
              <tbody>
                {preview.files.map((f) => (
                  <tr key={f.id}>
                    <td className="mono ellipsis" title={f.from}>{f.from}</td>
                    <td className="muted">→</td>
                    <td className="mono">{f.to}{f.scaled && <> <Badge>{spec.scale}×</Badge></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {report && (
        <Card accent={report.errors.length ? "var(--forge-bad)" : "var(--forge-good)"}>
          <div className="card-head">
            <div>
              <h3>{report.errors.length ? <><span aria-hidden="true">!</span> Exported with problems</> : <><span aria-hidden="true">✓</span> Export finished</>}</h3>
              <p className="muted mono small ellipsis" title={report.dest}>{report.dest}</p>
            </div>
            <Button onClick={() => void revealItemInDir(report.dest).catch((e) => notify(errorText(e), true))}>Open folder</Button>
          </div>
          <div className="stat-tiles small-tiles">
            <div><span>Assets</span><b>{report.assets.toLocaleString()}</b></div>
            <div><span>Copied</span><b>{report.copied.toLocaleString()}</b></div>
            <div><span>Already up to date</span><b>{report.unchanged.toLocaleString()}</b></div>
            {report.keptExisting > 0 && <div><span>Kept existing</span><b>{report.keptExisting.toLocaleString()}</b></div>}
            {report.scaled > 0 && <div><span>Scaled</span><b>{report.scaled.toLocaleString()}</b></div>}
            {report.metaFiles > 0 && <div><span>Unity .meta written</span><b>{report.metaFiles.toLocaleString()}</b></div>}
          </div>
          {report.errors.length > 0 && <ul className="flag-list">{report.errors.slice(0, 20).map((e, i) => <li key={i} className="bad-text">{e}</li>)}</ul>}
        </Card>
      )}

      <Card>
        <div className="card-head">
          <div>
            <h3>Share with other Forge apps</h3>
            <p className="muted">Saves a .forgeasset file listing every asset, its status and tags, and the production progress. Files themselves aren't included.</p>
          </div>
          <Button onClick={() => void exchange()}>Save .forgeasset</Button>
        </div>
      </Card>
    </div>
  );
}
