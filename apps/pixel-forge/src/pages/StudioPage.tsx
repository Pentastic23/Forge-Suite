import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Button, EmptyState } from "@forge/ui";
import * as E from "../engine/editor";
import { spriteCanvas } from "../engine/pack";
import { canvasToPngB64 } from "../engine/doc";
import { api, baseName, errorText } from "../api";
import { meta } from "../project";
import { addExample, dropFiles, pickSketches } from "../importing";
import { useEditor } from "../useEditor";
import type { Notify, Page } from "../App";
import { SpriteView, SpriteCanvas } from "../components/SpriteView";
import { ToolOptions, ToolRail } from "../components/ToolRail";
import { Inspector, type Tab } from "../components/Inspector";
import { Timeline } from "../components/Timeline";
import { Seg } from "../components/controls";

// Sprite Foundry's default shortcuts
const KEYS: Record<string, () => void> = {
  B: () => E.setTool("pen"), E: () => E.setTool("erase"), F: () => E.setTool("fill"), L: () => E.setTool("line"), R: () => E.setTool("rect"),
  S: () => E.setTool("shade"), I: () => E.setTool("pick"), J: () => E.setTool("bone"), W: () => E.setTool("weight"), P: () => E.setTool("pose"),
  K: () => E.keySelected(), "Shift+K": () => E.deleteKeys(),
  "-": () => E.setBrush({ size: Math.max(1, E.ed.brush.size - 1) }), "=": () => E.setBrush({ size: Math.min(8, E.ed.brush.size + 1) }),
  M: () => E.setBrush({ mirror: !E.ed.brush.mirror }), X: () => E.setBrush({ shadeMode: E.ed.brush.shadeMode === "darken" ? "lighten" : "darken" }),
  "Ctrl+Z": () => E.undo(), "Ctrl+Y": () => E.redo(), "Ctrl+Shift+Z": () => E.redo(), G: () => E.toggle("showGrid"),
  "1": () => E.setView(16), "2": () => E.setView(32), "3": () => E.setView(48), "4": () => E.setView(64), "5": () => E.setView(128),
  "[": () => E.stepSketch(-1), "]": () => E.stepSketch(1), Space: () => E.togglePlay(), ",": () => E.stepFrame(-1), ".": () => E.stepFrame(1),
  O: () => E.toggle("onion"),
};
function comboOf(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  let k = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && (k.length > 1 || /[A-Z0-9]/.test(k))) parts.push("Shift");
  parts.push(k);
  return parts.join("+");
}

