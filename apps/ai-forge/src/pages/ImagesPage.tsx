import { useEffect, useState } from "react";
import { Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, type Asset } from "../api";
import type { Handoff, Notify, Page } from "../App";
import { AssetViewer } from "../components/AssetViewer";
import { Field, Seg, Select } from "../components/controls";
import { Thumb } from "../components/Thumb";
import { chatProblem, chatRequest, COMFY_SIZES, current, IMAGE_QUALITIES, IMAGE_SIZES, setPrefs, useAI } from "../prefs";
import { ART_PRESETS, firstPrompt, imagePrompt, improveRequest } from "../prompts";

/** Art from a prompt: OpenAI with the person's key, or their own ComfyUI. */
export function ImagesPage(props: { notify: Notify; handoff?: Handoff; onMade: () => void; onNavigate: (p: Page) => void }) {
  const { notify } = props;
  const ai = useAI();
  const p = ai.prefs;
  const [text, setText] = useState(props.handoff?.prompt ?? "");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState("none");
  const [withStyle, setWithStyle] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);
  const [improving, setImproving] = useState(false);
  const [recent, setRecent] = useState<Asset[]>([]);
  const [open, setOpen] = useState<Asset | null>(null);

  const reload = () => api.assets().then((a) => setRecent(a.filter((x) => x.kind === "image").slice(0, 24))).catch((e) => notify(errorText(e), true));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.handoff) setText(props.handoff.prompt); }, [props.handoff]);
  useEffect(() => { setTransparent(ART_PRESETS.find((a) => a.key === preset)?.transparent ?? false); }, [preset]);

  const problem = p.imageBackend === "openai"
    ? (ai.keys && !ai.keys.openai ? "Add your OpenAI API key in Settings to make images with OpenAI." : "")
    : (!p.workflow && !p.checkpoint ? "Connect to ComfyUI in Settings and pick a checkpoint." : "");
  const finalPrompt = imagePrompt(text, preset, ai.brief, withStyle);

  const generate = async () => {
    setBusy({ done: 0, of: count });
    let made = 0;
    for (let i = 0; i < count; i++) {
      try {
        const s = current().prefs;
        if (s.imageBackend === "openai") {
          await api.imageOpenAI({ prompt: finalPrompt, size: s.imageSize, quality: s.imageQuality, model: s.imageModel, transparent }, name);
        } else {
          await api.imageComfy({
            url: s.comfyUrl, prompt: finalPrompt, negative: s.negative, checkpoint: s.checkpoint, width: s.comfySize, height: s.comfySize,
            steps: s.steps, cfg: 7, seed: Math.floor(Math.random() * 2 ** 48), workflow: s.workflow,
          }, name);
        }
        made++;
        setBusy({ done: made, of: count });
        await reload();
      } catch (e) {
        notify(errorText(e), true);
        break;
      }
    }
    setBusy(null);
    if (made) { props.onMade(); notify(made === 1 ? "Image ready. It's in the library" : `${made} images ready. They're in the library`); }
  };
  const stop = () => { if (p.imageBackend === "comfy") void api.comfyInterrupt(p.comfyUrl).catch(() => undefined); };
  const improve = async () => {
    if (chatProblem()) { notify(chatProblem(), true); return; }
    setImproving(true);
    try { setText(firstPrompt(await api.askOnce(improveRequest("image", text, current().brief), chatRequest("")))); }
    catch (e) { notify(errorText(e), true); }
    setImproving(false);
  };

  return (
    <div className="stack">
      <PageHeader title="Images" subtitle="Describe the art you need and AI Forge makes it: sprites, icons, tiles, concept art and backgrounds." />
      <div className="two-col">
        <Card>
          <Field label="Describe the image">
            <textarea className="forge-input full" rows={5} value={text} placeholder="A mossy treasure chest with glowing runes, slightly open" onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="row-wrap">
            <Button disabled={!text.trim() || improving} onClick={() => void improve()} title="The chat model rewrites your prompt with more detail">{improving ? "Improving…" : "Improve prompt"}</Button>
            <span className="muted small">uses the chat model from Settings</span>
          </div>
          <div className="grid-2">
            <Field label="Kind of image"><Select value={preset} options={ART_PRESETS.map((a) => [a.key, a.label])} onChange={setPreset} /></Field>
            <Field label="Name (optional)"><input className="forge-input" value={name} placeholder="From the prompt" onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={withStyle} onChange={(e) => setWithStyle(e.target.checked)} disabled={!ai.brief.artStyle.trim()} /> Use the game's art style{ai.brief.artStyle.trim() ? "" : " (set one in Settings, Project brief)"}</label>

          <div className="lbl">Made with</div>
          <Seg label="Made with" value={p.imageBackend} options={[["openai", "OpenAI (online)"], ["comfy", "ComfyUI (this PC)"]]} onChange={(v) => void setPrefs({ imageBackend: v })} />
          {p.imageBackend === "openai" ? (
            <div className="grid-2">
              <Field label="Size"><Select value={p.imageSize} options={IMAGE_SIZES} onChange={(v) => void setPrefs({ imageSize: v })} /></Field>
              <Field label="Quality"><Select value={p.imageQuality} options={IMAGE_QUALITIES} onChange={(v) => void setPrefs({ imageQuality: v })} /></Field>
              <label className="check"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent background</label>
            </div>
          ) : (
            <div className="grid-2">
              <Field label="Size"><Select value={p.comfySize} options={COMFY_SIZES} onChange={(v) => void setPrefs({ comfySize: v })} /></Field>
              <Field label="Model"><span className="muted small">{p.workflow ? `Your workflow: ${p.workflowName}` : p.checkpoint || "None yet"}</span></Field>
            </div>
          )}
          <div className="row-wrap">
            <Field label="How many"><Select value={count} options={[[1, "1"], [2, "2"], [3, "3"], [4, "4"]]} onChange={setCount} /></Field>
          </div>
          {problem && <div className="notice"><span>{problem}</span><Button onClick={() => props.onNavigate("settings")}>Open Settings</Button></div>}
          <div className="row-wrap">
            <Button variant="primary" disabled={!text.trim() || !!busy || !!problem} onClick={() => void generate()}>
              {busy ? `Making ${busy.done + 1} of ${busy.of}…` : count > 1 ? `Make ${count} images` : "Make image"}
            </Button>
            {busy && p.imageBackend === "comfy" && <Button onClick={stop}>Stop</Button>}
          </div>
          <p className="hint">
            {p.imageBackend === "openai"
              ? "Each image is billed to your OpenAI account. The prompt goes to OpenAI; nothing else from the project does."
              : "Runs on your ComfyUI. Nothing is uploaded or billed. Slow cards can take a few minutes per image."}
          </p>
          {text.trim() && finalPrompt !== text.trim() && (<><div className="lbl">What is sent</div><p className="prompt-text small">{finalPrompt}</p></>)}
        </Card>

        <Card>
          <h3 className="card-title">Recent images</h3>
          {recent.length === 0 ? <p className="muted">Nothing yet. Your images appear here and in the Library.</p> : (
            <div className="thumb-grid">
              {recent.map((a) => (
                <button key={a.id} className="thumb-btn" title={a.prompt || a.name} onClick={() => setOpen(a)}>
                  <Thumb asset={a} size={128} />
                  <span className="thumb-name">{a.name}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
      {open && <AssetViewer asset={open} notify={notify} onClose={() => setOpen(null)} onChanged={() => { void reload(); props.onMade(); }} onUsePrompt={(t) => { setText(t); setOpen(null); }} />}
    </div>
  );
}
