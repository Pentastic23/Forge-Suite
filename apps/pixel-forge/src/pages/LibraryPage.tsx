import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import * as E from "../engine/editor";
import { api, errorText, plural } from "../api";
import { deleteSketch, duplicate, meta, patchMeta } from "../project";
import { addExample, pickSketches } from "../importing";
import { useEditor } from "../useEditor";
import type { Notify } from "../App";
import { SpriteCanvas } from "../components/SpriteView";

const ALL = "All sketches";
const FAV = "Favourites";

/** Everything made in this project, in folders, with tags, search and favourites. */
export function LibraryPage(props: { notify: Notify; onOpen: () => void }) {
  const { notify } = props;
  useEditor();
  const [base, setBase] = useState<string[]>(["Characters", "Enemies", "Effects", "Buildings", "UI", "Icons", "Animations"]);
  const [place, setPlace] = useState(ALL);
  const [tag, setTag] = useState<string>();
  const [text, setText] = useState("");
  const [sel, setSel] = useState<number[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  useEffect(() => { api.folders().then(setBase).catch(() => undefined); }, []);

  const rows = E.assets.map((a) => ({ a, m: meta.get(a.id) })).filter((r) => r.m);
  const folders = useMemo(() => {
    const extra = [...new Set(rows.map((r) => r.m!.folder))].filter((f) => !base.includes(f)).sort();
    return [...base, ...extra];
  }, [rows.length, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = (f: string) => rows.filter((r) => r.m!.folder === f).length;
  const tags = [...new Set(rows.flatMap((r) => r.m!.tags))].sort();
  const q = text.trim().toLowerCase();
  const shown = rows.filter(({ a, m }) =>
    (place === ALL || (place === FAV ? m!.favorite : m!.folder === place)) &&
    (!tag || m!.tags.includes(tag)) &&
    (!q || a.name.includes(q) || m!.tags.some((t) => t.includes(q)) || m!.folder.toLowerCase().includes(q)));
  const picked = sel.filter((id) => meta.has(id));
  const toggle = (id: number, add: boolean) => setSel((s) => add ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]);

  const update = async (ids: number[], patch: { folder?: string; tags?: string[]; favorite?: boolean }) => {
    try { await api.updateLibrary(ids, patch); } catch (e) { notify(errorText(e), true); return false; }
    return true;
  };
  const move = async (folder: string) => {
    if (!picked.length || !folder) return;
    if (await update(picked, { folder })) { patchMeta(picked, { folder }); notify(`Moved ${plural(picked.length, "sketch", "sketches")} to ${folder}`); }
  };
  const newFolder = async () => {
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    if (!folders.includes(name)) setBase((b) => [...b, name]);
    if (picked.length) await move(name); else setPlace(name);
  };
  const addTag = async () => {
    const t = tagDraft.trim().toLowerCase();
    if (!t || !picked.length) return;
    for (const id of picked) {
      const m = meta.get(id)!;
      const next = [...new Set([...m.tags, t])];
      if (await update([id], { tags: next })) patchMeta([id], { tags: next });
    }
    setTagDraft("");
  };
  const removeTag = async (id: number, t: string) => {
    const next = meta.get(id)!.tags.filter((x) => x !== t);
    if (await update([id], { tags: next })) patchMeta([id], { tags: next });
  };
  const fav = async (id: number) => {
    const favorite = !meta.get(id)!.favorite;
    if (await update([id], { favorite })) patchMeta([id], { favorite });
  };
  const open = (id: number) => { E.selectSketch(id); props.onOpen(); };
  const dup = async () => {
    for (const id of picked) { try { await duplicate(id); } catch (e) { notify(errorText(e), true); } }
    notify(`Duplicated ${plural(picked.length, "sketch", "sketches")}`);
  };
  const del = async () => {
    const ok = await ask(`Delete ${plural(picked.length, "sketch", "sketches")} from this project? Their rigs, animations and touch-ups go too. This can't be undone.`, { title: "Delete sketches", kind: "warning" }).catch(() => window.confirm("Delete these sketches?"));
    if (!ok) return;
    for (const id of picked) { try { await deleteSketch(id); } catch (e) { notify(errorText(e), true); } }
    setSel([]);
  };
  const addFolder = place === ALL || place === FAV ? "Characters" : place;

  return (
    <div className="library">
      <PageHeader title="Library" subtitle="Every sketch in this project and the sprites made from it."
        actions={<><Button onClick={() => void newFolder()}>New folder</Button><Button variant="primary" onClick={() => void pickSketches(addFolder, notify)}>Add sketches…</Button></>} />
      <div className="lib-layout">
        <nav className="lib-folders" aria-label="Folders">
          {[ALL, FAV].map((f) => (
            <button key={f} className="lib-folder" aria-current={place === f ? "true" : undefined} onClick={() => setPlace(f)}>
              {f}<span className="n">{f === ALL ? rows.length : rows.filter((r) => r.m!.favorite).length}</span>
            </button>
          ))}
          <div className="lbl">Folders</div>
          {folders.map((f) => (
            <button key={f} className="lib-folder" aria-current={place === f ? "true" : undefined} onClick={() => setPlace(f)}>
              {f}<span className="n">{count(f)}</span>
            </button>
          ))}
          {tags.length > 0 && <>
            <div className="lbl">Tags</div>
            <div className="tag-cloud">
              {tags.map((t) => <button key={t} className="tag" aria-pressed={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>{t}</button>)}
            </div>
          </>}
        </nav>

        <div className="lib-main">
          <div className="lib-bar">
            <input className="forge-input" type="search" placeholder="Search names, tags and folders" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
            <span className="muted small nowrap">{plural(shown.length, "sketch", "sketches")}</span>
          </div>
          {picked.length > 0 && (
            <Card className="lib-actions">
              <b>{plural(picked.length, "selected", "selected")}</b>
              <select className="forge-input" aria-label="Move to folder" value="" onChange={(e) => void move(e.target.value)}>
                <option value="">Move to…</option>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <input className="forge-input" placeholder="Add a tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addTag()} style={{ width: 140 }} />
              <Button onClick={() => void addTag()} disabled={!tagDraft.trim()}>Tag</Button>
              <Button onClick={() => void dup()}>Duplicate</Button>
              <Button variant="ghost" onClick={() => void del()}>Delete</Button>
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setSel([])}>Clear selection</Button>
            </Card>
          )}
          {rows.length === 0 ? (
            <EmptyState title="Nothing here yet">
              <p>Add sketches to start. Each one becomes pixel art at every size, and can be rigged and animated.</p>
              <div className="row-wrap center">
                <Button variant="primary" onClick={() => void pickSketches("Characters", notify)}>Add sketches…</Button>
                <Button onClick={() => void addExample(notify)}>Try the example sketch</Button>
              </div>
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState title="No sketches match"><p>Try another folder, tag or search.</p></EmptyState>
          ) : (
            <div className="lib-grid">
              {shown.map(({ a, m }) => (
                <div key={a.id} className={`lib-card${picked.includes(a.id) ? " on" : ""}`}
                  onClick={(e) => toggle(a.id, e.ctrlKey || e.metaKey || e.shiftKey)} onDoubleClick={() => open(a.id)}>
                  <div className="lib-thumb checker"><SpriteCanvas idx={E.spriteAt(a, 64)} N={64} box={128} label={a.name} /></div>
                  <div className="lib-meta">
                    <div className="lib-name" title={a.name}>{a.name}</div>
                    <button className={`star${m!.favorite ? " on" : ""}`} aria-pressed={m!.favorite} aria-label={m!.favorite ? "Remove from favourites" : "Add to favourites"}
                      onClick={(e) => { e.stopPropagation(); void fav(a.id); }}>{m!.favorite ? "★" : "☆"}</button>
                  </div>
                  <div className="muted small">{m!.folder} · {plural(a.anims.length, "animation")}{a.rig.bones.length ? ` · ${plural(a.rig.bones.length, "bone")}` : ""}</div>
                  {(m!.tags.length > 0 || a.sample) && (
                    <div className="tag-row">
                      {a.sample && <Badge>example</Badge>}
                      {m!.tags.map((t) => (
                        <span key={t} className="tag small-tag">{t}<button aria-label={`Remove tag ${t}`} onClick={(e) => { e.stopPropagation(); void removeTag(a.id, t); }}>×</button></span>
                      ))}
                    </div>
                  )}
                  <Button className="open-btn" onClick={(e) => { e.stopPropagation(); open(a.id); }}>Open in Studio</Button>
                </div>
              ))}
            </div>
          )}
          <p className="hint">Click to select, Ctrl+click to select several, double-click to open.</p>
        </div>
      </div>
    </div>
  );
}
