// Optional AI coloring. Off until the person turns it on. Two places can do it:
// - OpenAI, with the person's own key. The key lives in the Windows Credential Manager and never comes
//   back to this window; each run is billed to their account.
// - ComfyUI, a server the person runs themselves (usually on this PC). Nothing is uploaded or billed.
// Either way the result is kept with the sketch, so it is never made twice by accident.
import { api, type AIQuality } from "./api";
import type { Asset } from "./engine/core";
import * as E from "./engine/editor";
import { canvasToPngB64, imageToPngB64, pngB64ToImageData } from "./engine/doc";

export type Backend = "openai" | "comfy";
export interface AIPrefs {
  on: boolean;
  backend: Backend;
  quality: AIQuality;
  model: string;
  comfyUrl: string;
  checkpoint: string;
  /** How far the image may move away from the sketch (ComfyUI's denoise). */
  denoise: number;
  steps: number;
  /** Long side of the image sent to ComfyUI: 512 suits SD 1.5 checkpoints, 1024 suits SDXL. */
  size: number;
  /** The person's own workflow in ComfyUI's API format, or null for the built-in one. */
  workflow: unknown | null;
  workflowName: string;
}
export const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
const DEFAULTS: AIPrefs = {
  on: false, backend: "openai", quality: "medium", model: "gpt-image-1",
  comfyUrl: DEFAULT_COMFY_URL, checkpoint: "", denoise: 0.55, steps: 24, size: 512, workflow: null, workflowName: "",
};
export const QUALITIES: [AIQuality, string][] = [["low", "Low (cheapest)"], ["medium", "Medium"], ["high", "High (most detail)"]];
export const SIZES: [number, string][] = [[512, "512 px (SD 1.5 models)"], [768, "768 px"], [1024, "1024 px (SDXL models)"]];

/** What the AI panel shows. Changing it calls the editor's emit so React redraws. */
export const ai = {
  prefs: { ...DEFAULTS } as AIPrefs,
  hasKey: null as boolean | null,
  /** The sketch being colored right now, if any. */
  busyId: null as number | null,
  /** What ComfyUI said the last time Pixel Forge asked: its checkpoints, or why it couldn't be reached. */
  comfy: { checked: false, checkpoints: [] as string[], error: "" },
};

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, d: string, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : d);

export function cleanPrefs(v: unknown): AIPrefs {
  const p = (v && typeof v === "object" ? v : {}) as Partial<AIPrefs>;
  return {
    on: p.on === true,
    backend: p.backend === "comfy" ? "comfy" : "openai",
    quality: QUALITIES.some(([q]) => q === p.quality) ? p.quality! : DEFAULTS.quality,
    model: str(p.model, DEFAULTS.model, 64),
    comfyUrl: str(p.comfyUrl, DEFAULTS.comfyUrl),
    checkpoint: str(p.checkpoint, ""),
    denoise: Math.round(num(p.denoise, 0.2, 0.9, DEFAULTS.denoise) * 100) / 100,
    steps: Math.round(num(p.steps, 4, 80, DEFAULTS.steps)),
    size: SIZES.some(([n]) => n === p.size) ? p.size! : DEFAULTS.size,
    workflow: p.workflow && typeof p.workflow === "object" ? p.workflow : null,
    workflowName: p.workflow && typeof p.workflow === "object" ? str(p.workflowName, "my workflow") : "",
  };
}

export async function loadAIPrefs() {
  ai.prefs = cleanPrefs(await api.setting("ai").catch(() => null));
  ai.busyId = null;
  ai.comfy = { checked: false, checkpoints: [], error: "" };
  if (ai.prefs.on) await refreshKey();
}

export async function setAIPrefs(patch: Partial<AIPrefs>) {
  const was = ai.prefs;
  ai.prefs = cleanPrefs({ ...ai.prefs, ...patch });
  if (patch.comfyUrl !== undefined && ai.prefs.comfyUrl !== was.comfyUrl) ai.comfy = { checked: false, checkpoints: [], error: "" };
  E.emit();
  await api.setSetting("ai", ai.prefs);
  if (patch.on) await refreshKey();
}

// ---------------------------------------------------------------- OpenAI key
export async function refreshKey() {
  ai.hasKey = await api.aiHasKey().catch(() => false);
  E.emit();
}

