import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Card, PageHeader } from "@forge/ui";
import * as E from "../engine/editor";
import { buildPack, EXPORT_FORMATS } from "../engine/pack";
import { api, errorText, plural } from "../api";
import { meta, saveNow } from "../project";
import { useEditor } from "../useEditor";
import type { Notify } from "../App";

/** One pack for every engine: sheets, frames and metadata, with a README of import steps. */
export function ExportPage(props: { notify: Notify; projectName: string }) {
  const { notify } = props;
  useEditor();
  const [skip, setSkip] = useState<Set<number>>(() => new Set(E.assets.filter((a) => a.sample).map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; files: number; notes: string[] }>();
  const S = E.S;
  const chosen = E.assets.filter((a) => !skip.has(a.id));
  const sizes = E.SIZES.filter((N) => S.exportSizes[N]);
  const formats = Object.keys(EXPORT_FORMATS).filter((k) => S.exportFormats[k]);
  const frames = chosen.reduce((n, a) => n + 1 + a.anims.reduce((m, an) => m + an.frames, 0), 0) * sizes.length;
  const problem = !chosen.length ? "Pick at least one sketch" : !sizes.length ? "Tick at least one size" : !formats.length ? "Tick at least one engine" : "";

  const run = async (asZip: boolean) => {
    if (problem) return notify(problem, true);
    const slug = E.snake(props.projectName) || "pixel_forge";
    const path = asZip
      ? await save({ defaultPath: `${slug}_pack.zip`, filters: [{ name: "Zip archive", extensions: ["zip"] }] })
      : await open({ directory: true, title: "Choose the folder to export into" });
    if (typeof path !== "string") return;
    setBusy(true);
    setDone(undefined);
    try {
      await saveNow();
      const { zip, spineNotes } = await buildPack({ sketches: chosen, profileName: slug });
      const files = zip.toFiles();
      const n = await api.exportWrite(path, files, `${plural(chosen.length, "sketch", "sketches")} at ${sizes.join(", ")} px for ${formats.map((f) => EXPORT_FORMATS[f].split(" (")[0]).join(", ")}`);
      setDone({ path, files: n, notes: spineNotes });
      notify(`Exported ${plural(n, "file")}`);
    } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  };

  return (
    <div className="stack export">
      <PageHeader title="Export" subtitle="Sprite sheets, frames and engine files for every sketch, with a README of import steps for each engine." />
      <div className="export-grid">
        <Card>
          <h3 className="card-title">Sketches</h3>
          <div className="row-wrap">
            <Button variant="ghost" onClick={() => setSkip(new Set())}>All</Button>
            <Button variant="ghost" onClick={() => setSkip(new Set(E.assets.map((a) => a.id)))}>None</Button>
          </div>
          <ul className="list-plain check-list">
            {E.assets.map((a) => (
              <li key={a.id}>
                <label className="check">
                  <input type="checkbox" checked={!skip.has(a.id)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(a.id); else n.add(a.id); return n; })} />
                  <span>{a.name}</span>
                  <span className="muted small">{meta.get(a.id)?.folder} · {plural(a.anims.length, "animation")}</span>
                </label>
              </li>
            ))}
          </ul>
          {!E.assets.length && <p className="muted">Add sketches in the Library first.</p>}
        </Card>
        <Card>
          <h3 className="card-title">Sizes</h3>
          <div className="row-wrap">
            {E.SIZES.map((N) => (
              <label key={N} className="check"><input type="checkbox" checked={!!S.exportSizes[N]} onChange={(e) => E.setExport("exportSizes", N, e.target.checked)} /> {N}×{N}</label>
            ))}
          </div>
          <h3 className="card-title" style={{ marginTop: 18 }}>Engines</h3>
          <ul className="list-plain check-list">
            {Object.entries(EXPORT_FORMATS).map(([k, label]) => (
              <li key={k}><label className="check"><input type="checkbox" checked={!!S.exportFormats[k]} onChange={(e) => E.setExport("exportFormats", k, e.target.checked)} /> {label}</label></li>
            ))}
          </ul>
          <div className="ctl" style={{ marginTop: 12 }}>
            <label htmlFor="godotPath">Godot folder</label>
            <input id="godotPath" className="forge-input" value={String(S.godotPath)} onChange={(e) => E.setSetting("godotPath", e.target.value)} />
          </div>
          <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={!!S.exportVariants} onChange={(e) => E.setSetting("exportVariants", e.target.checked)} /> Include color variants ({S.variantCount || 0} set under Palette)</label>
          <p className="hint">Spine needs a rig with layers (Auto-rig or Layers from bones). Sketches without one are skipped for Spine only.</p>
        </Card>
      </div>
      <Card>
        <div className="export-run">
          <div>
            <b>{problem || `${plural(chosen.length, "sketch", "sketches")}, ${plural(frames, "frame")} per engine`}</b>
            <div className="muted small">Also in the pack: the palette (.png, .hex, .gpl), the style profile, and a README.</div>
          </div>
          <span className="spacer" />
          <Button disabled={busy || !!problem} onClick={() => void run(false)}>{busy ? "Exporting…" : "Export to folder…"}</Button>
          <Button variant="primary" disabled={busy || !!problem} onClick={() => void run(true)}>{busy ? "Exporting…" : "Export .zip…"}</Button>
        </div>
        {done && (
          <div className="export-done">
            <p><b>Wrote {plural(done.files, "file")}</b> to <span className="mono">{done.path}</span></p>
            {done.notes.map((n) => <p key={n} className="muted small">Spine: {n}</p>)}
            <Button variant="ghost" onClick={() => void revealItemInDir(done.path).catch((e) => notify(errorText(e), true))}>Show in folder</Button>
            <p className="hint">Asset Forge can add this folder to its library to check and track the files.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
