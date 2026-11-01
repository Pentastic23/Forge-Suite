import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, size, type AssetSummary, type CheckReport, type CheckSettings, type Finding, type NamingRule } from "../api";
import { Thumb } from "../components/Preview";
import { CASES } from "../components/RenameDialog";
import { usePersisted } from "../usePersisted";
import type { LibraryFilter } from "./LibraryPage";
import type { Notify } from "../App";

const DEFAULTS: CheckSettings = { naming: "none", maxImagePx: 4096, maxImageMb: 8, maxSfxMb: 5, maxMusicMb: 30, maxModelMb: 50, powerOfTwo: true };
const SEVERITY = {
  error: { label: "Problem", icon: "✕", tone: "bad" as const },
  warning: { label: "Worth fixing", icon: "!", tone: "warn" as const },
  info: { label: "Note", icon: "i", tone: undefined },
};

function FindingRow(props: { f: Finding; onShow: (f: LibraryFilter) => void }) {
  const { f } = props;
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetSummary[]>();
  useEffect(() => {
    if (!open || assets) return;
    api.list({ ids: f.assetIds.slice(0, 24), limit: 24 }).then((p) => setAssets(p.assets)).catch(() => setAssets([]));
  }, [open, assets, f.assetIds]);
  const s = SEVERITY[f.severity];
  return (
    <li className={`finding ${f.severity}`}>
      <div className="finding-head">
        <Badge tone={s.tone}><span aria-hidden="true">{s.icon}</span> {s.label}</Badge>
        <button className="finding-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{f.title}</button>
        <Button variant="ghost" onClick={() => props.onShow({ label: f.title, ids: f.assetIds })}>Show {f.assetIds.length > 1 ? `all ${f.assetIds.length}` : ""} in library</Button>
      </div>
      <p className="muted small">{f.detail}</p>
      {open && (
        <div className="finding-thumbs">
          {assets?.map((a) => (
            <div key={a.id} className="mini-tile" title={a.relPath}>
              <span className="thumb checker"><Thumb asset={a} size={56} /></span>
              <span className="ellipsis small">{a.name}</span>
            </div>
          ))}
          {f.assetIds.length > 24 && <span className="muted small">and {f.assetIds.length - 24} more</span>}
        </div>
      )}
    </li>
  );
}

