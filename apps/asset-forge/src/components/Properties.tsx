import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Badge, Button } from "@forge/ui";
import { api, CATEGORIES, dims, duration, errorText, fileUrl, previewKind, size, STATUSES, when, type Asset, type AssetPatch, type AssetSummary } from "../api";
import { FramePlayer, Preview } from "./Preview";
import type { Notify } from "../App";

function TextField(props: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => { if (v !== props.value) props.onSave(v); };
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? (
        <textarea className="forge-input" rows={3} value={v} placeholder={props.placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      ) : (
        <input className="forge-input" value={v} placeholder={props.placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      )}
    </label>
  );
}

function TagAdder(props: { onAdd: (t: string) => void; placeholder?: string }) {
  const [t, setT] = useState("");
  return (
    <input className="forge-input tag-input" value={t} placeholder={props.placeholder ?? "Add tag"} onChange={(e) => setT(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && t.trim()) { props.onAdd(t.trim()); setT(""); } }} aria-label="Add tag" />
  );
}

export function statusTone(s: string): "good" | "warn" | undefined {
  return s === "Approved" || s === "Final" ? "good" : s === "Placeholder" ? "warn" : undefined;
}

/** Everything about one asset, editable. */
export function Properties(props: { id: string; version: number; onChanged: () => void; onSelect: (id: string) => void; notify: Notify }) {
  const { id, notify } = props;
  const [a, setA] = useState<Asset>();
  const [tab, setTab] = useState<"info" | "history">("info");

  useEffect(() => {
    let live = true;
    api.get(id).then((x) => live && setA(x)).catch((e) => notify(errorText(e), true));
    return () => { live = false; };
  }, [id, props.version, notify]);

  if (!a || a.id !== id) return <div className="props-empty muted">Loading…</div>;

  const patch = async (p: AssetPatch) => {
    try {
      await api.update([a.id], p);
      setA(await api.get(a.id));
      props.onChanged();
    } catch (e) { notify(errorText(e), true); }
  };
  const reveal = async () => {
    try { await revealItemInDir(a.path); } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="props">
      <Preview asset={a} />
      <div className="props-head">
        <h3 className="ellipsis" title={a.name}>{a.name}</h3>
        <div className="muted small ellipsis" title={a.relPath}>{a.relPath}</div>
        <div className="chips" style={{ marginTop: 6 }}>
          <Badge>{a.fileType}</Badge>
          {dims(a) && <Badge>{dims(a)}</Badge>}
          {a.durationMs ? <Badge>{duration(a.durationMs)}</Badge> : null}
          <Badge>{size(a.size)}</Badge>
          {a.missing && <Badge tone="bad">Missing</Badge>}
          {a.refs !== null && <Badge tone={a.refs === 0 ? "warn" : undefined}>{a.refs === 0 ? "Not used in game" : `Used ${a.refs}×`}</Badge>}
        </div>
      </div>
      <div className="editor-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "info"} onClick={() => setTab("info")}>Details</button>
        <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>History{a.versions.length ? ` (${a.versions.length})` : ""}</button>
      </div>
      {tab === "info" ? (
        <div className="props-body">
          <div className="row2">
            <label className="field"><span>Status</span>
              <select className="forge-input" value={a.status} onChange={(e) => void patch({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="field"><span>Category{a.categorySet ? "" : " (guessed)"}</span>
              <select className="forge-input" value={a.category} onChange={(e) => void patch({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="field">
            <span>Tags</span>
            <div className="chips">
              {a.tags.map((t) => (
                <span key={t} className={`chip ${a.autoTags.includes(t) ? "auto" : ""}`} title={a.autoTags.includes(t) ? "From the folder name" : undefined}>
                  {t}<button aria-label={`Remove tag ${t}`} onClick={() => void patch({ removeTags: [t] })}>×</button>
                </span>
              ))}
              <TagAdder onAdd={(t) => void patch({ addTags: [t] })} />
            </div>
          </div>
          <div className="row2">
            <TextField label="Author" value={a.author} placeholder="Who made it" onSave={(v) => void patch({ author: v })} />
            <TextField label="Source" value={a.source} placeholder="In-house, contractor, store…" onSave={(v) => void patch({ source: v })} />
          </div>
          <TextField label="License" value={a.license} placeholder="e.g. Owned, CC-BY 4.0, store licence" onSave={(v) => void patch({ license: v })} />
          <TextField label="Notes" value={a.notes} multiline placeholder="Anything the team should know" onSave={(v) => void patch({ notes: v })} />
          {a.duplicates.length > 0 && (
            <div className="dup-note">
              <Badge tone="warn">{a.duplicates.length} identical {a.duplicates.length === 1 ? "copy" : "copies"}</Badge>
              {a.duplicates.slice(0, 4).map((d) => <button key={d} className="link small" onClick={() => props.onSelect(d)}>Open copy</button>)}
            </div>
          )}
          <dl className="facts">
            <dt>Added</dt><dd>{when(a.addedAt)}</dd>
            <dt>Changed on disk</dt><dd>{when(a.mtime)}</dd>
            <dt>Fingerprint</dt><dd className="mono">{a.hash.slice(0, 12)}</dd>
          </dl>
          <Button onClick={() => void reveal()} disabled={a.missing}>Show in folder</Button>
        </div>
      ) : (
        <div className="props-body">
          {a.versions.length > 0 && (
            <>
              <b className="small">Earlier versions</b>
              <ul className="list-plain small">
                {a.versions.map((v, i) => (
                  <li key={i}><span>{when(v.recordedAt)}</span><span className="muted">{[dims(v), size(v.size)].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ul>
              <p className="muted small" style={{ margin: 0 }}>Asset Forge notes each change it sees on disk. It doesn't keep copies of old files.</p>
            </>
          )}
          <b className="small">History</b>
          {a.history.length === 0 ? <p className="muted small">Nothing yet.</p> : (
            <ul className="list-plain small">
              {a.history.map((e, i) => <li key={i}><span><b>{e.action}</b> {e.detail}</span><span className="muted nowrap">{when(e.at)}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Changes for many assets at once. */
export function BulkPanel(props: { assets: AssetSummary[]; total: number; onChanged: () => void; onRename: () => void; onExport: () => void; onClear: () => void; notify: Notify }) {
  const { assets, notify } = props;
  const ids = assets.map((a) => a.id);
  const [anim, setAnim] = useState(false);
  const [fps, setFps] = useState(10);
  const apply = async (p: AssetPatch, what: string) => {
    try {
      const n = await api.update(ids, p);
      notify(`${what} for ${n} assets`);
      props.onChanged();
    } catch (e) { notify(errorText(e), true); }
  };
  const common = assets.length ? assets.map((a) => new Set(a.tags)).reduce((x, y) => new Set([...x].filter((t) => y.has(t)))) : new Set<string>();
  const missing = assets.filter((a) => a.missing);
  const images = assets.filter((a) => previewKind(a) === "image").sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  const bytes = assets.reduce((s, a) => s + a.size, 0);

  const forget = async () => {
    if (!window.confirm(`Remove ${missing.length} missing files from the library? Their tags, notes and history go too.`)) return;
    try { const n = await api.forget(missing.map((m) => m.id)); notify(`Removed ${n} missing files from the library`); props.onChanged(); } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="props">
      <div className="props-head">
        <h3>{assets.length} selected</h3>
        <div className="muted small">{size(bytes)} in total</div>
      </div>
      <div className="props-body">
        {images.length >= 2 && (
          <div className="field">
            <label className="check"><input type="checkbox" checked={anim} onChange={(e) => setAnim(e.target.checked)} /> Play the {images.length} images as an animation</label>
            {anim && (
              <div className="preview checker">
                <FramePlayer frames={images.map((i) => ({ url: fileUrl(i.path) }))} fps={fps} size={200} />
                <label className="small">Speed <input className="forge-input tiny" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} /> fps</label>
              </div>
            )}
          </div>
        )}
        <div className="row2">
          <label className="field"><span>Set status</span>
            <select className="forge-input" value="" onChange={(e) => e.target.value && void apply({ status: e.target.value }, `Status set to ${e.target.value}`)}>
              <option value="">Choose…</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="field"><span>Set category</span>
            <select className="forge-input" value="" onChange={(e) => e.target.value && void apply({ category: e.target.value }, `Category set to ${e.target.value}`)}>
              <option value="">Choose…</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Tags on every selected asset</span>
          <div className="chips">
            {[...common].map((t) => <span key={t} className="chip">{t}<button aria-label={`Remove tag ${t}`} onClick={() => void apply({ removeTags: [t] }, `Removed "${t}"`)}>×</button></span>)}
            <TagAdder placeholder="Add tag to all" onAdd={(t) => void apply({ addTags: [t] }, `Tagged "${t}"`)} />
          </div>
        </div>
        <TextField label="Author for all" value="" placeholder="Leave empty to keep each one's author" onSave={(v) => v.trim() && void apply({ author: v }, "Author set")} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={props.onRename}>Rename files…</Button>
          <Button onClick={props.onExport}>Export these…</Button>
          {missing.length > 0 && <Button variant="ghost" className="danger" onClick={() => void forget()}>Forget {missing.length} missing</Button>}
          <Button variant="ghost" onClick={props.onClear}>Clear selection</Button>
        </div>
      </div>
    </div>
  );
}
