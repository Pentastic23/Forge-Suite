import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as E from "../engine/editor";
import type { Display } from "../engine/editor";
import { useEditor } from "../useEditor";

/** The big pixel canvas in the middle of the studio, with the bones, brush cursor and mesh drawn over it. */
export function SpriteView(props: { display: Display | null }) {
  useEditor();
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const [avail, setAvail] = useState(512);
  const d = props.display;
  const N = E.ed.viewN;
  const zoom = Math.max(1, Math.floor(avail / N));

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setAvail(Math.max(64, Math.min(el.clientWidth, el.clientHeight) - 32));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!view.current || !over.current || !d) return;
    E.drawIdx(view.current, d.disp, N, zoom, E.ed.showGrid, d.onion);
    E.ed.viewPx = N * zoom;
    E.drawOverlay(over.current, zoom);
  });
  useEffect(() => E.subscribeOverlay(() => { if (over.current) E.drawOverlay(over.current, zoom); }), [zoom]);

  const at = (e: React.PointerEvent) => {
    const r = over.current!.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  };
  const mods = (e: React.PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
  const cursor = E.ed.colorMode ? "copy" : E.RIG_TOOLS.includes(E.ed.tool) ? "default" : "crosshair";

  return (
    <div className="stage" ref={stage}>
      {d ? (
        <div className="view-wrap checker" style={{ width: N * zoom, height: N * zoom }}>
          <canvas ref={view} className="view" aria-label={`${d.a.name} at ${N} by ${N} pixels`} />
          <canvas
            ref={over}
            className="overlay"
            style={{ cursor }}
            onPointerDown={(e) => { if (e.button !== 0) return; over.current!.setPointerCapture(e.pointerId); E.pointerDown(at(e), mods(e)); }}
            onPointerMove={(e) => E.pointerMove(at(e), mods(e))}
            onPointerUp={() => E.pointerUp()}
            onPointerCancel={() => E.pointerUp()}
            onPointerLeave={() => { if (!E.isDragging()) E.pointerLeave(); }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A small canvas showing one indexed sprite at a whole-number zoom. */
export function SpriteCanvas(props: { idx: Int16Array; N: number; box: number; pal?: number[][]; label?: string; fit?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const z = Math.max(1, Math.floor(props.box / props.N));
  useEffect(() => { if (ref.current) E.drawIdx(ref.current, props.idx, props.N, z, false, null, props.pal); });
  return <canvas ref={ref} className="pixel" aria-label={props.label} style={props.fit ? { width: props.box, height: props.box } : undefined} />;
}
