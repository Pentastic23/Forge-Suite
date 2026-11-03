import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type Asset } from "../api";
import type { Handoff, Notify, Page } from "../App";
import { AssetViewer } from "../components/AssetViewer";
import { Field, Seg, Select } from "../components/controls";
import { Thumb } from "../components/Thumb";
import { dismissJob, isActive, startJob, useJobs, watchJobs, type Job } from "../jobs";
import { chatProblem, chatRequest, current, setPrefs, useAI } from "../prefs";
import { firstPrompt, improveRequest } from "../prompts";

const POLYCOUNTS: [number, string][] = [[1500, "1,500 (tiny props)"], [5000, "5,000 (low-poly)"], [10000, "10,000"], [30000, "30,000 (hero assets)"], [100000, "100,000 (detailed)"]];

/** 3D models from a prompt or a picture, through Meshy with the person's own key. */
export function ModelsPage(props: { notify: Notify; handoff?: Handoff; onMade: () => void; onNavigate: (p: Page) => void }) {
  const { notify } = props;
  const ai = useAI();
  const p = ai.prefs;
  const jobs = useJobs();
  const [from, setFrom] = useState<"text" | "image">("text");
  const [text, setText] = useState(props.handoff?.prompt ?? "");
  const [name, setName] = useState("");
  const [picture, setPicture] = useState<{ b64: string; label: string; assetId?: number } | null>(null);
  const [images, setImages] = useState<Asset[]>([]);
  const [models, setModels] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [improving, setImproving] = useState(false);
  const [open, setOpen] = useState<Asset | null>(null);

  const reload = () => api.assets().then((all) => {
    setImages(all.filter((a) => a.kind === "image").slice(0, 12));
    setModels(all.filter((a) => a.kind === "model"));
    return all;
  }).catch((e) => { notify(errorText(e), true); return [] as Asset[]; });
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.handoff) { setText(props.handoff.prompt); setFrom("text"); } }, [props.handoff]);
  useEffect(() => {
    watchJobs(
      (j) => { notify(`3D model ready: ${j.name || "model"}`); props.onMade(); void reload().then((all) => { const a = all.find((x) => x.id === j.assetId); if (a) setOpen(a); }); },
      (msg) => notify(msg, true),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = ai.keys && !ai.keys.meshy ? "Add your Meshy API key in Settings to make 3D models." : "";
  const start = async (kind: "text" | "refine" | "image", extra: { previewId?: string; prompt?: string; name?: string } = {}) => {
    setBusy(true);
    try {
      const s = current().prefs;
      const prompt = extra.prompt ?? text;
      await startJob({
        kind, prompt, previewId: extra.previewId ?? "", image: kind === "image" ? picture?.b64 ?? "" : "",
        artStyle: s.meshArtStyle, topology: s.meshTopology, polycount: s.meshPolycount, pbr: s.meshPbr,
      }, extra.name ?? (name.trim() || (kind === "image" ? picture?.label ?? "" : "")));
      notify(kind === "refine" ? "Adding textures. This takes a few minutes" : "Meshy started. A model takes a few minutes; you can leave this page");
    } catch (e) { notify(errorText(e), true); }
    setBusy(false);
  };
  const pickFile = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Picture", extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof path !== "string") return;
    try { setPicture({ b64: await api.readImage(path), label: path.split(/[\\/]/).pop()!.replace(/\.\w+$/, "") }); } catch (e) { notify(errorText(e), true); }
  };
  const pickAsset = async (a: Asset) => {
    try { const f = await api.assetData(a.id); setPicture({ b64: f.data, label: a.name, assetId: a.id }); } catch (e) { notify(errorText(e), true); }
  };
  const improve = async () => {
    if (chatProblem()) { notify(chatProblem(), true); return; }
    setImproving(true);
    try { setText(firstPrompt(await api.askOnce(improveRequest("model", text, current().brief), chatRequest("")))); }
    catch (e) { notify(errorText(e), true); }
    setImproving(false);
  };
  const openJob = (j: Job) => { const a = models.find((m) => m.id === j.assetId); if (a) setOpen(a); };

  return (
    <div className="stack">
      <PageHeader title="3D models" subtitle="Describe a prop, creature or character, or start from a picture, and Meshy makes a textured model you can drop into your engine." />
      <div className="two-col">
        <Card>
          <Seg label="Start from" value={from} options={[["text", "A description"], ["image", "A picture"]]} onChange={setFrom} />
          {from === "text" ? (
            <>
              <Field label="Describe the model">
                <textarea className="forge-input full" rows={4} value={text} placeholder="A low-poly wooden treasure chest with iron bands and a gold lock" onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="row-wrap">
                <Button disabled={!text.trim() || improving} onClick={() => void improve()}>{improving ? "Improving…" : "Improve prompt"}</Button>
              </div>
              <Field label="Style"><Seg label="Style" value={p.meshArtStyle} options={[["realistic", "Realistic"], ["sculpture", "Sculpture"]]} onChange={(v) => void setPrefs({ meshArtStyle: v })} /></Field>
            </>
          ) : (
            <>
              <div className="lbl">Picture</div>
              <div className="row-wrap">
                {picture ? <span className="pill">{picture.label}</span> : <span className="muted small">None chosen. One object on a plain background works best.</span>}
                <Button onClick={() => void pickFile()}>Choose file…</Button>
              </div>
              {images.length > 0 && (<>
                <div className="lbl">Or one of your images</div>
                <div className="thumb-grid small">
                  {images.map((a) => (
                    <button key={a.id} className={`thumb-btn ${picture?.assetId === a.id ? "on" : ""}`} title={a.name} onClick={() => void pickAsset(a)}><Thumb asset={a} size={72} /></button>
                  ))}
                </div>
              </>)}
            </>
          )}
          <div className="grid-2">
            <Field label="Faces"><Select value={p.meshPolycount} options={POLYCOUNTS} onChange={(v) => void setPrefs({ meshPolycount: v })} /></Field>
            <Field label="Mesh"><Seg label="Mesh" value={p.meshTopology} options={[["triangle", "Triangles"], ["quad", "Quads"]]} onChange={(v) => void setPrefs({ meshTopology: v })} /></Field>
            <Field label="Name (optional)"><input className="forge-input" value={name} placeholder="From the prompt" onChange={(e) => setName(e.target.value)} /></Field>
            <label className="check"><input type="checkbox" checked={p.meshPbr} onChange={(e) => void setPrefs({ meshPbr: e.target.checked })} /> PBR textures (metal, roughness, normal)</label>
          </div>
          {problem && <div className="notice"><span>{problem}</span><Button onClick={() => props.onNavigate("settings")}>Open Settings</Button></div>}
          <div className="row-wrap">
            <Button variant="primary" disabled={busy || !!problem || (from === "text" ? !text.trim() : !picture)} onClick={() => void start(from)}>
              {from === "text" ? "Make preview mesh" : "Make textured model"}
            </Button>
          </div>
          <p className="hint">
            {from === "text"
              ? "Text to 3D is two steps: a quick untextured preview mesh, then \"Add textures\" when you like its shape. Each step uses Meshy credits."
              : "The picture is sent to Meshy, which makes a textured model from it. This uses Meshy credits."}
            {" "}The model downloads into the library as GLB.
          </p>
        </Card>

        <div className="stack">
          <Card>
            <h3 className="card-title">In progress and recent</h3>
            {jobs.length === 0 ? <p className="muted">Nothing yet.</p> : (
              <ul className="list-plain jobs">
                {jobs.map((j) => (
                  <li key={j.taskId}>
                    <div className="job-what">
                      <b>{j.name || j.prompt.slice(0, 60) || "Model"}</b>
                      <span className="muted small"> {j.kind === "refine" ? "textures" : j.kind === "image" ? "from a picture" : "preview mesh"}</span>
                      {isActive(j) && <div className="progress"><div style={{ width: `${Math.max(3, j.progress)}%` }} /></div>}
                      {j.error && <div className="bad small">{j.error}</div>}
                    </div>
                    <div className="row-wrap nowrap">
                      {isActive(j) && <span className="muted small">{j.progress}%</span>}
                      {j.assetId !== null && <Button onClick={() => openJob(j)}>View</Button>}
                      {j.kind === "text" && j.assetId !== null && (
                        <Button disabled={busy || !!problem} onClick={() => void start("refine", { previewId: j.taskId, prompt: j.prompt, name: `${j.name || j.prompt.slice(0, 40)} (textured)` })}>Add textures</Button>
                      )}
                      {!isActive(j) && <button className="icon-btn" title="Remove from this list" onClick={() => dismissJob(j.taskId)}>×</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="card-title">Your models</h3>
            {models.length === 0 ? <p className="muted">Models you make appear here and in the Library.</p> : (
              <div className="thumb-grid">
                {models.map((a) => (
                  <button key={a.id} className="thumb-btn" title={a.prompt || a.name} onClick={() => setOpen(a)}>
                    <Thumb asset={a} size={112} />
                    <span className="thumb-name">{a.name}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      {open && <AssetViewer asset={open} notify={notify} onClose={() => setOpen(null)} onChanged={() => { void reload(); props.onMade(); }} onUsePrompt={(t) => { setText(t); setFrom("text"); setOpen(null); }} />}
    </div>
  );
}
