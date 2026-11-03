import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button, Card } from "@forge/ui";
import { api, dataUrl, errorText, fileSize, when, type Asset, type FileData } from "../api";
import type { Notify } from "../App";
import { ModelViewer } from "./ModelViewer";
import { forgetThumb } from "./Thumb";

/** A library item at full size, with its prompt and what can be done with it. */
export function AssetViewer(props: {
  asset: Asset;
  notify: Notify;
  onClose: () => void;
  onChanged: () => void;
  onUsePrompt?: (prompt: string, target: "image" | "model") => void;
}) {
  const { asset: a, notify } = props;
  const [file, setFile] = useState<FileData>();
  useEffect(() => {
    let live = true;
    api.assetData(a.id).then((f) => live && setFile(f)).catch((e) => notify(errorText(e), true));
    return () => { live = false; };
  }, [a.id, notify]);

  const ext = a.kind === "model" ? "glb" : a.mime === "image/jpeg" ? "jpg" : a.mime === "image/webp" ? "webp" : "png";
  const exportIt = async () => {
    const path = await save({ defaultPath: `${a.name.replace(/[\\/:*?"<>|]/g, " ").trim() || "asset"}.${ext}`, filters: [{ name: a.kind === "model" ? "glTF binary" : "Image", extensions: [ext] }] });
    if (!path) return;
    try { await api.exportAsset(a.id, path); notify(`Saved ${path}`); } catch (e) { notify(errorText(e), true); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove "${a.name}" from the library? This can't be undone.`)) return;
    try { await api.assetDelete(a.id); forgetThumb(a.id); props.onChanged(); props.onClose(); } catch (e) { notify(errorText(e), true); }
  };
  const rename = async () => {
    const name = window.prompt("Name", a.name);
    if (!name?.trim()) return;
    try { await api.assetsUpdate([a.id], { name }); props.onChanged(); } catch (e) { notify(errorText(e), true); }
  };
  const keepPreview = async (png: string) => {
    try { await api.assetSetThumb(a.id, png); forgetThumb(a.id); props.onChanged(); notify("Preview kept for the library"); } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="overlay" role="dialog" aria-label={a.name} onClick={props.onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="viewer-body">
            <div className="viewer-stage checker">
              {!file ? <p className="muted">Loading…</p> : a.kind === "model" ? <ModelViewer glb={file.data} onSnapshot={keepPreview} /> : <img src={dataUrl(file)} alt={a.name} />}
            </div>
            <div className="viewer-side">
              <h2 className="card-title">{a.name}</h2>
              <p className="muted small">{a.source} · {fileSize(a.size)} · {when(a.createdAt)}</p>
              {a.prompt && (<><div className="lbl">Prompt</div><p className="prompt-text">{a.prompt}</p></>)}
              <div className="row-wrap">
                <Button variant="primary" onClick={() => void exportIt()}>Save {ext.toUpperCase()}…</Button>
                <Button onClick={() => void rename()}>Rename</Button>
                <Button onClick={() => void api.assetsUpdate([a.id], { favorite: !a.favorite }).then(props.onChanged)}>{a.favorite ? "Unfavourite" : "Favourite"}</Button>
              </div>
              {a.prompt && props.onUsePrompt && (
                <div className="row-wrap">
                  <Button onClick={() => props.onUsePrompt!(a.prompt, "image")}>Make another image</Button>
                  <Button onClick={() => props.onUsePrompt!(a.prompt, "model")}>Make a 3D model</Button>
                </div>
              )}
              <div className="row-wrap">
                <Button variant="ghost" onClick={() => void remove()}>Remove</Button>
                <span className="spacer" />
                <Button onClick={props.onClose}>Close</Button>
              </div>
              {a.kind === "image" && <p className="hint">To turn this into pixel art, save the PNG and add it as a sketch in Pixel Forge.</p>}
              {a.kind === "model" && <p className="hint">GLB opens in Blender, Godot, Unity (with glTFast) and Unreal. Drag to turn it, scroll to zoom.</p>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
