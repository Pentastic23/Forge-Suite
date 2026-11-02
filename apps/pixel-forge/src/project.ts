// Keeps the engine's sketches and the .pixelforge project in step: loads them on open,
// adds new ones, and saves whatever changed a moment after the change.
import { api, type SketchRow } from "./api";
import type { Asset } from "./engine/core";
import { assets, clearHistory, dirty, ed, emit, removeSketch, snake } from "./engine/editor";
import { assetToDoc, docToAsset, imageToPngB64, pngB64ToImageData } from "./engine/doc";
import { loadSettings, settingsSnapshot, type SavedSettings } from "./engine/style";
import { loadAIPrefs } from "./ai";

export interface Meta { folder: string; tags: string[]; favorite: boolean; createdAt: number; updatedAt: number }
export const meta = new Map<number, Meta>();

const metaOf = (r: SketchRow): Meta => ({ folder: r.folder, tags: r.tags, favorite: r.favorite, createdAt: r.createdAt, updatedAt: r.updatedAt });

export async function loadProject(): Promise<string[]> {
  assets.length = 0;
  meta.clear();
  clearHistory();
  dirty.assets.clear();
  dirty.settings = false;
  loadSettings(await api.setting<SavedSettings>("style").catch(() => null));
  await loadAIPrefs();
  const problems: string[] = [];
  for (const r of await api.sketches()) {
    try {
      assets.push(await rowToAsset(r));
      meta.set(r.id, metaOf(r));
    } catch {
      problems.push(r.name);
    }
  }
  ed.curId = assets[0]?.id ?? null;
  ed.editTarget = null;
  ed.selBone = null;
  emit();
  return problems;
}

/** Stores a new sketch (or a ready-made one, like the example) and opens it. */
export async function storeSketch(a: Asset, folder: string): Promise<Asset> {
  a.name = snake(a.name) || "sprite";
  const id = await api.addSketch({ name: a.name, folder, png: imageToPngB64(a.src), doc: assetToDoc(a) });
  a.id = id;
  assets.push(a);
  const now = Date.now();
  meta.set(id, { folder, tags: [], favorite: false, createdAt: now, updatedAt: now });
  ed.curId = id;
  ed.editTarget = null;
  ed.selBone = null;
  ed.curFrame = 0;
  emit();
  return a;
}

export async function deleteSketch(id: number) {
  await api.deleteSketch(id);
  meta.delete(id);
  removeSketch(id);
}

export async function duplicate(id: number): Promise<number | null> {
  const a = assets.find((x) => x.id === id);
  if (!a) return null;
  await saveNow();
  const newId = await api.duplicateSketch(id, `${a.name}_copy`);
  await reloadOne(newId);
  return newId;
}

async function rowToAsset(r: SketchRow): Promise<Asset> {
  const a = docToAsset(r.id, r.name, await pngB64ToImageData(r.png), r.doc);
  // a broken AI image only loses the AI version, never the sketch
  if (r.aiPng) a.aiSrc = await pngB64ToImageData(r.aiPng, 1024).catch(() => null);
  if (!a.aiSrc) a.useAI = false;
  return a;
}

async function reloadOne(id: number) {
  const r = (await api.sketches()).find((x) => x.id === id);
  if (!r) return;
  assets.push(await rowToAsset(r));
  meta.set(r.id, metaOf(r));
  emit();
}

export function patchMeta(ids: number[], patch: Partial<Meta>) {
  for (const id of ids) {
    const m = meta.get(id);
    if (m) meta.set(id, { ...m, ...patch });
  }
  emit();
}

let saving: Promise<void> | null = null;
/** Writes every changed sketch and the settings. Safe to call often. */
export function saveNow(): Promise<void> {
  if (saving) return saving.then(() => (dirty.assets.size || dirty.settings ? saveNow() : undefined));
  saving = (async () => {
    const ids = [...dirty.assets];
    dirty.assets.clear();
    for (const id of ids) {
      const a = assets.find((x) => x.id === id);
      if (!a) continue;
      try {
        await api.saveSketch(id, a.name, assetToDoc(a));
        const m = meta.get(id);
        if (m) meta.set(id, { ...m, updatedAt: Date.now() });
      } catch (e) {
        dirty.assets.add(id);
        throw e;
      }
    }
    if (dirty.settings) {
      dirty.settings = false;
      try { await api.setSetting("style", settingsSnapshot()); } catch (e) { dirty.settings = true; throw e; }
    }
  })().finally(() => { saving = null; });
  return saving;
}

export const hasUnsaved = () => dirty.assets.size > 0 || dirty.settings;
