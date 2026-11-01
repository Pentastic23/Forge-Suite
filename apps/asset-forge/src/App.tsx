import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppShell, Button, Card, type NavItem } from "@forge/ui";
import logo from "../../../brand/asset-forge-logo-256.png";
import { api, errorText, type CurrentProject, type Facets, type Folder } from "./api";
import { LaunchBlocked, ProjectPicker } from "./components/ProjectPicker";
import { FoldersDialog } from "./components/FoldersDialog";
import { LibraryPage, type LibraryFilter } from "./pages/LibraryPage";
import { ChecksPage } from "./pages/ChecksPage";
import { ProductionPage } from "./pages/ProductionPage";
import { ExportPage } from "./pages/ExportPage";
import { ActivityPage } from "./pages/ActivityPage";

export type Notify = (msg: string, bad?: boolean) => void;
type Page = "library" | "checks" | "production" | "export" | "activity";

export function App() {
  const [launchError, setLaunchError] = useState<string | null>();
  const [project, setProject] = useState<CurrentProject | null>();
  const [toast, setToast] = useState<{ msg: string; bad?: boolean }>();
  const notify = useCallback<Notify>((msg, bad) => setToast({ msg, bad }), []);

  useEffect(() => {
    api.launchStatus().then(setLaunchError).catch(() => setLaunchError(null));
    api.projectCurrent().then(setProject).catch(() => setProject(null));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 5000);
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

function scanSummary(r: { added: number; changed: number; moved: number; missing: number; returned: number }): string {
  const parts = [
    r.added && `${r.added.toLocaleString()} new`,
    r.changed && `${r.changed} changed`,
    r.moved && `${r.moved} moved`,
    r.returned && `${r.returned} back`,
    r.missing && `${r.missing} missing`,
  ].filter(Boolean);
  return parts.length ? `Library updated: ${parts.join(", ")}` : "";
}

function Workspace(props: { project: CurrentProject; onProject: (p: CurrentProject | null) => void; notify: Notify }) {
  const { notify, project } = props;
  const [page, setPage] = useState<Page>("library");
  const [folders, setFolders] = useState<Folder[]>();
  const [facets, setFacets] = useState<Facets>();
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [version, setVersion] = useState(0);
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>();
  const [exportIds, setExportIds] = useState<string[]>([]);
  const scanning = useRef(false);

  const refresh = useCallback(() => {
    api.facets().then(setFacets).catch(() => undefined);
    api.folders().then(setFolders).catch((e) => notify(errorText(e), true));
    setVersion((v) => v + 1);
  }, [notify]);

  const rescan = useCallback(async (quiet?: boolean) => {
    if (scanning.current) return;
    scanning.current = true;
    setScan({ done: 0, total: 0 });
    try {
      const r = await api.scan();
      const msg = scanSummary(r);
      if (r.errors.length) notify(`${msg ? msg + ". " : ""}${r.errors.length} files couldn't be read, e.g. ${r.errors[0]}`, true);
      else if (msg) notify(msg);
      else if (!quiet) notify("Library is up to date");
    } catch (e) { notify(errorText(e), true); }
    scanning.current = false;
    setScan(null);
    refresh();
  }, [notify, refresh]);

  useEffect(() => {
    const un = listen<{ done: number; total: number }>("scan-progress", (e) => setScan(e.payload));
    return () => { void un.then((f) => f()); };
  }, []);

  // Catch up with changes made while the app was closed.
  useEffect(() => {
    api.folders().then((f) => {
      setFolders(f);
      if (f.length) void rescan(true);
      else setFoldersOpen(true);
    }).catch((e) => notify(errorText(e), true));
    api.facets().then(setFacets).catch(() => undefined);
  }, [rescan, notify]);

  const rename = async () => {
    const name = window.prompt("Project name", project.info.name);
    if (!name?.trim()) return;
    try { const info = await api.projectRename(name); props.onProject({ ...project, info }); } catch (e) { notify(errorText(e), true); }
  };

  const showInLibrary = (f: LibraryFilter) => { setFilter(f); setPage("library"); };

  const nav: NavItem<Page>[] = [
    { key: "library", label: "Library", badge: facets?.total.toLocaleString() },
    { key: "checks", label: "Checks" },
    { key: "production", label: "Production" },
    { key: "export", label: "Export" },
    { key: "activity", label: "Activity" },
  ];

  const header = (
    <div className="project-switch">
      <span className="label">Project</span>
      <button title="Rename project" onClick={() => void rename()}>{project.info.name}</button>
      <div className="folder-line">
        <button className="link" onClick={() => setFoldersOpen(true)}>{folders?.length ?? 0} {folders?.length === 1 ? "folder" : "folders"}</button>
        <Button style={{ padding: "4px 10px" }} disabled={!!scan || !folders?.length} onClick={() => void rescan()}>{scan ? "Scanning…" : "Rescan"}</Button>
      </div>
      {scan && (
        <div className="scan-progress" role="progressbar" aria-valuenow={scan.done} aria-valuemax={scan.total || undefined} aria-label="Scanning folders">
          <span style={{ width: scan.total ? `${(scan.done / scan.total) * 100}%` : "30%" }} className={scan.total ? "" : "indeterminate"} />
        </div>
      )}
      {scan && scan.total > 0 && <span className="muted small">{scan.done.toLocaleString()} of {scan.total.toLocaleString()} files</span>}
      <Button variant="ghost" style={{ marginTop: 4, padding: "4px 0", justifyContent: "flex-start" }}
        onClick={() => { void api.projectClose(); props.onProject(null); }}>Switch project</Button>
    </div>
  );

  const common = { notify, version, onChanged: refresh };
  return (
    <AppShell brand={{ name: "Asset Forge", logo }} nav={nav} current={page} onNavigate={setPage} header={header}>
      {page === "library" && <LibraryPage {...common} facets={facets} folders={folders ?? []} filter={filter} onClearFilter={() => setFilter(undefined)} onAddFolders={() => setFoldersOpen(true)} onExport={(ids) => { setExportIds(ids); setPage("export"); }} />}
      {page === "checks" && <ChecksPage {...common} onShow={showInLibrary} />}
      {page === "production" && <ProductionPage {...common} onShow={showInLibrary} />}
      {page === "export" && <ExportPage {...common} projectName={project.info.name} selection={exportIds} />}
      {page === "activity" && <ActivityPage {...common} />}
      {foldersOpen && folders && (
        <FoldersDialog
          folders={folders}
          onClose={() => setFoldersOpen(false)}
          onChanged={(added) => { refresh(); if (added) void rescan(); }}
          notify={notify}
        />
      )}
    </AppShell>
  );
}