export async function saveKey(key: string) {
  await api.aiSetKey(key.trim());
  await refreshKey();
}

export async function removeKey() {
  await api.aiClearKey();
  await refreshKey();
}

// ---------------------------------------------------------------- ComfyUI
/** Asks ComfyUI for its checkpoints; picks the first one if none was chosen. Returns the message to show. */
export async function connectComfy(): Promise<string> {
  try {
    const info = await api.comfyInfo(ai.prefs.comfyUrl);
    ai.comfy = { checked: true, checkpoints: info.checkpoints, error: "" };
    const keep = info.checkpoints.includes(ai.prefs.checkpoint);
    await setAIPrefs({ comfyUrl: info.url, ...(keep ? {} : { checkpoint: info.checkpoints[0] ?? "" }) });
    ai.comfy.checked = true; // setAIPrefs clears it when the address was tidied
    ai.comfy.checkpoints = info.checkpoints;
    E.emit();
    return info.checkpoints.length
      ? `Connected to ComfyUI: ${info.checkpoints.length} checkpoint${info.checkpoints.length === 1 ? "" : "s"}`
      : "Connected, but ComfyUI has no checkpoints. Put a model in ComfyUI's models/checkpoints folder";
  } catch (e) {
    ai.comfy = { checked: true, checkpoints: [], error: String(e) };
    E.emit();
    throw e;
  }
}

/** The sketch on white (ComfyUI drops transparency), with its long side at `size` and both sides a multiple of 8. */
export function sketchForComfy(src: ImageData, size: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const s = size / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round((src.width * s) / 8) * 8), h = Math.max(8, Math.round((src.height * s) / 8) * 8);
  const t = document.createElement("canvas");
  t.width = src.width; t.height = src.height;
  t.getContext("2d")!.putImageData(src, 0, 0);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = "high";
  g.drawImage(t, 0, 0, w, h);
  return { canvas: c, w, h };
}

export async function stopComfy() {
  await api.comfyInterrupt(ai.prefs.comfyUrl);
}

// ---------------------------------------------------------------- coloring
/** Colors the sketch with the chosen backend and switches it to the result. Returns the message to show. */
export async function colorWithAI(a: Asset): Promise<string> {
  if (ai.busyId !== null) return "Already coloring a sketch. Wait for it to finish";
  ai.busyId = a.id;
  E.emit();
  try {
    const p = ai.prefs;
    if (p.backend === "comfy") {
      const { positive, negative } = E.buildLocalPrompt(a.aiPrompt);
      const req = {
        url: p.comfyUrl, png: canvasToPngB64(sketchForComfy(a.src, p.size).canvas), prompt: positive, negative,
        checkpoint: p.checkpoint, steps: p.steps, cfg: 7, denoise: p.denoise, seed: Math.floor(Math.random() * 2 ** 48), workflow: p.workflow,
      };
      const r = await api.comfyColor(a.id, req);
      E.setAIImage(a, await pngB64ToImageData(r.png, 1024));
      return r.mock ? "Test mode: returned your sketch without calling ComfyUI" : "AI version ready. It's now used for the pixel art";
    }
    const req = { png: imageToPngB64(a.src), prompt: E.buildAIPrompt(a.aiPrompt), size: E.aiSizeFor(a), quality: p.quality, model: p.model };
    const r = await api.aiColor(a.id, req);
    E.setAIImage(a, await pngB64ToImageData(r.png, 1024));
    return r.mock ? "Test mode: returned your sketch without calling OpenAI" : "AI version ready. It's now used for the pixel art";
  } finally {
    ai.busyId = null;
    E.emit();
  }
}

/** Throws away the AI version, in the project too. */
export async function discardAI(a: Asset) {
  await api.aiImageSet(a.id, null);
  E.setAIImage(a, null);
}

/** Is everything in place to press the button? An empty string means yes, otherwise what is missing. */
export function readyProblem(): string {
  const p = ai.prefs;
  if (p.backend === "openai") return ai.hasKey ? "" : "Add your OpenAI API key first";
  if (p.workflow) return "";
  return p.checkpoint ? "" : "Connect to ComfyUI and pick a checkpoint first";
}