/** The editor: tools on the left, the sprite in the middle, properties on the right, the timeline below. */
export function StudioPage(props: { notify: Notify; onNavigate: (p: Page) => void }) {
  const { notify } = props;
  useEditor();
  const [tab, setTab] = useState<Tab>("sketch");
  const [dragging, setDragging] = useState(false);
  const display = E.display();
  const a = E.cur();
  const folder = (a && meta.get(a.id)?.folder) || "Characters";

  // shortcuts, and Play moving the playhead
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && ((t.tagName === "INPUT" && !["checkbox", "range", "button", "color", "radio"].includes((t as HTMLInputElement).type)) || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      if (e.key === "Escape") {
        if (E.ed.colorMode) return E.toggle("colorMode");
        if (E.ed.eraseMode) return E.toggle("eraseMode");
        if (E.ed.selBone != null) return E.selectBone(null);
        if (E.ed.editTarget && E.ed.tool !== "pose") return E.backToSprite();
        return;
      }
      const c = comboOf(e);
      if (!c) return;
      if ((c === "Space" || c === "Enter") && t && (t.tagName === "BUTTON" || t.tagName === "INPUT")) return;
      const f = KEYS[c];
      if (!f) return;
      e.preventDefault();
      f();
    };
    let raf = 0;
    const loop = (ts: number) => { E.tick(ts); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    addEventListener("keydown", down);
    return () => { removeEventListener("keydown", down); cancelAnimationFrame(raf); };
  }, []);

  const savePng = async () => {
    if (!a) return;
    const N = E.ed.viewN;
    const path = await save({ defaultPath: `${a.name}_${N}.png`, filters: [{ name: "PNG image", extensions: ["png"] }] });
    if (!path) return;
    try { await api.exportFile(path, canvasToPngB64(spriteCanvas(a, N))); notify(`Saved ${baseName(path)}`); } catch (e) { notify(errorText(e), true); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void dropFiles([...e.dataTransfer.files], folder, notify);
  };
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop,
  };

  if (!E.assets.length) {
    return (
      <div className="studio-empty" {...dropProps}>
        <EmptyState title="Start with a sketch">
          <p>Draw on paper and take a photo, or use any PNG or JPG. Pixel Forge removes the background and turns it into pixel art at 16, 32, 48, 64 and 128 pixels.</p>
          <div className="row-wrap center">
            <Button variant="primary" onClick={() => void pickSketches("Characters", notify)}>Add sketches…</Button>
            <Button onClick={() => void addExample(notify)}>Try the example sketch</Button>
          </div>
          <p className="small">You can also drop image files here.</p>
        </EmptyState>
        {dragging && <div className="drop-hint">Drop to add sketches</div>}
      </div>
    );
  }

  const N = E.ed.viewN;
  const an = E.curAnimOf(a);
  return (
    <div className="studio" {...dropProps}>
      <div className="studio-top">
        <div className="sketch-pick">
          <Button variant="ghost" onClick={() => E.stepSketch(-1)} aria-label="Previous sketch" title="Previous sketch ([)">‹</Button>
          <select className="forge-input" aria-label="Sketch" value={a?.id ?? ""} onChange={(e) => E.selectSketch(+e.target.value)}>
            {E.assets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button variant="ghost" onClick={() => E.stepSketch(1)} aria-label="Next sketch" title="Next sketch (])">›</Button>
          <Button variant="ghost" onClick={() => void pickSketches(folder, notify)} title="Add sketches to this folder">Add…</Button>
        </div>
        <Seg label="Sprite size" value={N} onChange={(v) => E.setView(v)} options={E.SIZES.map((s) => [s, String(s), `${s}×${s} (${E.SIZES.indexOf(s) + 1})`] as [number, string, string])} />
        <span className="spacer" />
        <Button variant="ghost" onClick={() => E.undo()} title="Undo (Ctrl+Z)">Undo</Button>
        <Button variant="ghost" onClick={() => E.redo()} title="Redo (Ctrl+Y)">Redo</Button>
        <Button variant="ghost" aria-pressed={E.ed.showGrid} onClick={() => E.toggle("showGrid")} title="Pixel grid (G)">Grid</Button>
        <Button onClick={() => void savePng()} title={`Save this sprite at ${N}×${N} as a PNG`}>Save PNG…</Button>
        <Button variant="primary" onClick={() => props.onNavigate("export")}>Export…</Button>
      </div>

      <ToolRail />

      <div className="center-col">
        <ToolOptions />
        {E.ed.editTarget && an && (
          <div className="edit-banner" role="status">
            <span>Editing frame {E.ed.editTarget.f + 1} of {an.frames} in “{an.name}”. Paint here changes only this frame.</span>
            <Button variant="ghost" onClick={() => E.backToSprite()}>Back to the still sprite</Button>
          </div>
        )}
        <SpriteView display={display} />
        {display && (
          <div className="size-strip" aria-label="All sizes">
            {E.SIZES.map((s) => (
              <button key={s} className="cell" aria-pressed={s === N} onClick={() => E.setView(s)} title={`Show ${s}×${s}`}>
                <span className="checker"><SpriteCanvas idx={E.spriteAt(display.a, s)} N={s} box={s <= 16 ? 32 : s <= 48 ? 48 : 64} fit={s > 64} label={`${s} by ${s}`} /></span>
                <span>{s}×{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Inspector display={display} notify={notify} tab={tab} onTab={setTab} />
      <Timeline display={display} />
      {dragging && <div className="drop-hint">Drop to add sketches, palettes or style profiles</div>}
    </div>
  );
}
