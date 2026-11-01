import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AppShell, Button, Card, EmptyState, PageHeader, type NavItem } from "@forge/ui";
import logo from "../../../brand/forge-core-logo-256.png";
import { api, errorText, type CurrentProject, type Entity, type EntitySummary } from "./api";
import { MODULES, MODULE_BY_KIND, STATUSES, type Kind } from "./modules";
import { Editor } from "./components/Editor";
import { EntityCards, EntityTable } from "./components/EntityList";
import { ExportDialog } from "./components/ExportDialog";
import { LaunchBlocked, ProjectPicker } from "./components/ProjectPicker";
import { SearchPage } from "./components/SearchPage";

type Page = Kind | "search";
type View = "table" | "cards";
type EditTarget = { id: string } | { newKind: Kind };

function readView(): View {
  try { return localStorage.getItem("forge-core.view") === "cards" ? "cards" : "table"; } catch { return "table"; }
}

export function App() {
  const [launchError, setLaunchError] = useState<string | null>();
  const [project, setProject] = useState<CurrentProject | null>();
  const [toast, setToast] = useState<{ msg: string; bad?: boolean }>();
  const notify = useCallback((msg: string, bad?: boolean) => setToast({ msg, bad }), []);

  useEffect(() => {
    api.launchStatus().then(setLaunchError).catch(() => setLaunchError(null));
    api.projectCurrent().then(setProject).catch(() => setProject(null));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const toastEl = toast && (
    <div className="toast"><Card accent={toast.bad ? "var(--forge-bad)" : undefined}><span role="status">{toast.msg}</span></Card></div>
  );

  if (launchError === undefined || project === undefined) return null;
  if (launchError) return <LaunchBlocked message={launchError} />;
  if (!project) return <>{<ProjectPicker onOpened={setProject} notify={notify} />}{toastEl}</>;
  return (
    <>
      <Workspace key={project.path} project={project} onProject={setProject} notify={notify} />
      {toastEl}
    </>
  );
}

function Workspace(props: { project: CurrentProject; onProject: (p: CurrentProject | null) => void; notify: (msg: string, bad?: boolean) => void }) {
  const { notify } = props;
  const [page, setPage] = useState<Page>("lore");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [rows, setRows] = useState<EntitySummary[]>([]);
  const [text, setText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [view, setView] = useState<View>(readView);
  const [editing, setEditing] = useState<EditTarget>();
  const [exporting, setExporting] = useState(false);

  const refreshMeta = useCallback(() => {
    api.counts().then(setCounts).catch(() => undefined);
    api.tags().then((t) => setTags(t.map(([name]) => name))).catch(() => undefined);
  }, []);
  useEffect(refreshMeta, [refreshMeta]);

  const kind = page === "search" ? undefined : page;
  const loadRows = useCallback(() => {
    if (!kind) return;
    api.list({ kind, text: text || undefined, entityType: typeFilter || undefined, status: statusFilter || undefined, tag: tagFilter || undefined })
      .then(setRows)
      .catch((e) => notify(errorText(e), true));
  }, [kind, text, typeFilter, statusFilter, tagFilter, notify]);
  useEffect(() => {
    const t = setTimeout(loadRows, text ? 150 : 0);
    return () => clearTimeout(t);
  }, [loadRows, text]);

  const go = (p: Page) => {
    setPage(p);
    setText(""); setTypeFilter(""); setStatusFilter(""); setTagFilter("");
    setEditing(undefined);
  };
  const setViewSaved = (v: View) => { setView(v); try { localStorage.setItem("forge-core.view", v); } catch { /* ignore */ } };

  const openEntry = useCallback(async (id: string) => {
    try {
      const e = await api.get(id);
      if (e.kind !== page) { setPage(e.kind); setText(""); setTypeFilter(""); setStatusFilter(""); setTagFilter(""); }
      setEditing({ id });
    } catch (err) { notify(errorText(err), true); }
  }, [page, notify]);

  const onSaved = useCallback((e: Entity) => {
    loadRows(); refreshMeta();
    setEditing((cur) => (cur && "newKind" in cur ? { id: e.id } : cur));
  }, [loadRows, refreshMeta]);

  const importFile = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Forge Core data", extensions: ["forgecodex", "json"] }] });
    if (typeof path !== "string") return;
    try {
      const [added, updated] = await api.importFrom(path);
      notify(`Imported: ${added} new, ${updated} updated`);
      loadRows(); refreshMeta();
    } catch (e) { notify(errorText(e), true); }
  };

  const rename = async () => {
    const name = window.prompt("Project name", props.project.info.name);
    if (!name?.trim()) return;
    try { const info = await api.projectRename(name); props.onProject({ ...props.project, info }); } catch (e) { notify(errorText(e), true); }
  };

  const nav: NavItem<Page>[] = useMemo(
    () => [
      ...MODULES.map((m) => ({ key: m.kind as Page, label: m.label, badge: counts[m.kind] ?? 0 })),
    ],
    [counts],
  );
  const footer: NavItem<Page>[] = [{ key: "search", label: "Search everything" }];

  const header = (
    <div className="project-switch">
      <span className="label">Project</span>
      <button title="Rename project" onClick={() => void rename()}>{props.project.info.name}</button>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button style={{ flex: 1, padding: "6px 8px" }} onClick={() => setExporting(true)}>Export</Button>
        <Button style={{ flex: 1, padding: "6px 8px" }} onClick={() => void importFile()}>Import</Button>
      </div>
      <Button variant="ghost" style={{ marginTop: 4, padding: "4px 0", justifyContent: "flex-start" }}
        onClick={() => { void api.projectClose(); props.onProject(null); }}>Switch project</Button>
    </div>
  );

  const mod = kind ? MODULE_BY_KIND[kind] : undefined;
  const filtered = !!(text || typeFilter || statusFilter || tagFilter);
  const selectedId = editing && "id" in editing ? editing.id : undefined;

  return (
    <AppShell brand={{ name: "Forge Core", logo }} nav={nav} footerNav={footer} current={page} onNavigate={go} header={header}>
      {page === "search" ? (
        <SearchPage onOpen={(e) => void openEntry(e.id)} />
      ) : mod && (
        <div className={editing ? "core-layout editing" : "core-layout"}>
          <div className="core-list">
            <PageHeader
              title={mod.label}
              subtitle={`${counts[mod.kind] ?? 0} ${(counts[mod.kind] ?? 0) === 1 ? "entry" : "entries"}`}
              actions={<Button variant="primary" onClick={() => setEditing({ newKind: mod.kind })}>New {mod.singular.toLowerCase()}</Button>}
            />
            <div className="toolbar">
              <input className="forge-input search" placeholder={`Search ${mod.label.toLowerCase()}`} value={text} onChange={(e) => setText(e.target.value)} />
              <select className="forge-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
                <option value="">All types</option>
                {mod.types.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select className="forge-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
                <option value="">Any status</option>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {tags.length > 0 && (
                <select className="forge-input" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Tag">
                  <option value="">Any tag</option>
                  {tags.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
              <div className="seg" role="group" aria-label="View">
                <button aria-pressed={view === "table"} onClick={() => setViewSaved("table")}>Table</button>
                <button aria-pressed={view === "cards"} onClick={() => setViewSaved("cards")}>Cards</button>
              </div>
            </div>
            {rows.length === 0 ? (
              <Card>
                <EmptyState title={filtered ? "Nothing matches" : `No ${mod.label.toLowerCase()} yet`}>
                  {filtered ? <p>Try clearing a filter.</p> : <Button variant="primary" onClick={() => setEditing({ newKind: mod.kind })}>Add the first {mod.singular.toLowerCase()}</Button>}
                </EmptyState>
              </Card>
            ) : view === "table" ? (
              <EntityTable mod={mod} rows={rows} selectedId={selectedId} onSelect={(id) => setEditing({ id })} />
            ) : (
              <EntityCards mod={mod} rows={rows} selectedId={selectedId} onSelect={(id) => setEditing({ id })} />
            )}
          </div>
          {editing && (
            <Editor
              target={editing}
              tagSuggestions={tags}
              onSaved={onSaved}
              onDeleted={() => { setEditing(undefined); loadRows(); refreshMeta(); notify("Entry deleted"); }}
              onOpen={(id) => void openEntry(id)}
              onClose={() => setEditing(undefined)}
              notify={notify}
            />
          )}
        </div>
      )}
      {exporting && <ExportDialog projectName={props.project.info.name} onClose={() => setExporting(false)} notify={notify} />}
    </AppShell>
  );
}
