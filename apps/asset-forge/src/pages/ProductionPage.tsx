import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, errorText, type AssetSummary, type Readiness, type Requirement, type RequirementView, type SlotState, type SlotView } from "../api";
import { Thumb } from "../components/Preview";
import type { LibraryFilter } from "./LibraryPage";
import type { Notify } from "../App";

/** Every slot state has a shape and a word, never colour alone. */
export const SLOT: Record<SlotState, { icon: string; label: string; tone?: "good" | "warn" | "bad" }> = {
  done: { icon: "✓", label: "Done", tone: "good" },
  wip: { icon: "…", label: "In progress", tone: "warn" },
  broken: { icon: "!", label: "File missing", tone: "bad" },
  missing: { icon: "○", label: "Needed" },
};

type Show = "all" | "open" | "done";

function pct(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0;
}

function Meter(props: { done: number; total: number; label: string }) {
  const p = pct(props.done, props.total);
  return (
    <div className="meter-row">
      <span className="bar-label">{props.label}</span>
      <span className="bar-track" role="meter" aria-valuenow={props.done} aria-valuemax={props.total} aria-label={`${props.label}: ${props.done} of ${props.total}`}>
        <span className="bar" style={{ width: `${Math.max(p ? 1 : 0, p)}%` }} />
      </span>
      <span className="bar-value">{p}% <span className="muted">· {props.done}/{props.total}</span></span>
    </div>
  );
}

