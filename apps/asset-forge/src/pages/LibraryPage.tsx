import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState } from "@forge/ui";
import { api, CATEGORIES, dims, errorText, size, STATUSES, type AssetQuery, type AssetSummary, type Facets, type Folder } from "../api";
import { Thumb } from "../components/Preview";
import { BulkPanel, Properties, statusTone } from "../components/Properties";
import { RenameDialog } from "../components/RenameDialog";
import type { Notify } from "../App";

/** A filter set from another page, e.g. the files a check found. */
export interface LibraryFilter { label: string; ids: string[] }

const PAGE = 300;
const TYPES: Record<string, string> = { image: "Images", audio: "Audio", model: "Models", shader: "Shaders", font: "Fonts", video: "Video", data: "Data", other: "Other" };

function FilterGroup(props: { title: string; items: [string, number][]; value?: string; onPick: (v?: string) => void; label?: (k: string) => string; max?: number }) {
  const [more, setMore] = useState(false);
  if (props.items.length === 0) return null;
  const max = props.max ?? 99;
  const shown = more ? props.items : props.items.slice(0, max);
  return (
    <div className="filter-group">
      <div className="filter-title">{props.title}</div>
      {shown.map(([k, n]) => (
        <button key={k} className="filter-item" aria-pressed={props.value === k} onClick={() => props.onPick(props.value === k ? undefined : k)}>
          <span className="ellipsis">{props.label ? props.label(k) : k}</span><span className="count">{n.toLocaleString()}</span>
        </button>
      ))}
      {props.items.length > max && <button className="link small" onClick={() => setMore((m) => !m)}>{more ? "Fewer" : `${props.items.length - max} more`}</button>}
    </div>
  );
}

