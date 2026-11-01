import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { AppShell, Button, Card, EmptyState, PageHeader, type NavItem } from "@forge/ui";
import logo from "../../../brand/balance-forge-logo-256.png";
import { api, blankSheet, errorText, type Computed, type CurrentProject, type Sheet, type SheetInfo } from "./api";
import { LaunchBlocked, ProjectPicker } from "./components/ProjectPicker";
import { ImportDialog } from "./components/ImportDialog";
import { SheetEditor } from "./components/SheetEditor";
import { AnalysisPage } from "./pages/AnalysisPage";
import { CombatPage } from "./pages/CombatPage";
import { EconomyPage } from "./pages/EconomyPage";
import { PatchesPage } from "./pages/PatchesPage";

export type Notify = (msg: string, bad?: boolean) => void;
type Page = "sheet" | "analysis" | "combat" | "economy" | "patches";

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

/** The open sheet, saved a moment after each change and recomputed as you type. */
function useOpenSheet(notify: Notify, onSaved: () => void) {
  const [sheet, setSheetState] = useState<Sheet>();
  const [computed, setComputed] = useState<Computed>();
  const [saving, setSaving] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const pending = useRef<Sheet>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cb = useRef({ notify, onSaved });
  cb.current = { notify, onSaved };

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const s = pending.current;
    if (!s) return;
    pending.current = undefined;
    setSaving("saving");
    try {
      await api.saveSheet(s);
      setSaving(pending.current ? "pending" : "saved");
      cb.current.onSaved();
    } catch (e) {
      setSaving("error");
      cb.current.notify(errorText(e), true);
    }
  }, []);

  const setSheet = useCallback((s: Sheet) => {
    setSheetState(s);
    pending.current = s;
    setSaving("pending");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  }, [flush]);

  const load = useCallback(async (id: string | undefined) => {
    await flush();
    if (!id) { setSheetState(undefined); setComputed(undefined); return; }
    try { setSheetState(await api.sheet(id)); setSaving("saved"); } catch (e) { cb.current.notify(errorText(e), true); }
  }, [flush]);

  useEffect(() => {
    if (!sheet) return;
    const t = setTimeout(() => {
      api.compute(sheet).then(setComputed).catch(() => undefined);
    }, 120);
    return () => clearTimeout(t);
  }, [sheet]);

  useEffect(() => {
    const beforeUnload = () => void flush();
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); void flush(); };
  }, [flush]);

  return { sheet, computed, saving, setSheet, load, flush };
}

function readSheetId(projectId: string): string | undefined {
  try { return localStorage.getItem(`balance-forge.sheet.${projectId}`) ?? undefined; } catch { return undefined; }
}
function writeSheetId(projectId: string, id: string) {
  try { localStorage.setItem(`balance-forge.sheet.${projectId}`, id); } catch { /* ignore */ }
}