export function ChecksPage(props: { version: number; onChanged: () => void; onShow: (f: LibraryFilter) => void; notify: Notify }) {
  const { notify } = props;
  const [report, setReport] = useState<CheckReport>();
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg, ready] = usePersisted<CheckSettings>("checks", () => DEFAULTS);
  const [usageDir] = usePersisted<string>("usageDir", () => "");
  const [scanning, setScanning] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try { setReport(await api.checks()); } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  }, [notify]);

  // Settings are saved a moment after they change; run once they have been.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void run(), 700);
    return () => clearTimeout(t);
  }, [cfg, ready, props.version, run]);

  const usage = async (dir?: string) => {
    const path = dir ?? (await open({ directory: true, multiple: false, title: "Choose your game project folder" }));
    if (typeof path !== "string") return;
    setScanning(true);
    try {
      const r = await api.usageScan(path);
      notify(`Read ${r.filesRead.toLocaleString()} project files: ${r.used.toLocaleString()} assets are used, ${r.unused.toLocaleString()} aren't mentioned`);
      props.onChanged();
      await run();
    } catch (e) { notify(errorText(e), true); }
    setScanning(false);
  };

  const set = (p: Partial<CheckSettings>) => setCfg((c) => ({ ...c, ...p }));
  const s = report?.summary;
  const cats = s ? Object.entries(s.byCategory).sort((a, b) => b[1].bytes - a[1].bytes) : [];
  const maxBytes = Math.max(1, ...cats.map(([, c]) => c.bytes));
  const counts = { error: 0, warning: 0, info: 0 };
  report?.findings.forEach((f) => counts[f.severity]++);

  return (
    <div className="stack">
      <PageHeader
        title="Checks"
        subtitle="Problems to fix before a build: missing and duplicate files, odd sizes, gaps in animations, naming and unused assets."
        actions={<Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? "Checking…" : "Run checks"}</Button>}
      />

      {s && (
        <div className="stat-tiles">
          <div><span>Assets</span><b>{s.assets.toLocaleString()}</b></div>
          <div><span>On disk</span><b>{size(s.bytes)}</b></div>
          <div title="Every image decoded at full size, before compression. Real GPU use is usually lower."><span>Texture memory (uncompressed)</span><b>{size(s.textureMemory)}</b></div>
          <div><span>Taken by duplicates</span><b>{size(s.duplicateBytes)}</b></div>
          <div><span>Unused in the game</span><b>{s.usageKnown ? s.unused.toLocaleString() : "—"}</b></div>
        </div>
      )}

      <Card>
        <div className="card-head">
          <div>
            <h3>Findings</h3>
            {report && <p className="muted">{report.findings.length === 0 ? "Nothing to fix." : `${counts.error} ${counts.error === 1 ? "problem" : "problems"}, ${counts.warning} worth fixing, ${counts.info} ${counts.info === 1 ? "note" : "notes"}.`}</p>}
          </div>
        </div>
        {report && report.findings.length === 0 && <p className="good-text">✓ All checks passed.</p>}
        <ul className="findings">
          {report?.findings.map((f, i) => <FindingRow key={f.check + f.title + i} f={f} onShow={props.onShow} />)}
        </ul>
      </Card>

      <div className="two-col">
        <Card>
          <h3>Is everything used?</h3>
          <p className="muted">Reads the scenes, prefabs, resources and scripts in your game project and counts where each asset is mentioned. Nothing is changed.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button disabled={scanning} onClick={() => void usage()}>{scanning ? "Reading…" : usageDir ? "Choose another game folder" : "Choose game project folder"}</Button>
            {usageDir && <Button variant="primary" disabled={scanning} onClick={() => void usage(usageDir)}>Scan again</Button>}
          </div>
          {usageDir && <p className="muted small mono ellipsis" title={usageDir}>{usageDir}</p>}
          <p className="muted small">Works with Unity (including GUIDs in .meta files), Godot and code or data files. Unreal's .uasset files are binary and can't be read this way.</p>
        </Card>

        <Card>
          <h3>Rules</h3>
          <div className="rules-grid">
            <label className="field"><span>File names should be</span>
              <select className="forge-input" value={cfg.naming} onChange={(e) => set({ naming: e.target.value as NamingRule })}>
                {CASES.map((c) => <option key={c.value} value={c.value}>{c.value === "none" ? "Any style (still flags spaces)" : c.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Largest image side (px)</span><input className="forge-input" type="number" min={16} value={cfg.maxImagePx} onChange={(e) => set({ maxImagePx: Number(e.target.value) || 4096 })} /></label>
            <label className="field"><span>Largest image file (MB)</span><input className="forge-input" type="number" min={0.1} step={0.5} value={cfg.maxImageMb} onChange={(e) => set({ maxImageMb: Number(e.target.value) || 8 })} /></label>
            <label className="field"><span>Largest sound effect (MB)</span><input className="forge-input" type="number" min={0.1} step={0.5} value={cfg.maxSfxMb} onChange={(e) => set({ maxSfxMb: Number(e.target.value) || 5 })} /></label>
            <label className="field"><span>Largest music track (MB)</span><input className="forge-input" type="number" min={1} value={cfg.maxMusicMb} onChange={(e) => set({ maxMusicMb: Number(e.target.value) || 30 })} /></label>
            <label className="field"><span>Largest model (MB)</span><input className="forge-input" type="number" min={1} value={cfg.maxModelMb} onChange={(e) => set({ maxModelMb: Number(e.target.value) || 50 })} /></label>
          </div>
          <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={cfg.powerOfTwo} onChange={(e) => set({ powerOfTwo: e.target.checked })} /> Note textures that aren't a power of two (256, 512, 1024…)</label>
        </Card>
      </div>

      {cats.length > 0 && (
        <Card>
          <h3>Size by category</h3>
          <p className="muted">Where the disk space goes.</p>
          <div className="bars">
            {cats.map(([c, v]) => (
              <div key={c} className="bar-row">
                <span className="bar-label">{c}</span>
                <span className="bar-track"><span className="bar" style={{ width: `${Math.max(0.5, (v.bytes / maxBytes) * 100)}%` }} /></span>
                <span className="bar-value">{size(v.bytes)} <span className="muted">· {v.count.toLocaleString()}</span></span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
