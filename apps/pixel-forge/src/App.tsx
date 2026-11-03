import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppShell, Button, Card, type NavItem } from "@forge/ui";
import logo from "../../../brand/pixel-forge-logo-256.png";
import { api, errorText, type CurrentProject } from "./api";
import { LaunchBlocked, ProjectPicker } from "./components/ProjectPicker";
import { assets, setToast } from "./engine/editor";
import { hasUnsaved, loadProject, saveNow } from "./project";
import { useEditor } from "./useEditor";
import { StudioPage } from "./pages/StudioPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LibraryPage } from "./pages/LibraryPage";
import { ExportPage } from "./pages/ExportPage";
import { ActivityPage } from "./pages/ActivityPage";

export type Notify = (msg: string, bad?: boolean) => void;
export type Page = "studio" | "library" | "export" | "activity";

export function App() {
  const [launchError, setLaunchError] = useState<string | null>();
  const [project, setProject] = useState<CurrentProject | null>();
  const [toast, setToastMsg] = useState<{ msg: string; bad?: boolean; n: number }>();
  const notify = useCallback<Notify>((msg, bad) => setToastMsg((t) => ({ msg, bad, n: (t?.n ?? 0) + 1 })), []);

  useEffect(() => {
    setToast((m) => notify(m));
    api.launchStatus().then(setLaunchError).catch(() => setLaunchError(null));
    api.projectCurrent().then(setProject).catch(() => setProject(null));
  }, [notify]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToastMsg(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const toastEl = toast && (
    <div className="toast" key={toast.n}><Card accent={toast.bad ? "var(--forge-bad)" : undefined}><span role="status">{toast.msg}</span></Card></div>
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

function Workspace(props: { project: CurrentProject; onProject: (p: CurrentProject | null) => void; notify: Notify }) {
  const { notify, project } = props;
  const [page, setPage] = useState<Page>("studio");
  const [loaded, setLoaded] = useState(false);
  useEditor();

  useEffect(() => {
    let live = true;
    loadProject().then((bad) => {
      if (!live) return;
      setLoaded(true);
      if (bad.length) notify(`${bad.length} sketch images couldn't be read: ${bad.slice(0, 3).join(", ")}`, true);
    }).catch((e) => notify(errorText(e), true));
    return () => { live = false; };
  }, [notify]);

  // Save a moment after each change, and before the window closes.
  useEffect(() => {
    let failed = false;
    const t = setInterval(() => {
      if (!hasUnsaved()) return;
      saveNow().then(() => { failed = false; }).catch((e) => { if (!failed) notify(`Couldn't save: ${errorText(e)}`, true); failed = true; });
    }, 1200);
    let un: (() => void) | undefined;
    try {
      void getCurrentWindow().onCloseRequested(async () => { await saveNow().catch(() => undefined); }).then((f) => { un = f; });
    } catch { /* not running inside the app window */ }
    return () => { clearInterval(t); un?.(); };
  }, [notify]);

  const rename = async () => {
    const name = window.prompt("Project name", project.info.name);
    if (!name?.trim()) return;
    try { const info = await api.projectRename(name); props.onProject({ ...project, info }); } catch (e) { notify(errorText(e), true); }
  };
  const switchProject = async () => {
    await saveNow().catch(() => undefined);
    void api.projectClose();
    props.onProject(null);
  };

  const nav: NavItem<Page>[] = [
    { key: "studio", label: "Studio" },
    { key: "library", label: "Library", badge: assets.length ? assets.length.toLocaleString() : undefined },
    { key: "export", label: "Export" },
    { key: "activity", label: "Activity" },
  ];
  const header = (
    <div className="project-switch">
      <span className="label">Project</span>
      <button title="Rename project" onClick={() => void rename()}>{project.info.name}</button>
      <Button variant="ghost" style={{ marginTop: 4, padding: "4px 0", justifyContent: "flex-start" }} onClick={() => void switchProject()}>Switch project</Button>
    </div>
  );

  return (
    <AppShell brand={{ name: "Pixel Forge", logo }} nav={nav} current={page} onNavigate={setPage} header={header}>
      {!loaded ? <p className="muted">Opening project…</p> : (
        <ErrorBoundary resetKey={page}>
          {page === "studio" && <StudioPage notify={notify} onNavigate={setPage} />}
          {page === "library" && <LibraryPage notify={notify} onOpen={() => setPage("studio")} />}
          {page === "export" && <ExportPage notify={notify} projectName={project.info.name} />}
          {page === "activity" && <ActivityPage notify={notify} />}
        </ErrorBoundary>
      )}
    </AppShell>
  );
}