/** Pick the file that fills one slot, with guesses first. */
function LinkPicker(props: { req: RequirementView; slot: SlotView; onClose: () => void; onLinked: () => void; onShow: (f: LibraryFilter) => void; notify: Notify }) {
  const { req, slot, notify } = props;
  const [text, setText] = useState("");
  const [found, setFound] = useState<AssetSummary[]>();
  useEffect(() => {
    if (!text.trim()) { setFound(undefined); return; }
    const t = setTimeout(() => { api.list({ text: text.trim(), limit: 60 }).then((p) => setFound(p.assets)).catch((e) => notify(errorText(e), true)); }, 160);
    return () => clearTimeout(t);
  }, [text, notify]);

  const link = async (assetId: string | null) => {
    try {
      await api.link(req.id, slot.name, assetId);
      props.onLinked();
    } catch (e) { notify(errorText(e), true); }
  };

  const list = found ?? slot.suggestions;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal wide" role="dialog" aria-label={`Choose the file for ${slot.name}`}>
        <Card>
          <h3>{req.name}: {slot.name}</h3>
          {slot.asset ? (
            <div className="linked">
              <span className="thumb checker"><Thumb asset={slot.asset} size={64} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="ellipsis"><b>{slot.asset.name}</b></div>
                <div className="muted small ellipsis">{slot.asset.relPath}</div>
                <div className="chips" style={{ marginTop: 4 }}><SlotBadge state={slot.state} /> <Badge>{slot.asset.status}</Badge></div>
              </div>
              <Button variant="ghost" onClick={() => { props.onShow({ label: slot.asset!.name, ids: [slot.asset!.id] }); }}>Show in library</Button>
              <Button variant="ghost" className="danger" onClick={() => void link(null)}>Unlink</Button>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>Nothing is linked yet. Pick a file from your library.</p>
          )}
          <input className="forge-input" style={{ width: "100%", marginTop: 12 }} type="search" autoFocus placeholder="Search the library" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="filter-title" style={{ marginTop: 12 }}>{found ? `${found.length === 60 ? "First 60" : found.length} matches` : list.length ? "Likely matches, from the names" : ""}</div>
          {list.length === 0 && <p className="muted small">{found ? "Nothing matches." : "No likely matches. Search for the file instead."}</p>}
          <div className="pick-grid">
            {list.map((a) => (
              <button key={a.id} className="mini-tile pick" onClick={() => void link(a.id)} aria-pressed={slot.asset?.id === a.id} title={a.relPath}>
                <span className="thumb checker"><Thumb asset={a} size={72} /></span>
                <span className="ellipsis small">{a.name}</span>
                <span className="ellipsis muted small">{a.status}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <Button variant="ghost" onClick={props.onClose}>Close</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SlotBadge(props: { state: SlotState }) {
  const s = SLOT[props.state];
  return <Badge tone={s.tone}><span aria-hidden="true">{s.icon}</span> {s.label}</Badge>;
}

/** Add or change a requirement by hand. */
function RequirementEditor(props: { req?: RequirementView; groups: string[]; templates: Record<string, string[]>; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const r = props.req;
  const [name, setName] = useState(r?.name ?? "");
  const [group, setGroup] = useState(r?.group ?? props.groups[0] ?? "mob");
  const [slots, setSlots] = useState<string[]>(r ? r.slots.map((s) => s.name) : props.templates[group] ?? ["Sprite"]);
  const [notes, setNotes] = useState(r?.notes ?? "");
  const [touched, setTouched] = useState(!!r);

  const pickGroup = (g: string) => {
    setGroup(g);
    if (!touched && props.templates[g.trim().toLowerCase()]) setSlots(props.templates[g.trim().toLowerCase()]);
  };

  const save = async () => {
    const linked = new Map(r?.slots.map((s) => [s.name, s.asset?.id ?? null]) ?? []);
    const req: Requirement = {
      id: r?.id ?? "",
      sourceId: r?.sourceId ?? null,
      group,
      name,
      notes,
      slots: slots.map((s) => ({ name: s, assetId: linked.get(s.trim()) ?? null })),
      createdAt: 0,
      updatedAt: 0,
    };
    try { await api.saveRequirement(req); props.onSaved(); } catch (e) { props.notify(errorText(e), true); }
  };
  const remove = async () => {
    if (!r || !window.confirm(`Remove "${r.name}" from production? The files stay in the library.`)) return;
    try { await api.deleteRequirement(r.id); props.onSaved(); } catch (e) { props.notify(errorText(e), true); }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={r ? `Edit ${r.name}` : "Add requirement"}>
        <Card>
          <h3>{r ? "Edit requirement" : "Add requirement"}</h3>
          <div className="stack-sm">
            <div className="row2">
              <label className="field"><span>Name</span><input className="forge-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cave Bat" /></label>
              <label className="field"><span>Group</span>
                <input className="forge-input" list="req-groups" value={group} onChange={(e) => pickGroup(e.target.value)} />
                <datalist id="req-groups">{[...new Set([...props.groups, ...Object.keys(props.templates)])].map((g) => <option key={g} value={g} />)}</datalist>
              </label>
            </div>
            {r?.sourceId && <p className="muted small" style={{ margin: 0 }}>From Forge Core. Importing again updates the name and group, and keeps your links.</p>}
            <div className="field">
              <span>Files it needs</span>
              {slots.map((s, i) => (
                <div key={i} className="slot-edit">
                  <input className="forge-input" value={s} aria-label={`Slot ${i + 1}`} onChange={(e) => { setTouched(true); setSlots((x) => x.map((y, j) => (j === i ? e.target.value : y))); }} />
                  <button className="icon-btn" aria-label={`Remove ${s || "slot"}`} onClick={() => { setTouched(true); setSlots((x) => x.filter((_, j) => j !== i)); }}>×</button>
                </div>
              ))}
              <div><Button variant="ghost" onClick={() => { setTouched(true); setSlots((x) => [...x, ""]); }}>Add a file</Button></div>
            </div>
            <label className="field"><span>Notes</span><textarea className="forge-input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            {r && <Button variant="ghost" className="danger" onClick={() => void remove()}>Remove</Button>}
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>Save</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Which files each kind of Forge Core entry needs. */
function TemplatesCard(props: { templates: Record<string, string[]>; onSaved: () => void; notify: Notify }) {
  const [draft, setDraft] = useState(() => Object.entries(props.templates).map(([g, s]) => [g, s.join(", ")] as [string, string]));
  useEffect(() => setDraft(Object.entries(props.templates).map(([g, s]) => [g, s.join(", ")])), [props.templates]);
  const save = async () => {
    const out: Record<string, string[]> = {};
    for (const [g, s] of draft) {
      const key = g.trim().toLowerCase();
      if (key) out[key] = s.split(",").map((x) => x.trim()).filter(Boolean);
    }
    try { await api.setSetting("slotTemplates", out); props.notify("Saved. New imports use these lists."); props.onSaved(); } catch (e) { props.notify(errorText(e), true); }
  };
  return (
    <details className="rules">
      <summary>What each kind of entry needs</summary>
      <p className="muted small">Used when importing from Forge Core and adding requirements. Existing requirements keep their own list.</p>
      <table className="entity-table compact">
        <thead><tr><th>Kind</th><th>Files, separated by commas</th><th /></tr></thead>
        <tbody>
          {draft.map(([g, s], i) => (
            <tr key={i}>
              <td style={{ width: 160 }}><input className="forge-input" value={g} aria-label="Kind" onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} /></td>
              <td><input className="forge-input" style={{ width: "100%" }} value={s} placeholder="Nothing, skip this kind" aria-label={`Files for ${g}`} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} /></td>
              <td style={{ width: 40 }}><button className="icon-btn" aria-label={`Remove ${g}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button variant="ghost" onClick={() => setDraft((d) => [...d, ["", ""]])}>Add a kind</Button>
        <Button variant="primary" onClick={() => void save()}>Save lists</Button>
      </div>
    </details>
  );
}

export function ProductionPage(props: { version: number; onChanged: () => void; onShow: (f: LibraryFilter) => void; notify: Notify }) {
  const { notify } = props;
  const [data, setData] = useState<Readiness>();
  const [templates, setTemplates] = useState<Record<string, string[]>>({});
  const [group, setGroup] = useState<string>();
  const [show, setShow] = useState<Show>("open");
  const [text, setText] = useState("");
  const [picking, setPicking] = useState<{ req: RequirementView; slot: string }>();
  const [editing, setEditing] = useState<RequirementView | "new">();

  const load = useCallback(() => {
    api.readiness().then(setData).catch((e) => notify(errorText(e), true));
    api.slotTemplates().then(setTemplates).catch(() => undefined);
  }, [notify]);
  useEffect(load, [load, props.version]);

  const importCodex = async () => {
    const path = await open({ multiple: false, title: "Import from Forge Core", filters: [{ name: "Forge Core export", extensions: ["forgecodex"] }] });
    if (typeof path !== "string") return;
    try {
      const [added, updated] = await api.codexImport(path);
      notify(added || updated ? `Imported from Forge Core: ${added} new, ${updated} updated` : "Nothing new to import. Entries of kinds that need no files are skipped.");
      load();
    } catch (e) { notify(errorText(e), true); }
  };

  const groups = data ? Object.entries(data.groups).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (data?.requirements ?? []).filter((r) =>
      (!group || r.group === group) &&
      (show === "all" || (show === "done" ? r.total > 0 && r.done === r.total : r.done < r.total)) &&
      (!t || r.name.toLowerCase().includes(t)));
  }, [data, group, show, text]);

  // The picker keeps working on fresh data after a link changes.
  const pickReq = picking && data?.requirements.find((r) => r.id === picking.req.id);
  const pickSlot = pickReq?.slots.find((s) => s.name === picking?.slot);

  const empty = data && data.requirements.length === 0;
  return (
    <div className="stack">
      <PageHeader
        title="Production"
        subtitle="What each Forge Core entry still needs: sprites, sounds, icons. Link a file to tick it off."
        actions={<>
          <Button onClick={() => setEditing("new")}>Add requirement</Button>
          <Button variant="primary" onClick={() => void importCodex()}>Import from Forge Core</Button>
        </>}
      />

      {empty ? (
        <Card>
          <EmptyState title="Nothing to track yet">
            <p>In Forge Core, export your codex as a .forgecodex file, then import it here. Each mob, item, skill and zone becomes a list of the files it needs.</p>
            <p className="muted small">You can also add requirements by hand.</p>
            <Button variant="primary" onClick={() => void importCodex()}>Import from Forge Core</Button>
          </EmptyState>
        </Card>
      ) : data && (
        <>
          <Card>
            <div className="ready-head">
              <div className="ready-big">
                <b>{pct(data.done, data.total)}%</b>
                <span className="muted">ready · {data.done} of {data.total} files</span>
              </div>
              <div className="bars" style={{ flex: 1 }}>
                {groups.map(([g, [d, t]]) => <Meter key={g} label={g} done={d} total={t} />)}
              </div>
            </div>
            <div className="legend" aria-label="Legend">
              {(["done", "wip", "broken", "missing"] as SlotState[]).map((s) => <SlotBadge key={s} state={s} />)}
              <span className="muted small">Done means the file is Approved or Final.</span>
            </div>
          </Card>

          <Card>
            <div className="toolbar">
              <input className="forge-input search" type="search" placeholder="Find an entry" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="seg caps" role="group" aria-label="Group">
                <button aria-pressed={!group} onClick={() => setGroup(undefined)}>All</button>
                {groups.map(([g]) => <button key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>)}
              </div>
              <div className="seg" role="group" aria-label="Show">
                <button aria-pressed={show === "open"} onClick={() => setShow("open")}>Still needed</button>
                <button aria-pressed={show === "done"} onClick={() => setShow("done")}>Ready</button>
                <button aria-pressed={show === "all"} onClick={() => setShow("all")}>Everything</button>
              </div>
              <span className="hint muted">{rows.length} of {data.requirements.length}</span>
            </div>
            {rows.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 24 }}>{show === "open" ? "✓ Nothing left here." : "Nothing matches."}</p>}
            <ul className="req-list">
              {rows.map((r) => (
                <li key={r.id} className="req">
                  <div className="req-name">
                    <button className="link-plain" onClick={() => setEditing(r)} title="Edit">{r.name}</button>
                    <span className="muted small">{r.group}{r.sourceId ? " · from Forge Core" : ""}</span>
                  </div>
                  <div className="req-slots">
                    {r.slots.length === 0 && <span className="muted small">No files needed</span>}
                    {r.slots.map((s) => (
                      <button key={s.name} className={`slot ${s.state}`} onClick={() => setPicking({ req: r, slot: s.name })}
                        title={s.asset ? `${s.name}: ${s.asset.relPath} (${SLOT[s.state].label})` : `${s.name}: ${SLOT[s.state].label}${s.suggestions.length ? `, ${s.suggestions.length} likely matches` : ""}`}>
                        {s.asset ? <span className="slot-thumb checker"><Thumb asset={s.asset} size={28} /></span> : <span className="slot-icon" aria-hidden="true">{SLOT[s.state].icon}</span>}
                        <span className="slot-text">
                          <span className="slot-name">{s.name}</span>
                          <span className="slot-state">{s.asset ? s.asset.name : s.suggestions.length ? `${SLOT[s.state].label} · ${s.suggestions.length} ${s.suggestions.length === 1 ? "guess" : "guesses"}` : SLOT[s.state].label}</span>
                        </span>
                        {s.asset && <span className="slot-mark" aria-label={SLOT[s.state].label}>{SLOT[s.state].icon}</span>}
                      </button>
                    ))}
                  </div>
                  <span className="req-count" aria-label={`${r.done} of ${r.total} done`}>{r.done}/{r.total}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <TemplatesCard templates={templates} onSaved={load} notify={notify} />

      {pickReq && pickSlot && (
        <LinkPicker req={pickReq} slot={pickSlot} onClose={() => setPicking(undefined)} onLinked={() => { load(); props.onChanged(); }}
          onShow={(f) => { setPicking(undefined); props.onShow(f); }} notify={notify} />
      )}
      {editing && (
        <RequirementEditor req={editing === "new" ? undefined : editing} groups={groups.map(([g]) => g)} templates={templates}
          onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} notify={notify} />
      )}
    </div>
  );
}
