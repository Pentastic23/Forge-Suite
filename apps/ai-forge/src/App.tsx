import { useCallback, useEffect, useState } from "react";
import { AppShell, Button, Card, type NavItem } from "@forge/ui";
import logo from "../../../brand/ai-forge-logo-256.png";
import { api, errorText, type CurrentProject } from "./api";
import { LaunchBlocked, ProjectPicker } from "./components/ProjectPicker";
import { loadAI } from "./prefs";
import { loadJobs, resetJobs } from "./jobs";
import { AssistantPage } from "./pages/AssistantPage";
import { ImagesPage } from "./pages/ImagesPage";
import { ModelsPage } from "./pages/ModelsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ActivityPage } from "./pages/ActivityPage";

export type Notify = (msg: string, bad?: boolean) => void;
export type Page = "assistant" | "images" | "models" | "library" | "settings" | "activity";
/** A prompt passed from a chat answer to the Images or 3D page. */
export interface Handoff { prompt: string; n: number }

export function App() {
  const [launchError, setLaunchError] = useState<string | null>();
  const [project, setProject] = useState<CurrentProject | null>();
  const [toast, setToast] = useState<{ msg: string; bad?: boolean; n: number }>();
  const notify = useCallback<Notify>((msg, bad) => setToast((t) => ({ msg, bad, n: (t?.n ?? 0) + 1 })), []);

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
  const [page, setPage] = useState<Page>("assistant");
  const [loaded, setLoaded] = useState(false);
  const [imageHandoff, setImageHandoff] = useState<Handoff>();
  const [modelHandoff, setModelHandoff] = useState<Handoff>();
  const [libraryVersion, setLibraryVersion] = useState(0);

  useEffect(() => {
    resetJobs();
    loadAI().then(() => setLoaded(true)).catch((e) => { notify(errorText(e), true); setLoaded(true); });
    void loadJobs(project.path);
  }, [notify, project.path]);

  const rename = async () => {
    const name = window.prompt("Project name", project.info.name);
    if (!name?.trim()) return;
    try { const info = await api.projectRename(name); props.onProject({ ...project, info }); } catch (e) { notify(errorText(e), true); }
  };
  const switchProject = () => {
    void api.projectClose();
    props.onProject(null);
  };
  const usePrompt = (prompt: string, target: "image" | "model") => {
    if (target === "image") { setImageHandoff((h) => ({ prompt, n: (h?.n ?? 0) + 1 })); setPage("images"); }
    else { setModelHandoff((h) => ({ prompt, n: (h?.n ?? 0) + 1 })); setPage("models"); }
  };
  const madeSomething = () => setLibraryVersion((v) => v + 1);

  const nav: NavItem<Page>[] = [
    { key: "assistant", label: "Assistant" },
    { key: "images", label: "Images" },
    { key: "models", label: "3D models" },
    { key: "library", label: "Library" },
  ];
  const footer: NavItem<Page>[] = [
    { key: "settings", label: "Settings" },
    { key: "activity", label: "Activity" },
  ];
  const header = (
    <div className="project-switch">
      <span className="label">Project</span>
      <button title="Rename project" onClick={() => void rename()}>{project.info.name}</button>
      <Button variant="ghost" style={{ marginTop: 4, padding: "4px 0", justifyContent: "flex-start" }} onClick={switchProject}>Switch project</Button>
    </div>
  );

  return (
    <AppShell brand={{ name: "AI Forge", logo }} nav={nav} footerNav={footer} current={page} onNavigate={setPage} header={header}>
      {!loaded ? <p className="muted">Opening project…</p> : (
        <>
          {/* The assistant stays mounted so an answer keeps arriving while another page is open. */}
          <div className="assistant-host" hidden={page !== "assistant"}>
            <AssistantPage notify={notify} projectName={project.info.name} onUsePrompt={usePrompt} onNavigate={setPage} />
          </div>
          {page === "images" && <ImagesPage notify={notify} handoff={imageHandoff} onMade={madeSomething} onNavigate={setPage} />}
          {page === "models" && <ModelsPage notify={notify} handoff={modelHandoff} onMade={madeSomething} onNavigate={setPage} />}
          {page === "library" && <LibraryPage key={libraryVersion} notify={notify} onUsePrompt={usePrompt} />}
          {page === "settings" && <SettingsPage notify={notify} />}
          {page === "activity" && <ActivityPage notify={notify} />}
        </>
      )}
    </AppShell>
  );
}
