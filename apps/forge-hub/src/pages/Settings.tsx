import { useEffect, useState } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type ProjectsFolder, type SearchFolder, type Settings as SettingsT } from "../api";

/** Where every Forge app keeps its project files. */
function ProjectsFolderCard(props: { notify: (msg: string, bad?: boolean) => void }) {
  const [pf, setPf] = useState<ProjectsFolder>();
  useEffect(() => { api.projectsFolder().then(setPf).catch((e) => props.notify(errorText(e), true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = async (path: string | null) => {
    try {
      const next = await api.setProjectsFolder(path);
      setPf(next);
      props.notify(path ? "Projects folder changed. Apps use it the next time they open." : "Projects folder set back to the default.");
    } catch (e) { props.notify(errorText(e), true); }
  };
  const choose = async () => {
    const path = await pickFolder({ directory: true, multiple: false, title: "Choose where Forge apps keep projects", defaultPath: pf?.path });
    if (typeof path === "string") void set(path);
  };
  if (!pf) return null;
  return (
    <Card>
      <div className="settings-row" style={{ display: "block", borderBottom: 0 }}>
        <div>Projects folder</div>
        <div className="hint">Every Forge app creates and list their project files here. Pick a folder that isn't synced by OneDrive, since syncing can lock a project while it's open.</div>
        <div className="folder-list">
          <div className="row">
            <code title={pf.path}>{pf.path}</code>
            <Button onClick={() => void api.openFolder(pf.path).catch((e) => props.notify(errorText(e), true))}>Open</Button>
            <Button disabled={pf.source === "env"} onClick={() => void choose()}>Change…</Button>
            {pf.source === "setting" && <Button variant="ghost" onClick={() => void set(null)}>Use default</Button>}
          </div>
        </div>
        {pf.source === "env" && <div className="hint" style={{ marginTop: 8 }}>Set by the FORGE_PROJECTS_DIR environment variable, which overrides this setting.</div>}
        {pf.source === "default" && <div className="hint" style={{ marginTop: 8 }}>This is the default, inside your Documents folder.</div>}
        {pf.inOnedrive && <div className="hint warn-text" style={{ marginTop: 8 }}><span aria-hidden="true">! </span>This folder is inside OneDrive.</div>}
        {pf.leftInDefault > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            {pf.leftInDefault} project {pf.leftInDefault === 1 ? "file is" : "files are"} still in the old folder ({pf.defaultPath}). Move {pf.leftInDefault === 1 ? "it" : "them"} here with the apps closed to keep working on {pf.leftInDefault === 1 ? "it" : "them"}.
          </div>
        )}
      </div>
    </Card>
  );
}

export function Settings(props: { onSaved: () => void; notify: (msg: string, bad?: boolean) => void }) {
  const [s, setS] = useState<SettingsT>();
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [newFolder, setNewFolder] = useState("");
  const [autoFolders, setAutoFolders] = useState<string[]>([]);
  const loadAuto = () => api.appSearchFolders().then((f: SearchFolder[]) => setAutoFolders(f.filter((x) => x.source === "auto").map((x) => x.path))).catch(() => undefined);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => props.notify(errorText(e), true));
    api.hubPaths().then(setPaths).catch(() => undefined);
    void loadAuto();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <PageHeader title="Settings" subtitle="Loading…" />;

  const save = async (next: SettingsT) => {
    setS(next);
    try {
      await api.saveSettings(next);
      props.onSaved();
      void loadAuto();
    } catch (e) {
      props.notify(errorText(e), true);
    }
  };
  const addFolder = () => {
    const f = newFolder.trim();
    if (!f || s.appFolders.includes(f)) return;
    setNewFolder("");
    void save({ ...s, appFolders: [...s.appFolders, f] });
  };
  const open = (p: string) => api.openFolder(p).catch((e) => props.notify(errorText(e), true));

  return (
    <>
      <PageHeader title="Settings" subtitle="Changes save straight away." />
      <Card>
        <div className="settings-row" style={{ display: "block" }}>
          <div>App folders</div>
          <div className="hint">Forge Hub always finds apps in the usual install places listed below. Add a folder here only if you keep apps somewhere else. Each app needs its own subfolder with a forge-app.json file.</div>
          <div className="folder-list">
            {s.appFolders.map((f) => (
              <div className="row" key={f}>
                <code title={f}>{f}</code>
                <Button onClick={() => open(f)}>Open</Button>
                <Button variant="ghost" onClick={() => void save({ ...s, appFolders: s.appFolders.filter((x) => x !== f) })}>Remove</Button>
              </div>
            ))}
            <div className="row">
              <input className="forge-input" style={{ flex: 1 }} placeholder="Paste a folder path" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addFolder()} />
              <Button onClick={addFolder} disabled={!newFolder.trim()}>Add folder</Button>
            </div>
          </div>
          {autoFolders.length > 0 && (
            <>
              <div className="hint" style={{ marginTop: 12 }}>Always searched</div>
              <div className="folder-list">
                {autoFolders.map((f) => (
                  <div className="row" key={f}>
                    <code title={f}>{f}</code>
                    <Button onClick={() => open(f)}>Open</Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <label className="settings-row">
          <div><div>Minimise Forge Hub after launching an app</div></div>
          <input type="checkbox" checked={s.closeOnLaunch} onChange={(e) => void save({ ...s, closeOnLaunch: e.target.checked })} />
        </label>
        <label className="settings-row">
          <div><div>Check for updates when opening the Updates page</div></div>
          <input type="checkbox" checked={s.checkUpdatesOnStart} onChange={(e) => void save({ ...s, checkUpdatesOnStart: e.target.checked })} />
        </label>
        <label className="settings-row" style={{ borderBottom: 0 }}>
          <div><div>Keep logs for</div><div className="hint">Older entries are removed when Forge Hub starts.</div></div>
          <select className="forge-input" value={s.logRetentionDays} onChange={(e) => void save({ ...s, logRetentionDays: Number(e.target.value) })}>
            {[7, 14, 30, 90, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </Card>

      <div className="hub-section">Projects</div>
      <ProjectsFolderCard notify={props.notify} />

      <div className="hub-section">Forge Hub data</div>
      <Card>
        <div className="folder-list" style={{ marginTop: 0 }}>
          {paths.data && <div className="row"><code title={paths.data}>{paths.data}</code><Button onClick={() => open(paths.data)}>Open</Button></div>}
        </div>
        <p className="forge-page-sub" style={{ margin: "10px 0 0" }}>Settings, logs and your recently used list live here.</p>
      </Card>
    </>
  );
}
