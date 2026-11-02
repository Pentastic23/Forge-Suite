import { open } from "@tauri-apps/plugin-dialog";
import { api, baseName, errorText, IMAGE_EXT, mimeOf, plural } from "./api";
import { newAsset } from "./engine/core";
import { exampleAsset, fileToImageData, urlToImageData } from "./engine/doc";
import { importPalette, parsePaletteText } from "./engine/editor";
import { applyTheme, isTheme } from "./engine/style";
import { storeSketch } from "./project";
import type { Notify } from "./App";

/** Longest side a sketch is kept at. Larger photos are scaled down, as in Sprite Foundry. */
const SKETCH_MAX = 1024;

/** Opens the file picker and adds each chosen image as a sketch in `folder`. */
export async function pickSketches(folder: string, notify: Notify): Promise<number> {
  const picked = await open({ multiple: true, filters: [{ name: "Sketches", extensions: IMAGE_EXT }] });
  const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  let added = 0;
  for (const p of paths) {
    try {
      const im = await urlToImageData(`data:${mimeOf(p)};base64,${await api.readImage(p)}`, SKETCH_MAX);
      await storeSketch(newAsset(baseName(p), im), folder);
      added++;
    } catch (e) { notify(`${baseName(p)}: ${errorText(e)}`, true); }
  }
  if (added) notify(`Added ${plural(added, "sketch", "sketches")} to ${folder}`);
  return added;
}

/** Files dropped on the window: images become sketches, palette lists and style profiles are applied. */
export async function dropFiles(files: File[], folder: string, notify: Notify): Promise<number> {
  let added = 0;
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) {
        await storeSketch(newAsset(f.name, await fileToImageData(f, SKETCH_MAX)), folder);
        added++;
      } else if (/\.(hex|gpl|txt|pal)$/i.test(f.name)) importPalette(parsePaletteText(await f.text()), f.name);
      else if (/\.json$/i.test(f.name)) {
        const t: unknown = JSON.parse(await f.text());
        if (isTheme(t)) { applyTheme(t); notify(`Applied style profile ${f.name}`); } else notify(`${f.name} is not a style profile`, true);
      }
    } catch (e) { notify(`${f.name}: ${errorText(e)}`, true); }
  }
  if (added) notify(`Added ${plural(added, "sketch", "sketches")} to ${folder}`);
  return added;
}

export async function addExample(notify: Notify) {
  try { await storeSketch(exampleAsset(), "Characters"); notify("Added the example sketch. It comes with a small rig and an idle animation"); }
  catch (e) { notify(errorText(e), true); }
}

