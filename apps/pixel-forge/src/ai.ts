// Optional AI coloring with the person's own OpenAI key. Off until they turn it on and add a key.
// The key lives in the Windows Credential Manager and never comes back to this window; the app
// sends the sketch and prompt to OpenAI and keeps the result with the sketch, so it isn't paid for twice.
import { api, type AIQuality } from "./api";
import type { Asset } from "./engine/core";
import * as E from "./engine/editor";
import { imageToPngB64, pngB64ToImageData } from "./engine/doc";

export interface AIPrefs { on: boolean; quality: AIQuality; model: string }
const DEFAULTS: AIPrefs = { on: false, quality: "medium", model: "gpt-image-1" };
export const QUALITIES: [AIQuality, string][] = [["low", "Low (cheapest)"], ["medium", "Medium"], ["high", "High (most detail)"]];

/** What the AI panel shows. Changing it calls the editor's emit so React redraws. */
export const ai = {
  prefs: { ...DEFAULTS } as AIPrefs,
  hasKey: null as boolean | null,
  /** The sketch being colored right now, if any. */
  busyId: null as number | null,
};

function clean(v: unknown): AIPrefs {
  const p = (v && typeof v === "object" ? v : {}) as Partial<AIPrefs>;
  return {
    on: p.on === true,
    quality: QUALITIES.some(([q]) => q === p.quality) ? p.quality! : DEFAULTS.quality,
    model: typeof p.model === "string" && p.model.trim() ? p.model.trim().slice(0, 64) : DEFAULTS.model,
  };
}

export async function loadAIPrefs() {
  ai.prefs = clean(await api.setting("ai").catch(() => null));
  ai.busyId = null;
  if (ai.prefs.on) await refreshKey();
}

export async function setAIPrefs(patch: Partial<AIPrefs>) {
  ai.prefs = clean({ ...ai.prefs, ...patch });
  E.emit();
  await api.setSetting("ai", ai.prefs);
  if (patch.on) await refreshKey();
}

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

/** Sends the sketch to OpenAI and switches it to the colored version. Returns the message to show. */
export async function colorWithAI(a: Asset): Promise<string> {
  if (ai.busyId !== null) return "Already coloring a sketch. Wait for it to finish";
  ai.busyId = a.id;
  E.emit();
  try {
    const req = { png: imageToPngB64(a.src), prompt: E.buildAIPrompt(a.aiPrompt), size: E.aiSizeFor(a), quality: ai.prefs.quality, model: ai.prefs.model };
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

