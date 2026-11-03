// The project's AI settings (which provider and model, image and 3D options), the
// brief and the imported codex. Kept in the project; API keys are not, they stay
// in the Windows Credential Manager.
import { useSyncExternalStore } from "react";
import { api, type ChatRequest, type Codex, type KeyStatus, type Provider } from "./api";
import { cleanBrief, EMPTY_BRIEF, type Brief } from "./prompts";

export const CLAUDE_MODELS: [string, string][] = [
  ["claude-opus-5-5", "Claude Opus 5.5 (best for most work)"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5 (faster, cheaper)"],
  ["claude-haiku-5-5", "Claude Haiku 5.5 (fastest, cheapest)"],
  ["claude-fable-5-1", "Claude Fable 5.1 (most capable, most expensive)"],
];
export const EFFORTS: [string, string][] = [["", "Model default"], ["low", "Low (quick answers)"], ["medium", "Medium"], ["high", "High (hard problems)"]];
export const IMAGE_SIZES: [string, string][] = [["1024x1024", "Square 1024"], ["1536x1024", "Wide 1536×1024"], ["1024x1536", "Tall 1024×1536"]];
export const IMAGE_QUALITIES: [string, string][] = [["low", "Low (cheapest)"], ["medium", "Medium"], ["high", "High (most detail)"]];
export const COMFY_SIZES: [number, string][] = [[512, "512 px (SD 1.5 models)"], [768, "768 px"], [1024, "1024 px (SDXL models)"]];
export const DEFAULT_LOCAL_URL = "http://127.0.0.1:11434";
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";

export interface AIPrefs {
  chatProvider: Provider;
  claudeModel: string;
  openaiModel: string;
  localUrl: string;
  localModel: string;
  effort: string;
  imageBackend: "openai" | "comfy";
  imageModel: string;
  imageQuality: string;
  imageSize: string;
  comfyUrl: string;
  checkpoint: string;
  comfySize: number;
  steps: number;
  negative: string;
  /** The person's own ComfyUI workflow (API format), or null for the built-in one. */
  workflow: unknown | null;
  workflowName: string;
  meshArtStyle: "realistic" | "sculpture";
  meshTopology: "triangle" | "quad";
  meshPolycount: number;
  meshPbr: boolean;
}

export const DEFAULTS: AIPrefs = {
  chatProvider: "anthropic", claudeModel: "claude-opus-5-5", openaiModel: "gpt-5", localUrl: DEFAULT_LOCAL_URL, localModel: "", effort: "",
  imageBackend: "openai", imageModel: "gpt-image-1", imageQuality: "medium", imageSize: "1024x1024",
  comfyUrl: DEFAULT_COMFY_URL, checkpoint: "", comfySize: 512, steps: 24, negative: "blurry, text, watermark, signature, jpeg artifacts",
  workflow: null, workflowName: "",
  meshArtStyle: "realistic", meshTopology: "triangle", meshPolycount: 10000, meshPbr: true,
};

const str = (v: unknown, d: string, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);

export function cleanPrefs(v: unknown): AIPrefs {
  const p = (v && typeof v === "object" ? v : {}) as Partial<AIPrefs>;
  const wf = p.workflow && typeof p.workflow === "object" ? p.workflow : null;
  return {
    chatProvider: pick(p.chatProvider, ["anthropic", "openai", "local"] as const, DEFAULTS.chatProvider),
    claudeModel: str(p.claudeModel, DEFAULTS.claudeModel, 100),
    openaiModel: str(p.openaiModel, DEFAULTS.openaiModel, 100),
    localUrl: str(p.localUrl, DEFAULTS.localUrl),
    localModel: str(p.localModel, "", 200),
    effort: pick(p.effort, ["", "low", "medium", "high"] as const, ""),
    imageBackend: pick(p.imageBackend, ["openai", "comfy"] as const, DEFAULTS.imageBackend),
    imageModel: str(p.imageModel, DEFAULTS.imageModel, 64),
    imageQuality: pick(p.imageQuality, IMAGE_QUALITIES.map(([k]) => k), DEFAULTS.imageQuality),
    imageSize: pick(p.imageSize, IMAGE_SIZES.map(([k]) => k), DEFAULTS.imageSize),
    comfyUrl: str(p.comfyUrl, DEFAULTS.comfyUrl),
    checkpoint: str(p.checkpoint, ""),
    comfySize: COMFY_SIZES.some(([n]) => n === p.comfySize) ? p.comfySize! : DEFAULTS.comfySize,
    steps: num(p.steps, 4, 80, DEFAULTS.steps),
    negative: typeof p.negative === "string" ? p.negative.slice(0, 1000) : DEFAULTS.negative,
    workflow: wf,
    workflowName: wf ? str(p.workflowName, "my workflow") : "",
    meshArtStyle: pick(p.meshArtStyle, ["realistic", "sculpture"] as const, DEFAULTS.meshArtStyle),
    meshTopology: pick(p.meshTopology, ["triangle", "quad"] as const, DEFAULTS.meshTopology),
    meshPolycount: num(p.meshPolycount, 100, 300000, DEFAULTS.meshPolycount),
    meshPbr: p.meshPbr !== false,
  };
}

interface State { prefs: AIPrefs; brief: Brief; codex: Codex | null; keys: KeyStatus | null }
let state: State = { prefs: DEFAULTS, brief: EMPTY_BRIEF, codex: null, keys: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useAI(): State {
  return useSyncExternalStore(subscribe, () => state);
}
export const current = () => state;

export async function loadAI() {
  const [prefs, brief, codex] = await Promise.all([
    api.setting("ai").catch(() => null),
    api.setting("brief").catch(() => null),
    api.setting<Codex>("codex").catch(() => null),
  ]);
  state = { ...state, prefs: cleanPrefs(prefs), brief: cleanBrief(brief), codex: codex && Array.isArray(codex.entries) ? codex : null };
  emit();
  await refreshKeys();
}

export async function setPrefs(patch: Partial<AIPrefs>) {
  state = { ...state, prefs: cleanPrefs({ ...state.prefs, ...patch }) };
  emit();
  await api.setSetting("ai", state.prefs);
}

export async function setBrief(patch: Partial<Brief>) {
  state = { ...state, brief: cleanBrief({ ...state.brief, ...patch }) };
  emit();
  await api.setSetting("brief", state.brief);
}

export function setCodex(codex: Codex | null) {
  state = { ...state, codex };
  emit();
}

export async function refreshKeys() {
  state = { ...state, keys: await api.keys().catch(() => ({ anthropic: false, openai: false, meshy: false })) };
  emit();
}

/** The chat request for the chosen provider, with the given instructions. */
export function chatRequest(system: string): ChatRequest {
  const p = state.prefs;
  const model = p.chatProvider === "anthropic" ? p.claudeModel : p.chatProvider === "openai" ? p.openaiModel : p.localModel;
  return { provider: p.chatProvider, model, url: p.localUrl, system, effort: p.chatProvider === "anthropic" ? p.effort : "" };
}

/** What is missing before the chat can be used, or "" when it is ready. */
export function chatProblem(s: State = state): string {
  const p = s.prefs;
  if (p.chatProvider === "anthropic" && s.keys && !s.keys.anthropic) return "Add your Anthropic API key in Settings to chat with Claude.";
  if (p.chatProvider === "openai" && s.keys && !s.keys.openai) return "Add your OpenAI API key in Settings to chat with OpenAI.";
  if (p.chatProvider === "local" && !p.localModel) return "Connect to your local model server in Settings and pick a model.";
  return "";
}

export function providerLabel(p: AIPrefs): string {
  if (p.chatProvider === "anthropic") return CLAUDE_MODELS.find(([k]) => k === p.claudeModel)?.[1].split(" (")[0] ?? p.claudeModel;
  if (p.chatProvider === "openai") return `OpenAI ${p.openaiModel}`;
  return p.localModel ? `${p.localModel} (this PC)` : "Local model";
}
