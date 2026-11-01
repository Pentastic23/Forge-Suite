import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button } from "@forge/ui";
import { api, blankEntity, errorText, when, type Backlink, type Entity, type VersionInfo } from "../api";
import { MODULE_BY_KIND, STATUSES, fieldLabel, type FieldDef, type Kind } from "../modules";
import { LinkPicker } from "./LinkPicker";
import { TagInput } from "./TagInput";

type Tab = "details" | "description" | "linked" | "history";
type SaveState = "saved" | "dirty" | "saving" | "error";

const AUTOSAVE_MS = 2500;

export function Editor(props: {
  /** Entry to edit, or a module for a new entry. */
  target: { id: string } | { newKind: Kind };
  tagSuggestions: string[];
  onSaved: (e: Entity) => void;
  onDeleted: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  notify: (msg: string, bad?: boolean) => void;
}) {
  const [draft, setDraft] = useState<Entity>();
  const [state, setState] = useState<SaveState>("saved");
  const [tab, setTab] = useState<Tab>("details");
  const [names, setNames] = useState<Record<string, [string, Kind]>>({});
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<Entity>();
  draftRef.current = draft;
  const stateRef = useRef<SaveState>("saved");
  stateRef.current = state;
  const propsRef = useRef(props);
  propsRef.current = props;

  const targetKey = "id" in props.target ? props.target.id : `new:${props.target.newKind}`;

  useEffect(() => {
    let cancelled = false;
    setTab("details");
    if ("newKind" in props.target) {
      setDraft(blankEntity(props.target.newKind));
      setState("saved");
      setTimeout(() => nameRef.current?.focus(), 0);
      return;
    }
    api.get(props.target.id).then((e) => { if (!cancelled) { setDraft(e); setState("saved"); } }).catch((e) => props.notify(errorText(e), true));
    return () => { cancelled = true; };
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Names for link chips.
  const linkKey = draft?.links.map((l) => l.toId).join(",") ?? "";
  useEffect(() => {
    const ids = [...new Set(linkKey.split(",").filter(Boolean))];
    if (!ids.length) return;
    api.names(ids).then((n) => setNames((prev) => ({ ...prev, ...n }))).catch(() => undefined);
  }, [linkKey]);

  useEffect(() => {
    if (!draft?.id) { setBacklinks([]); setVersions([]); return; }
    if (tab === "linked") api.backlinks(draft.id).then(setBacklinks).catch(() => setBacklinks([]));
    if (tab === "history") api.versions(draft.id).then(setVersions).catch(() => setVersions([]));
  }, [tab, draft?.id, draft?.version]);

  const save = useCallback(async () => {
    const d = draftRef.current;
    if (!d || stateRef.current === "saving" || stateRef.current === "saved") return;
    if (!d.name.trim()) { setState("error"); return; }
    setState("saving");
    try {
      const saved = await api.save(d);
      // Keep anything typed while the save was in flight.
      setDraft((cur) => (cur && cur !== d ? { ...cur, id: saved.id, version: saved.version, createdAt: saved.createdAt, updatedAt: saved.updatedAt } : saved));
      setState(draftRef.current !== d ? "dirty" : "saved");
      propsRef.current.onSaved(saved);
    } catch (e) {
      setState("error");
      propsRef.current.notify(errorText(e), true);
    }
  }, []);

  // Autosave after a pause in typing, and when leaving this entry.
  useEffect(() => {
    if (state !== "dirty") return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [draft, state, save]);
  useEffect(() => () => { void save(); }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  if (!draft) return <div className="editor"><div className="editor-body muted">Loading…</div></div>;
  const mod = MODULE_BY_KIND[draft.kind];

  const update = (patch: Partial<Entity>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setState("dirty"); };
  const setField = (key: string, value: unknown) => {
    const fields = { ...draft.fields };
    if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) delete fields[key];
    else fields[key] = value;
    update({ fields });
  };
  const linksFor = (key: string) => draft.links.filter((l) => l.relation === key).map((l) => l.toId);
  const setLinks = (key: string, ids: string[]) =>
    update({ links: [...draft.links.filter((l) => l.relation !== key), ...ids.map((toId) => ({ toId, relation: key }))] });

  const remove = async () => {
    if (!draft.id) { props.onClose(); return; }
    if (!window.confirm(`Delete "${draft.name}"? Links to it from other entries are removed too.`)) return;
    try { await api.remove(draft.id); setState("saved"); props.onDeleted(); } catch (e) { props.notify(errorText(e), true); }
  };
  const restore = async (v: VersionInfo) => {
    if (!window.confirm(`Bring back version ${v.version} from ${when(v.savedAt)}? The current version stays in history.`)) return;
    try { const e = await api.restore(draft.id, v.version); setDraft(e); setState("saved"); props.onSaved(e); props.notify(`Restored version ${v.version}`); }
    catch (e) { props.notify(errorText(e), true); }
  };

  const renderField = (f: FieldDef) => {
    const v = draft.fields[f.key];
    switch (f.type) {
      case "text":
        return <input className="forge-input" value={(v as string) ?? ""} onChange={(e) => setField(f.key, e.target.value)} />;
      case "longtext":
        return <textarea className="forge-input" rows={3} value={(v as string) ?? ""} onChange={(e) => setField(f.key, e.target.value)} />;
      case "number":
        return (
          <input className="forge-input" type="number" value={typeof v === "number" ? v : ""} placeholder={f.unit}
            onChange={(e) => setField(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />
        );
      case "select":
        return (
          <select className="forge-input" value={(v as string) ?? ""} onChange={(e) => setField(f.key, e.target.value)}>
            <option value="">Not set</option>
            {f.options.map((o) => <option key={o}>{o}</option>)}
          </select>
        );
      case "list":
        return (
          <textarea className="forge-input" rows={3} placeholder={f.hint}
            value={Array.isArray(v) ? (v as string[]).join("\n") : ""}
            onChange={(e) => setField(f.key, e.target.value.split("\n").map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1))}
            onBlur={(e) => setField(f.key, e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
        );
      case "rating":
        return (
          <div className="rating" role="radiogroup" aria-label={f.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={typeof v === "number" && n <= v ? "on" : undefined} aria-label={`${n} of 5`}
                onClick={() => setField(f.key, v === n ? undefined : n)}>★</button>
            ))}
          </div>
        );
      case "link":
        return <LinkPicker to={f.to} selected={linksFor(f.key)} names={names} excludeId={draft.id} onChange={(ids) => setLinks(f.key, ids)} onOpen={props.onOpen} />;
    }
  };

  // Pair short fields two to a row; long fields and links take the full width.
  const short = (f: FieldDef) => f.type === "number" || f.type === "select" || f.type === "text" || f.type === "rating";
  const rows: FieldDef[][] = [];
  for (const f of mod.fields) {
    const last = rows[rows.length - 1];
    if (short(f) && last && last.length === 1 && short(last[0])) last.push(f);
    else rows.push([f]);
  }

  const stateText = { saved: draft.id ? "Saved" : "Not saved yet", dirty: "Unsaved changes", saving: "Saving…", error: draft.name.trim() ? "Save failed" : "Needs a name" }[state];

  return (
    <div className="editor">
      <div className="editor-head">
        <input ref={nameRef} className="name" placeholder={`${mod.singular} name`} value={draft.name} onChange={(e) => update({ name: e.target.value })} aria-label="Name" />
        <span className="save-state">{stateText}</span>
        <Button variant="primary" onClick={() => void save()} disabled={state === "saved" || state === "saving"}>Save</Button>
        <Button variant="ghost" aria-label="Close editor" onClick={() => { void save(); props.onClose(); }}>✕</Button>
      </div>
      <div className="editor-tabs" role="tablist">
        {(["details", "description", "linked", "history"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} disabled={!draft.id && (t === "linked" || t === "history")}>
            {{ details: "Details", description: "Description", linked: "Linked from", history: "History" }[t]}
          </button>
        ))}
      </div>
      <div className="editor-body">
        {tab === "details" && (
          <>
            <div className="row2">
              <label className="field"><span>Type</span>
                <select className="forge-input" value={draft.entityType} onChange={(e) => update({ entityType: e.target.value })}>
                  <option value="">Not set</option>
                  {mod.types.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="field"><span>Status</span>
                <select className="forge-input" value={draft.status} onChange={(e) => update({ status: e.target.value })}>
                  <option value="">Not set</option>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span>Summary</span>
              <textarea className="forge-input" rows={2} value={draft.summary} onChange={(e) => update({ summary: e.target.value })} placeholder="One or two sentences" />
            </label>
            {rows.map((r) => (
              <div key={r.map((f) => f.key).join()} className={r.length === 2 ? "row2" : undefined}>
                {r.map((f) => (
                  <div key={f.key} className="field"><span>{f.label}</span>{renderField(f)}</div>
                ))}
              </div>
            ))}
            <div className="field"><span>Tags</span><TagInput tags={draft.tags} suggestions={props.tagSuggestions} onChange={(tags) => update({ tags })} /></div>
            <div className="row2">
              <label className="field"><span>Author</span><input className="forge-input" value={draft.author} onChange={(e) => update({ author: e.target.value })} /></label>
              <div className="field"><span>Created · updated</span><div className="muted" style={{ paddingTop: 8 }}>{draft.id ? `${when(draft.createdAt)} · ${when(draft.updatedAt)}` : "Not saved yet"}</div></div>
            </div>
            <div><Button variant="ghost" onClick={() => void remove()} style={{ color: "var(--forge-bad)" }}>{draft.id ? "Delete entry" : "Discard"}</Button></div>
          </>
        )}
        {tab === "description" && (
          <label className="field" style={{ flex: 1 }}><span>Full description (Markdown)</span>
            <textarea className="forge-input" style={{ minHeight: 420 }} value={draft.body} onChange={(e) => update({ body: e.target.value })} />
          </label>
        )}
        {tab === "linked" && (
          backlinks.length === 0 ? <p className="muted">No other entries link here yet.</p> : (
            <ul className="list-plain">
              {backlinks.map((b) => (
                <li key={b.fromId + b.relation}>
                  <button className="result" style={{ padding: 0 }} onClick={() => props.onOpen(b.fromId)}>{b.fromName}</button>
                  <span className="muted">{MODULE_BY_KIND[b.fromKind]?.singular} · {fieldLabel(b.fromKind, b.relation)}</span>
                </li>
              ))}
            </ul>
          )
        )}
        {tab === "history" && (
          <>
            <p className="muted" style={{ margin: 0 }}>Current: version {draft.version}, saved {when(draft.updatedAt)}. Restoring an older version saves it as a new version, so nothing is lost.</p>
            {versions.length === 0 ? <p className="muted">No earlier versions yet.</p> : (
              <ul className="list-plain">
                {versions.map((v) => (
                  <li key={v.version}>
                    <span><Badge>v{v.version}</Badge> {v.name} <span className="muted">· {when(v.savedAt)}</span></span>
                    <Button onClick={() => void restore(v)}>Restore</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
