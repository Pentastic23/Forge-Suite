import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type Settings as SettingsT } from "../api";

export function Settings(props: { onSaved: () => void; notify: (msg: string, bad?: boolean) => void }) {
  const [s, setS] = useState<SettingsT>();
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [newFolder, setNewFolder] = useState("");

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => props.notify(errorText(e), true));
    api.hubPaths().then(setPaths).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <PageHeader title="Settings" subtitle="Loading…" />;

  const save = async (next: SettingsT) => {
    setS(next);
    try {
      await api.saveSettings(next);
      props.onSaved();
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
          <div className="hint">Forge Hub looks in each of these for app subfolders that contain a forge-app.json file.</div>
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
