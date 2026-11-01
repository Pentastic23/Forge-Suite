import { open } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card } from "@forge/ui";
import { api, errorText, when, type Folder } from "../api";
import type { Notify } from "../App";

/** The asset folders the library watches. Files stay where they are. */
export function FoldersDialog(props: { folders: Folder[]; onClose: () => void; onChanged: (added: boolean) => void; notify: Notify }) {
  const add = async () => {
    const path = await open({ directory: true, multiple: false, title: "Choose an asset folder" });
    if (typeof path !== "string") return;
    try {
      await api.addFolder(path);
      props.onChanged(true);
    } catch (e) { props.notify(errorText(e), true); }
  };
  const remove = async (f: Folder) => {
    if (!window.confirm(`Stop watching ${f.path}? Tags, notes and statuses for its ${f.assets} files are removed from the library. The files themselves stay where they are.`)) return;
    try {
      await api.removeFolder(f.id);
      props.onChanged(false);
    } catch (e) { props.notify(errorText(e), true); }
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal wide" role="dialog" aria-label="Asset folders">
        <Card>
          <h3>Asset folders</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Point Asset Forge at the folders that hold your game's art, audio and models, for example your engine project's Assets folder.
            Files are never copied, moved or uploaded. The library reads them where they are.
          </p>
          {props.folders.length === 0 ? (
            <div className="empty-folders"><Button variant="primary" onClick={() => void add()}>Add your first folder</Button></div>
          ) : (
            <ul className="list-plain">
              {props.folders.map((f) => (
                <li key={f.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="ellipsis mono small" title={f.path}>{f.path}</div>
                    <div className="muted small">
                      {f.assets.toLocaleString()} files{f.lastScan ? ` · scanned ${when(f.lastScan)}` : ""}
                      {!f.exists && <> · <Badge tone="bad">Folder not found</Badge></>}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => void remove(f)}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            {props.folders.length > 0 ? <Button onClick={() => void add()}>Add folder</Button> : <span />}
            <Button variant={props.folders.length ? "primary" : "ghost"} onClick={props.onClose}>Done</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
