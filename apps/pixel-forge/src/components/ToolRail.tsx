import type { ReactNode } from "react";
import * as E from "../engine/editor";
import type { Tool } from "../engine/editor";
import { useEditor } from "../useEditor";
import { Seg } from "./controls";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const ICONS: Record<Tool, ReactNode> = {
  pen: <path {...s} d="M4 16 3.5 20.5 8 20 19 9l-4-4L4 16Zm9-9 4 4" />,
  erase: <path {...s} d="m9 20 11-11-5-5L4 15l5 5Zm0 0h11M7 12l5 5" />,
  fill: <path {...s} d="m5 11 7-7 7 7-7 7-7-7Zm0 0h14M20 16s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3Z" />,
  line: <path {...s} d="M5 19 19 5" />,
  rect: <rect {...s} x="4.5" y="6.5" width="15" height="11" rx="1" />,
  shade: <><circle {...s} cx="12" cy="12" r="7.5" /><path d="M12 4.5a7.5 7.5 0 0 1 0 15Z" fill="currentColor" /></>,
  pick: <path {...s} d="m14 4 6 6-2 2-6-6 2-2Zm-1 4-8 8-1 4 4-1 8-8" />,
  bone: <path {...s} d="M7 4a2 2 0 0 0-2 3 2 2 0 0 0 1 3.5L13.5 18a2 2 0 0 0 3.5 1 2 2 0 0 0 3-2 2 2 0 0 0-3.5-1L9 8.5A2 2 0 0 0 7 4Z" />,
  weight: <><circle {...s} cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3.5" fill="currentColor" /></>,
  layer: <path {...s} d="m12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4" />,
  pose: <><circle {...s} cx="12" cy="5" r="2" /><path {...s} d="M12 7v7m0-5 5-3m-5 3-4 3m4 2-4 6m4-6 4 6" /></>,
};
const KEYS: Partial<Record<Tool, string>> = { pen: "B", erase: "E", fill: "F", line: "L", rect: "R", shade: "S", pick: "I", bone: "J", weight: "W", pose: "P" };
const NAMES: Record<Tool, string> = { ...(E.TOOLS as Record<string, string>), bone: "Bones", weight: "Weights", layer: "Layers", pose: "Pose" } as Record<Tool, string>;
const PAINT: Tool[] = ["pen", "erase", "fill", "line", "rect", "shade", "pick"];

/** The tool column on the left of the studio: paint tools, then rig tools. */
export function ToolRail() {
  useEditor();
  const btn = (t: Tool) => (
    <button key={t} className="tool" aria-pressed={E.ed.tool === t} onClick={() => E.setTool(t)}
      title={`${NAMES[t]}${KEYS[t] ? ` (${KEYS[t]})` : ""}: ${E.TOOL_TIPS[t]}`} aria-label={NAMES[t]}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>{ICONS[t]}</svg>
    </button>
  );
  return (
    <div className="tool-rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {PAINT.map(btn)}
      <div className="rail-sep" />
      {E.RIG_TOOLS.map(btn)}
      <div className="rail-sep" />
      <div className="cur-color" title="Selected color" style={{ background: E.hex(E.P.rgb[E.ed.selSw] ?? [0, 0, 0]) }} />
    </div>
  );
}

/** Options for the tool in use, shown above the canvas. */
export function ToolOptions() {
  useEditor();
  const b = E.ed.brush;
  const t = E.ed.tool;
  if (t === "weight" || t === "layer") {
    const r = E.ed.rigBrush;
    return (
      <div className="tool-opts">
        <span className="opt-name">{t === "weight" ? "Weights" : "Layers"}</span>
        <label className="opt">Radius <input type="range" min={2} max={30} value={Math.round(r.r * 100)} onChange={(e) => E.setRigBrush({ r: +e.target.value / 100 })} /><output>{Math.round(r.r * 100)}%</output></label>
        {t === "weight" && <>
          <label className="opt">Strength <input type="range" min={5} max={100} value={Math.round(r.strength * 100)} onChange={(e) => E.setRigBrush({ strength: +e.target.value / 100 })} /><output>{Math.round(r.strength * 100)}%</output></label>
          <Seg label="Weight brush" value={r.mode} onChange={(m) => E.setRigBrush({ mode: m })} options={[["add", "Add"], ["sub", "Remove"], ["smooth", "Smooth"]]} />
        </>}
        <span className="hint">{t === "layer" ? "Paint pixels into the selected bone's layer. Ctrl+click a bone to switch." : "Red moves fully with the selected bone, blue barely. Ctrl+click a bone to switch."}</span>
      </div>
    );
  }
  if (t === "bone" || t === "pose") {
    return (
      <div className="tool-opts">
        <span className="opt-name">{t === "bone" ? "Bones" : "Pose"}</span>
        <span className="hint">{t === "bone"
          ? "Drag from a joint outward to add a bone. Drag from a bone's tip to chain the next one. Shift+drag a tip to move it."
          : "Drag a bone to rotate it. Shift+drag (or drag its joint) to move, Alt+drag to stretch. Keys are added on this frame."}</span>
      </div>
    );
  }
  return (
    <div className="tool-opts">
      <span className="opt-name">{NAMES[t]}</span>
      {t !== "fill" && t !== "pick" && <>
        <label className="opt">Size <input type="range" min={1} max={8} value={b.size} onChange={(e) => E.setBrush({ size: +e.target.value })} /><output>{b.size}</output></label>
        <Seg label="Brush shape" value={b.shape} onChange={(v) => E.setBrush({ shape: v })} options={[["square", "Square"], ["round", "Round"]]} />
      </>}
      {t !== "pick" && <label className="opt"><input type="checkbox" checked={b.mirror} onChange={(e) => E.setBrush({ mirror: e.target.checked })} /> Mirror</label>}
      {t !== "pick" && <label className="opt"><input type="checkbox" checked={b.dither} onChange={(e) => E.setBrush({ dither: e.target.checked })} /> Dither</label>}
      {t === "rect" && <label className="opt"><input type="checkbox" checked={b.rectFill} onChange={(e) => E.setBrush({ rectFill: e.target.checked })} /> Filled</label>}
      {t === "shade" && <Seg label="Shade direction" value={b.shadeMode} onChange={(v) => E.setBrush({ shadeMode: v })} options={[["darken", "Darker"], ["lighten", "Lighter"]]} />}
    </div>
  );
}