export function LibraryPage(props: {
  facets?: Facets;
  folders: Folder[];
  version: number;
  filter?: LibraryFilter;
  onClearFilter: () => void;
  onChanged: () => void;
  onAddFolders: () => void;
  onExport: (ids: string[]) => void;
  notify: Notify;
}) {
  const { facets, notify } = props;
  const [q, setQ] = useState<AssetQuery>({ sort: "name" });
  const [text, setText] = useState("");
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string>();
  const [tile, setTile] = useState(() => { try { return Number(localStorage.getItem("asset-forge.tile")) || 112; } catch { return 112; } });
  const [renaming, setRenaming] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const loaded = useRef(0);

  // Debounced text search.
  useEffect(() => {
    const t = setTimeout(() => setQ((old) => ({ ...old, text: text.trim() || undefined })), 180);
    return () => clearTimeout(t);
  }, [text]);

  const query = useMemo<AssetQuery>(() => ({ ...q, ids: props.filter?.ids }), [q, props.filter]);

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const keep = reset ? PAGE : Math.max(PAGE, loaded.current);
      const page = await api.list({ ...query, offset: 0, limit: keep });
      setAssets(page.assets);
      setTotal(page.total);
      loaded.current = page.assets.length;
      if (reset) grid.current?.scrollTo(0, 0);
    } catch (e) { notify(errorText(e), true); }
    setLoading(false);
  }, [query, notify]);

  useEffect(() => { void load(true); }, [query]);
  useEffect(() => { if (props.version) void load(false); }, [props.version]);

  const more = async () => {
    if (loading || assets.length >= total) return;
    setLoading(true);
    try {
      const page = await api.list({ ...query, offset: assets.length, limit: PAGE });
      setAssets((old) => [...old, ...page.assets]);
      loaded.current = assets.length + page.assets.length;
    } catch (e) { notify(errorText(e), true); }
    setLoading(false);
  };

  const pick = (key: keyof AssetQuery) => (v?: string) => setQ((old) => ({ ...old, [key]: v }));
  const setMissing = (on: boolean) => setQ((old) => ({ ...old, missing: on ? true : undefined }));

  const click = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor) {
      const a = assets.findIndex((x) => x.id === anchor), b = assets.findIndex((x) => x.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = assets.slice(lo, hi + 1).map((x) => x.id);
      setSelected((s) => (e.ctrlKey || e.metaKey ? [...new Set([...s, ...range])] : range));
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
      setAnchor(id);
    } else {
      setSelected([id]);
      setAnchor(id);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSelected(assets.map((a) => a.id)); }
    if (e.key === "Escape") setSelected([]);
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && selected.length === 1) {
      const i = assets.findIndex((a) => a.id === selected[0]);
      const next = assets[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (next) { setSelected([next.id]); setAnchor(next.id); document.getElementById(`tile-${next.id}`)?.scrollIntoView({ block: "nearest" }); }
    }
  };

  const setTileSaved = (n: number) => { setTile(n); try { localStorage.setItem("asset-forge.tile", String(n)); } catch { /* ignore */ } };
  const selectedAssets = assets.filter((a) => selected.includes(a.id));
  const filtersOn = !!(q.text || q.category || q.status || q.fileType || q.tag || q.folderId || q.missing || props.filter);

  if (props.folders.length === 0) {
    return (
      <Card>
        <EmptyState title="Add your asset folders to begin">
          <p>Asset Forge reads your sprites, sounds and models where they already are. Nothing is copied or uploaded.</p>
          <Button variant="primary" onClick={props.onAddFolders}>Add a folder</Button>
        </EmptyState>
      </Card>
    );
  }

  const sorted = (o?: Record<string, number>) => Object.entries(o ?? {}).sort((a, b) => b[1] - a[1]);
  const byOrder = (o: Record<string, number> | undefined, order: string[]) => order.filter((k) => o?.[k]).map((k) => [k, o![k]] as [string, number]);

  return (
    <div className="lib">
      <aside className="lib-filters" aria-label="Filters">
        {props.folders.length > 1 && (
          <FilterGroup title="Folder" items={props.folders.map((f) => [f.id, f.assets])} value={q.folderId} onPick={pick("folderId")}
            label={(id) => props.folders.find((f) => f.id === id)?.path.split(/[\\/]/).filter(Boolean).pop() ?? id} />
        )}
        <FilterGroup title="Category" items={byOrder(facets?.categories, CATEGORIES)} value={q.category} onPick={pick("category")} />
        <FilterGroup title="Status" items={byOrder(facets?.statuses, STATUSES)} value={q.status} onPick={pick("status")} />
        <FilterGroup title="File type" items={sorted(facets?.fileTypes)} value={q.fileType} onPick={pick("fileType")} label={(k) => TYPES[k] ?? k} />
        <FilterGroup title="Tags" items={facets?.tags ?? []} value={q.tag} onPick={pick("tag")} max={12} />
        {facets && facets.missing > 0 && (
          <div className="filter-group">
            <button className="filter-item bad" aria-pressed={!!q.missing} onClick={() => setMissing(!q.missing)}><span>Missing files</span><span className="count">{facets.missing}</span></button>
          </div>
        )}
      </aside>

      <section className="lib-main" onKeyDown={onKey}>
        <div className="toolbar">
          <input className="forge-input search" type="search" placeholder="Search names, folders, tags, notes" value={text} onChange={(e) => setText(e.target.value)} />
          <select className="forge-input" aria-label="Sort" value={q.sort} onChange={(e) => setQ((o) => ({ ...o, sort: e.target.value as AssetQuery["sort"] }))}>
            <option value="name">Name</option>
            <option value="path">Folder</option>
            <option value="category">Category</option>
            <option value="newest">Recently changed</option>
            <option value="largest">Largest</option>
          </select>
          <input type="range" min={72} max={200} step={8} value={tile} onChange={(e) => setTileSaved(Number(e.target.value))} aria-label="Thumbnail size" title="Thumbnail size" />
        </div>
        <div className="result-line">
          <span>{total.toLocaleString()} {total === 1 ? "asset" : "assets"}</span>
          {props.filter && <Badge>{props.filter.label} <button className="chip-x" aria-label="Clear" onClick={props.onClearFilter}>×</button></Badge>}
          {filtersOn && <button className="link small" onClick={() => { setQ({ sort: q.sort }); setText(""); props.onClearFilter(); }}>Clear filters</button>}
          {selected.length > 1 && <span className="muted small">{selected.length} selected · Esc to clear</span>}
        </div>
        <div className="grid-scroll" ref={grid} tabIndex={0} onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) void more();
        }}>
          {assets.length === 0 && !loading ? (
            <div className="muted" style={{ padding: 40, textAlign: "center" }}>{filtersOn ? "Nothing matches these filters." : "No files found yet. Try Rescan."}</div>
          ) : (
            <div className="asset-grid" style={{ ["--tile" as string]: `${tile}px` }} role="listbox" aria-multiselectable="true" aria-label="Assets">
              {assets.map((a) => (
                <button key={a.id} id={`tile-${a.id}`} role="option" aria-selected={selected.includes(a.id)} className={`tile ${a.missing ? "missing" : ""}`} onClick={(e) => click(e, a.id)} title={a.relPath}>
                  <span className="thumb checker"><Thumb asset={a} size={tile} />{a.missing && <span className="missing-flag">Missing</span>}</span>
                  <span className="tile-name ellipsis">{a.name}</span>
                  <span className="tile-meta">
                    <span className={`dot ${statusTone(a.status) ?? ""}`} title={a.status} />
                    <span className="ellipsis">{dims(a) || size(a.size)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {assets.length < total && <div className="muted small" style={{ padding: 16, textAlign: "center" }}>{loading ? "Loading…" : <button className="link" onClick={() => void more()}>Show more</button>}</div>}
        </div>
      </section>

      <aside className="lib-props" aria-label="Properties">
        {selected.length === 1 ? (
          <Properties id={selected[0]} version={props.version} onChanged={props.onChanged} onSelect={(id) => setSelected([id])} notify={notify} />
        ) : selected.length > 1 ? (
          <BulkPanel assets={selectedAssets} total={total} onChanged={props.onChanged} onRename={() => setRenaming(true)} onExport={() => props.onExport(selected)} onClear={() => setSelected([])} notify={notify} />
        ) : (
          <div className="props-empty">
            <p><b>Select an asset</b> to preview it and edit its status, tags and notes.</p>
            <p className="muted small">Ctrl-click or Shift-click to select several, then change them all at once, rename them or play them as an animation.</p>
          </div>
        )}
      </aside>
      {renaming && <RenameDialog ids={selectedAssets.map((a) => a.id)} onClose={() => setRenaming(false)} onDone={() => { setRenaming(false); props.onChanged(); }} notify={notify} />}
    </div>
  );
}
