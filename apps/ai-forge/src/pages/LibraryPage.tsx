import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, errorText, plural, type Asset } from "../api";
import type { Notify } from "../App";
import { AssetViewer } from "../components/AssetViewer";
import { Seg } from "../components/controls";
import { Thumb } from "../components/Thumb";

/** Everything made in this project: images and 3D models, with folders, tags and favourites. */
export function LibraryPage(props: { notify: Notify; onUsePrompt: (p: string, t: "image" | "model") => void }) {
  const { notify } = props;
  const [assets, setAssets] = useState<Asset[]>();
  const [kind, setKind] = useState<"all" | "image" | "model">("all");
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);

  const reload = () => api.assets().then((a) => { setAssets(a); setOpen((o) => (o ? a.find((x) => x.id === o.id) ?? null : null)); }).catch((e) => notify(errorText(e), true));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(() => [...new Set((assets ?? []).map((a) => a.folder))].sort(), [assets]);
  const shown = (assets ?? []).filter((a) => {
    if (kind !== "all" && a.kind !== kind) return false;
    if (folder && a.folder !== folder) return false;
    if (favs && !a.favorite) return false;
    const q = query.trim().toLowerCase();
    return !q || a.name.toLowerCase().includes(q) || a.prompt.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q));
  });

  const addFile = async () => {
    const paths = await openDialog({ multiple: true, filters: [{ name: "Images and GLB models", extensions: ["png", "jpg", "jpeg", "webp", "glb"] }] });
    const list = Array.isArray(paths) ? paths : typeof paths === "string" ? [paths] : [];
    let n = 0;
    for (const p of list) {
      try { await api.assetImport(p); n++; } catch (e) { notify(errorText(e), true); }
    }
    if (n) { notify(`Added ${plural(n, "file")}`); void reload(); }
  };
  const moveTo = async (a: Asset) => {
    const f = window.prompt("Folder", a.folder);
    if (f === null) return;
    try { await api.assetsUpdate([a.id], { folder: f }); void reload(); } catch (e) { notify(errorText(e), true); }
  };
  const tag = async (a: Asset) => {
    const t = window.prompt("Tags, separated by commas", a.tags.join(", "));
    if (t === null) return;
    try { await api.assetsUpdate([a.id], { tags: t.split(",") }); void reload(); } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="stack">
      <PageHeader title="Library" subtitle="Every image and 3D model made in this project. Save them as files for your engine, Pixel Forge or Asset Forge." actions={<Button onClick={() => void addFile()}>Add files…</Button>} />
      <div className="row-wrap">
        <Seg label="Show" value={kind} options={[["all", "Everything"], ["image", "Images"], ["model", "3D models"]]} onChange={setKind} />
        <select className="forge-input" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="">All folders</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input className="forge-input" placeholder="Search names, prompts and tags" value={query} onChange={(e) => setQuery(e.target.value)} style={{ minWidth: 260 }} />
        <label className="check"><input type="checkbox" checked={favs} onChange={(e) => setFavs(e.target.checked)} /> Favourites</label>
        <span className="spacer" />
        {assets && <span className="muted small">{plural(shown.length, "item")}</span>}
      </div>
      {assets && assets.length === 0 ? (
        <Card><EmptyState title="Nothing here yet">Make art on the Images page or a model on the 3D page, and it is kept here.</EmptyState></Card>
      ) : (
        <div className="lib-grid">
          {shown.map((a) => (
            <Card key={a.id} className="lib-card">
              <button className="thumb-btn" onClick={() => setOpen(a)} title={a.prompt || a.name}><Thumb asset={a} size={176} /></button>
              <div className="lib-name">{a.favorite ? "★ " : ""}{a.name}</div>
              <div className="muted small">{a.folder}{a.tags.length ? ` · ${a.tags.join(", ")}` : ""}</div>
              <div className="lib-tools">
                <button onClick={() => void moveTo(a)}>Folder</button>
                <button onClick={() => void tag(a)}>Tags</button>
                <button onClick={() => void api.assetsUpdate([a.id], { favorite: !a.favorite }).then(reload)}>{a.favorite ? "Unfavourite" : "Favourite"}</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {open && <AssetViewer asset={open} notify={notify} onClose={() => setOpen(null)} onChanged={() => void reload()} onUsePrompt={props.onUsePrompt} />}
    </div>
  );
}
