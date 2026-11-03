import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Badge, Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, plural, type Service } from "../api";
import type { Notify } from "../App";
import { Field, Seg, Select } from "../components/controls";
import { CLAUDE_MODELS, current, EFFORTS, refreshKeys, setBrief, setCodex, setPrefs, useAI } from "../prefs";
import { ENGINES, systemPrompt } from "../prompts";

const SERVICES: { key: Service; name: string; what: string; link: string }[] = [
  { key: "anthropic", name: "Anthropic (Claude)", what: "Chat with Claude.", link: "https://console.anthropic.com/settings/keys" },
  { key: "openai", name: "OpenAI", what: "Chat with OpenAI models and make images.", link: "https://platform.openai.com/api-keys" },
  { key: "meshy", name: "Meshy", what: "Make 3D models.", link: "https://www.meshy.ai/api" },
];

export function SettingsPage(props: { notify: Notify }) {
  const { notify } = props;
  const ai = useAI();
  const p = ai.prefs;
  const [keyDraft, setKeyDraft] = useState<Partial<Record<Service, string>>>({});
  const [localModels, setLocalModels] = useState<string[] | null>(null);
  const [checkpoints, setCheckpoints] = useState<string[] | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  const saveKey = async (s: Service) => {
    try { await api.keySet(s, keyDraft[s] ?? ""); setKeyDraft((d) => ({ ...d, [s]: "" })); await refreshKeys(); notify("Key saved in Windows Credential Manager"); }
    catch (e) { notify(errorText(e), true); }
  };
  const clearKey = async (s: Service) => {
    if (!window.confirm("Remove this key from this PC?")) return;
    try { await api.keyClear(s); await refreshKeys(); } catch (e) { notify(errorText(e), true); }
  };
  const connectLocal = async () => {
    try {
      const list = await api.localModels(p.localUrl);
      setLocalModels(list);
      if (!list.includes(p.localModel)) await setPrefs({ localModel: list[0] ?? "" });
      notify(list.length ? `Found ${plural(list.length, "model")}` : "Connected, but the server has no models. Download one first (for Ollama: ollama pull qwen3:8b)");
    } catch (e) { setLocalModels(null); notify(errorText(e), true); }
  };
  const connectComfy = async () => {
    try {
      const info = await api.comfyInfo(p.comfyUrl);
      setCheckpoints(info.checkpoints);
      await setPrefs({ comfyUrl: info.url, ...(info.checkpoints.includes(p.checkpoint) ? {} : { checkpoint: info.checkpoints[0] ?? "" }) });
      notify(info.checkpoints.length ? `Connected to ComfyUI: ${plural(info.checkpoints.length, "checkpoint")}` : "Connected, but ComfyUI has no checkpoints. Put a model in its models/checkpoints folder");
    } catch (e) { setCheckpoints(null); notify(errorText(e), true); }
  };
  const loadWorkflow = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "ComfyUI workflow (API format)", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const wf = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(await api.readImage(path)), (c) => c.charCodeAt(0))));
      if (!JSON.stringify(wf).includes("%PROMPT%")) { notify("Put %PROMPT% in your workflow where the prompt goes, then load it again", true); return; }
      await setPrefs({ workflow: wf, workflowName: path.split(/[\\/]/).pop()! });
      notify("Workflow loaded");
    } catch (e) { notify(e instanceof SyntaxError ? "That file isn't JSON" : errorText(e), true); }
  };
  const importCodex = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Forge Core codex", extensions: ["forgecodex", "json"] }] });
    if (typeof path !== "string") return;
    try { const c = await api.codexImport(path); setCodex(c); notify(`Imported ${plural(c.entries.length, "codex entry", "codex entries")} from "${c.project}"`); }
    catch (e) { notify(errorText(e), true); }
  };
  const clearCodex = async () => {
    try { await api.codexClear(); setCodex(null); } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="stack">
      <PageHeader title="Settings" subtitle="Which AI to use, your keys, and what the assistant should know about your game. Settings are kept in this project; keys stay on this PC." />

      <Card>
        <h3 className="card-title">Project brief</h3>
        <p className="hint">Sent with every chat so answers fit your game.</p>
        <div className="grid-2">
          <Field label="Game name"><input className="forge-input" value={ai.brief.game} onChange={(e) => void setBrief({ game: e.target.value })} /></Field>
          <Field label="Genre"><input className="forge-input" value={ai.brief.genre} placeholder="2D platformer, top-down RPG…" onChange={(e) => void setBrief({ genre: e.target.value })} /></Field>
          <Field label="Engine"><Select value={ai.brief.engine} options={ENGINES} onChange={(v) => void setBrief({ engine: v })} /></Field>
          <Field label="Art style" hint="Also added to image prompts when you choose."><input className="forge-input" value={ai.brief.artStyle} placeholder="32 px pixel art, warm palette, dark outlines" onChange={(e) => void setBrief({ artStyle: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><textarea className="forge-input full" rows={3} value={ai.brief.notes} placeholder="Anything the assistant should always know: scope, platforms, audience, rules." onChange={(e) => void setBrief({ notes: e.target.value })} /></Field>
        <div className="lbl">Codex from Forge Core</div>
        <div className="row-wrap">
          {ai.codex ? <Badge tone="good">{plural(ai.codex.entries.length, "entry", "entries")} from {ai.codex.project}</Badge> : <span className="muted small">None. Export a .forgecodex from Forge Core to give the assistant your lore, mobs, items and quests.</span>}
          <Button onClick={() => void importCodex()}>{ai.codex ? "Import again…" : "Import .forgecodex…"}</Button>
          {ai.codex && <Button variant="ghost" onClick={() => void clearCodex()}>Remove</Button>}
          {ai.codex && <label className="check"><input type="checkbox" checked={ai.brief.useCodex} onChange={(e) => void setBrief({ useCodex: e.target.checked })} /> Send it with chats</label>}
        </div>
        <Button variant="ghost" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? "Hide" : "Show"} exactly what is sent</Button>
        {showPrompt && <pre className="system-preview">{systemPrompt("general", current().brief, current().codex)}</pre>}
      </Card>

      <Card>
        <h3 className="card-title">Chat</h3>
        <Seg label="Chat with" value={p.chatProvider} options={[["anthropic", "Claude (online)"], ["openai", "OpenAI (online)"], ["local", "Local model (this PC)"]]} onChange={(v) => void setPrefs({ chatProvider: v })} />
        {p.chatProvider === "anthropic" && (
          <div className="grid-2">
            <Field label="Model"><Select value={p.claudeModel} options={CLAUDE_MODELS.some(([k]) => k === p.claudeModel) ? CLAUDE_MODELS : [...CLAUDE_MODELS, [p.claudeModel, p.claudeModel]]} onChange={(v) => void setPrefs({ claudeModel: v })} /></Field>
            <Field label="Effort" hint="Higher thinks longer on hard questions and costs more."><Select value={p.effort} options={EFFORTS} onChange={(v) => void setPrefs({ effort: v })} /></Field>
          </div>
        )}
        {p.chatProvider === "openai" && (
          <Field label="Model" hint="Any chat model your OpenAI account can use."><input className="forge-input" value={p.openaiModel} onChange={(e) => void setPrefs({ openaiModel: e.target.value })} /></Field>
        )}
        {p.chatProvider === "local" && (
          <>
            <p className="hint">Run a model on this PC with <b>Ollama</b> or <b>LM Studio</b> (both work on AMD cards through Vulkan). Nothing leaves your PC and nothing is billed. Smaller models (7 to 8B) fit in 8 GB of video memory.</p>
            <div className="grid-2">
              <Field label="Server address" hint="Ollama: http://127.0.0.1:11434 · LM Studio: http://127.0.0.1:1234">
                <div className="row-wrap" style={{ margin: 0 }}>
                  <input className="forge-input" style={{ flex: 1 }} value={p.localUrl} onChange={(e) => void setPrefs({ localUrl: e.target.value })} />
                  <Button onClick={() => void connectLocal()}>Connect</Button>
                </div>
              </Field>
              <Field label="Model">
                {localModels && localModels.length ? <Select value={p.localModel} options={localModels.map((m) => [m, m] as [string, string])} onChange={(v) => void setPrefs({ localModel: v })} />
                  : <input className="forge-input" value={p.localModel} placeholder="Press Connect to list models" onChange={(e) => void setPrefs({ localModel: e.target.value })} />}
              </Field>
            </div>
          </>
        )}
      </Card>

      <Card>
        <h3 className="card-title">API keys</h3>
        <p className="hint">Each service is optional and paid by you. Keys are kept in Windows Credential Manager on this PC, never in the project, and only sent to their own service.</p>
        <ul className="list-plain keys">
          {SERVICES.map((s) => (
            <li key={s.key}>
              <div>
                <b>{s.name}</b> {ai.keys?.[s.key] ? <Badge tone="good">Key saved</Badge> : <Badge>No key</Badge>}
                <div className="muted small">{s.what} Get a key at <span className="mono">{s.link}</span></div>
              </div>
              <div className="row-wrap nowrap">
                <input className="forge-input" type="password" autoComplete="off" placeholder={ai.keys?.[s.key] ? "Replace key" : "Paste key"} value={keyDraft[s.key] ?? ""} onChange={(e) => setKeyDraft((d) => ({ ...d, [s.key]: e.target.value }))} />
                <Button variant="primary" disabled={!keyDraft[s.key]?.trim()} onClick={() => void saveKey(s.key)}>Save</Button>
                {ai.keys?.[s.key] && <Button variant="ghost" onClick={() => void clearKey(s.key)}>Remove</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="card-title">Images</h3>
        <Seg label="Make images with" value={p.imageBackend} options={[["openai", "OpenAI (online)"], ["comfy", "ComfyUI (this PC)"]]} onChange={(v) => void setPrefs({ imageBackend: v })} />
        {p.imageBackend === "openai" ? (
          <Field label="Image model" hint="gpt-image-1 unless your account has a newer one."><input className="forge-input" value={p.imageModel} onChange={(e) => void setPrefs({ imageModel: e.target.value })} /></Field>
        ) : (
          <>
            <p className="hint">Start <b>ComfyUI</b> yourself (on AMD cards like the RX 5700 XT: <span className="mono">python main.py --directml</span>) with a Stable Diffusion checkpoint in its models/checkpoints folder, then press Connect.</p>
            <div className="grid-2">
              <Field label="ComfyUI address">
                <div className="row-wrap" style={{ margin: 0 }}>
                  <input className="forge-input" style={{ flex: 1 }} value={p.comfyUrl} onChange={(e) => void setPrefs({ comfyUrl: e.target.value })} />
                  <Button onClick={() => void connectComfy()}>Connect</Button>
                </div>
              </Field>
              <Field label="Checkpoint">
                {checkpoints && checkpoints.length ? <Select value={p.checkpoint} options={checkpoints.map((c) => [c, c] as [string, string])} onChange={(v) => void setPrefs({ checkpoint: v })} />
                  : <span className="muted small">{p.checkpoint || "Press Connect to list them"}</span>}
              </Field>
              <Field label="Steps"><input className="forge-input num" type="number" min={4} max={80} value={p.steps} onChange={(e) => void setPrefs({ steps: Number(e.target.value) })} /></Field>
              <Field label="Avoid (negative prompt)"><input className="forge-input" value={p.negative} onChange={(e) => void setPrefs({ negative: e.target.value })} /></Field>
            </div>
            <div className="lbl">Workflow</div>
            <div className="row-wrap">
              <span className="small">{p.workflow ? `Your own: ${p.workflowName}` : "Built in: text to image with the checkpoint above"}</span>
              <Button onClick={() => void loadWorkflow()}>Use my workflow…</Button>
              {p.workflow !== null && <Button variant="ghost" onClick={() => void setPrefs({ workflow: null, workflowName: "" })}>Use built-in</Button>}
            </div>
            <p className="hint">Save your workflow from ComfyUI with "Save (API format)" and put %PROMPT% where the prompt goes. AI Forge also fills %NEGATIVE%, %CHECKPOINT%, %SEED%, %STEPS%, %CFG%, %WIDTH% and %HEIGHT%.</p>
          </>
        )}
      </Card>

      <Card>
        <h3 className="card-title">Test mode</h3>
        <p className="hint">A development build started with <span className="mono">AIFORGE_AI_MOCK=1</span> answers chats with a sample, makes test images and a cube model, and sends nothing anywhere.</p>
      </Card>
    </div>
  );
}
