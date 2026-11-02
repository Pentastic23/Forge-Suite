import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "@forge/ui";
import logo from "../../../../brand/balance-forge-logo-256.png";
import { api, errorText, when, type CurrentProject, type ProjectFile } from "../api";

export function ProjectPicker(props: { onOpened: (p: CurrentProject) => void; notify: (msg: string, bad?: boolean) => void }) {
  const [projects, setProjects] = useState<ProjectFile[]>();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.projectsList().then(setProjects).catch(() => setProjects([]));
    api.projectsFolder().then(setFolder).catch(() => undefined);
  }, []);

  const create = async () => {
    try { props.onOpened(await api.projectCreate(name)); } catch (e) { props.notify(errorText(e), true); }
  };
  const openPath = async (path: string) => {
    try { props.onOpened(await api.projectOpen(path)); } catch (e) { props.notify(errorText(e), true); }
  };
  const example = async () => {
    setBusy(true);
    try { props.onOpened(await api.projectExample()); } catch (e) { props.notify(errorText(e), true); }
    setBusy(false);
  };
  const browse = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Balance Forge project", extensions: ["balanceforge"] }] });
    if (typeof path === "string") void openPath(path);
  };

  return (
    <div className="center-screen">
      <div className="panel">
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 24 }}>
          <img className="picker-logo" src={logo} alt="" />
          <div>
            <h1 className="forge-page-title">Balance Forge</h1>
            <p className="forge-page-sub" style={{ margin: 0 }}>Balance your game with stat sheets, charts and simulations.</p>
          </div>
        </div>
        <Card>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>New project</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="forge-input" style={{ flex: 1 }} placeholder="Game name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void create()} />
            <Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>Create</Button>
          </div>
          {folder && <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Saved in {folder}</p>}
        </Card>
        <div style={{ height: 16 }} />
        <Card>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Example project</div>
              <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>Emberfall's mobs, items and weapons as stat sheets with formulas, a patch to compare, and an economy ready to simulate.</p>
            </div>
            <div style={{ flexShrink: 0 }}><Button disabled={busy} onClick={() => void example()}>{busy ? "Opening…" : "Open example"}</Button></div>
          </div>
        </Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "24px 0 8px" }}>
          <div style={{ fontWeight: 600 }}>Open a project</div>
          <Button onClick={() => void browse()}>Browse…</Button>
        </div>
        <Card>
          {projects === undefined ? <p className="muted">Loading…</p> : projects.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No projects yet. Create one above, or open the example.</p>
          ) : (
            <ul className="list-plain">
              {projects.map((p) => (
                <li key={p.path}>
                  <button className="result" onClick={() => void openPath(p.path)}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div className="sum">{p.path}</div>
                  </button>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{when(p.modified)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export function LaunchBlocked(props: { message: string }) {
  return (
    <div className="center-screen">
      <div className="panel" style={{ textAlign: "center" }}>
        <img className="picker-logo" src={logo} alt="" />
        <h1 className="forge-page-title" style={{ marginTop: 12 }}>Open Balance Forge from Forge Hub</h1>
        <p className="forge-page-sub">{props.message}</p>
        <Button onClick={() => window.close()}>Close</Button>
      </div>
    </div>
  );
}