function Workspace(props: { project: CurrentProject; onProject: (p: CurrentProject | null) => void; notify: Notify }) {
  const { notify, project } = props;
  const [page, setPage] = useState<Page>("sheet");
  const [sheets, setSheets] = useState<SheetInfo[]>();
  const [sheetId, setSheetId] = useState<string>();
  const [importing, setImporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const refreshSheets = useCallback(() => {
    api.sheets().then(setSheets).catch((e) => notify(errorText(e), true));
  }, [notify]);
  const open = useOpenSheet(notify, refreshSheets);
  const { load } = open;

  useEffect(refreshSheets, [refreshSheets]);
  // Pick the last used sheet once the list arrives, or the first one.
  useEffect(() => {
    if (!sheets) return;
    if (sheetId && sheets.some((s) => s.id === sheetId)) return;
    const remembered = readSheetId(project.info.id);
    setSheetId(sheets.find((s) => s.id === remembered)?.id ?? sheets[0]?.id);
  }, [sheets, sheetId, project.info.id]);
  useEffect(() => {
    void load(sheetId);
    if (sheetId) writeSheetId(project.info.id, sheetId);
  }, [sheetId, load, project.info.id]);

  const newSheet = async () => {
    const name = window.prompt("Sheet name", "Units");
    if (!name?.trim()) return;
    try {
      const s = await api.saveSheet(blankSheet(name.trim()));
      refreshSheets();
      setSheetId(s.id);
      setPage("sheet");
    } catch (e) { notify(errorText(e), true); }
  };

  const renameSheet = () => {
    if (!open.sheet) return;
    const name = window.prompt("Sheet name", open.sheet.name);
    if (name?.trim()) open.setSheet({ ...open.sheet, name: name.trim() });
  };

  const deleteSheet = async () => {
    if (!open.sheet || !window.confirm(`Delete the sheet "${open.sheet.name}" and its snapshots? This can't be undone.`)) return;
    try {
      await open.flush();
      await api.deleteSheet(open.sheet.id);
      setSheetId(undefined);
      refreshSheets();
      notify("Sheet deleted");
    } catch (e) { notify(errorText(e), true); }
  };

  const exportTo = async (kind: "balance" | "csv") => {
    setExportOpen(false);
    await open.flush();
    const base = kind === "csv" ? open.sheet?.name ?? "Sheet" : project.info.name;
    const path = await save({
      defaultPath: `${base}.${kind === "csv" ? "csv" : "forgebalance"}`,
      filters: kind === "csv" ? [{ name: "CSV", extensions: ["csv"] }] : [{ name: "Balance Forge data", extensions: ["forgebalance"] }],
    });
    if (!path) return;
    try {
      const n = kind === "csv" ? await api.exportCsv(open.sheet!.id, path) : await api.exportBalance(path);
      notify(kind === "csv" ? `Saved ${n} rows to CSV` : `Exported ${n} rows for the other Forge apps`);
    } catch (e) { notify(errorText(e), true); }
  };

  const rename = async () => {
    const name = window.prompt("Project name", project.info.name);
    if (!name?.trim()) return;
    try { const info = await api.projectRename(name); props.onProject({ ...project, info }); } catch (e) { notify(errorText(e), true); }
  };

  const nav: NavItem<Page>[] = [
    { key: "sheet", label: "Stat sheet", badge: open.sheet?.rows.length },
    { key: "analysis", label: "Analysis" },
    { key: "combat", label: "Combat sim" },
    { key: "economy", label: "Economy sim" },
    { key: "patches", label: "Patches" },
  ];

  const header = (
    <div className="project-switch">
      <span className="label">Project</span>
      <button title="Rename project" onClick={() => void rename()}>{project.info.name}</button>
      <span className="label" style={{ marginTop: 10 }}>Sheet</span>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="forge-input" style={{ flex: 1, padding: "6px 8px" }} aria-label="Sheet" value={sheetId ?? ""}
          onChange={(e) => setSheetId(e.target.value || undefined)} disabled={!sheets?.length}>
          {!sheets?.length && <option value="">No sheets yet</option>}
          {sheets?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Button style={{ padding: "6px 10px" }} title="New sheet" aria-label="New sheet" onClick={() => void newSheet()}>+</Button>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, position: "relative" }}>
        <Button style={{ flex: 1, padding: "6px 8px" }} onClick={() => setImporting(true)}>Import</Button>
        <Button style={{ flex: 1, padding: "6px 8px" }} onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen}>Export</Button>
        {exportOpen && (
          <div className="picker-menu" role="menu" style={{ top: "calc(100% + 4px)" }}>
            <button role="menuitem" onClick={() => void exportTo("balance")}><span>All sheets for Forge apps</span><span className="muted">.forgebalance</span></button>
            <button role="menuitem" disabled={!open.sheet} onClick={() => void exportTo("csv")}><span>This sheet as a spreadsheet</span><span className="muted">.csv</span></button>
          </div>
        )}
      </div>
      <Button variant="ghost" style={{ marginTop: 4, padding: "4px 0", justifyContent: "flex-start" }}
        onClick={() => { void open.flush().then(() => api.projectClose()); props.onProject(null); }}>Switch project</Button>
    </div>
  );

  let body;
  if (sheets === undefined) body = null;
  else if (!open.sheet) {
    body = (
      <>
        <PageHeader title="Get started" subtitle="A sheet holds the stats for one kind of thing: units, weapons, cards, levels." />
        <Card>
          <EmptyState title="No sheets yet">
            <p>Start from scratch, or bring in entries you already wrote in Forge Core.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button variant="primary" onClick={() => void newSheet()}>New sheet</Button>
              <Button onClick={() => setImporting(true)}>Import from Forge Core</Button>
            </div>
          </EmptyState>
        </Card>
      </>
    );
  } else {
    const common = { sheet: open.sheet, computed: open.computed, notify };
    body =
      page === "sheet" ? <SheetEditor {...common} saving={open.saving} onChange={open.setSheet} onRename={renameSheet} onDelete={() => void deleteSheet()} />
      : page === "analysis" ? <AnalysisPage {...common} />
      : page === "combat" ? <CombatPage {...common} />
      : page === "economy" ? <EconomyPage {...common} />
      : <PatchesPage {...common} flush={open.flush} />;
  }

  return (
    <AppShell brand={{ name: "Balance Forge", logo }} nav={nav} current={page} onNavigate={setPage} header={header}>
      {body}
      {importing && (
        <ImportDialog
          sheets={sheets ?? []}
          currentSheetId={sheetId}
          beforeImport={open.flush}
          onClose={() => setImporting(false)}
          onImported={async (s) => {
            setImporting(false);
            refreshSheets();
            if (s.id === sheetId) await load(s.id);
            else setSheetId(s.id);
            setPage("sheet");
          }}
          notify={notify}
        />
      )}
    </AppShell>
  );
}
