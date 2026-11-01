import { useEffect, useRef, useState } from "react";
import { duration, fileUrl, previewKind, type AssetSummary } from "../api";

const ZOOMS = [0, 1, 2, 4, 8] as const; // 0 = fit

/** Full preview of one asset: zoomable pixel-perfect images, sprite-sheet playback, audio and video. */
export function Preview(props: { asset: AssetSummary }) {
  const a = props.asset;
  const kind = previewKind(a);
  const [zoom, setZoom] = useState<number>(0);
  const [sheet, setSheet] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setZoom(0); setSheet(false); setBroken(false); }, [a.id]);

  if (a.missing) return <div className="preview empty"><span className="bad-text">The file is missing</span></div>;
  if (kind === "audio") {
    return (
      <div className="preview audio">
        <div className="glyph" aria-hidden="true">♪</div>
        <audio controls preload="metadata" src={fileUrl(a.path)} style={{ width: "100%" }} />
        {a.durationMs ? <span className="muted small">{duration(a.durationMs)}</span> : null}
      </div>
    );
  }
  if (kind === "video") return <div className="preview"><video controls preload="metadata" src={fileUrl(a.path)} style={{ maxWidth: "100%", maxHeight: 280 }} /></div>;
  if (kind !== "image" || broken) {
    return <div className="preview empty"><span className="ext-badge big">{a.ext.toUpperCase() || "FILE"}</span><span className="muted small">No preview for this file type</span></div>;
  }
  const w = a.width ?? 0, h = a.height ?? 0;
  const canSheet = w > 0 && h > 0 && (w >= h * 2 || h >= w * 2);
  // Small pixel art fits the box at a whole-number scale, so pixels stay square.
  const fit = w && h && w <= 128 && h <= 128 ? Math.max(1, Math.floor(Math.min(280 / w, 240 / h))) : 0;
  return (
    <div>
      <div className={`preview checker ${zoom ? "scroll" : ""}`}>
        {sheet ? (
          <SheetPlayer asset={a} />
        ) : (
          <img
            src={fileUrl(a.path)}
            alt={a.name}
            onError={() => setBroken(true)}
            className={w && w <= 256 ? "pixelated" : undefined}
            style={zoom ? { width: w * zoom, height: h * zoom, maxWidth: "none", maxHeight: "none" } : fit ? { width: w * fit, height: h * fit } : { maxWidth: "100%", maxHeight: 260 }}
          />
        )}
      </div>
      <div className="preview-bar">
        {!sheet && (
          <div className="seg small-seg" role="group" aria-label="Zoom">
            {ZOOMS.map((z) => <button key={z} aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z ? `${z}×` : "Fit"}</button>)}
          </div>
        )}
        {canSheet && <label className="check"><input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Play as sprite sheet</label>}
      </div>
    </div>
  );
}

/** Plays a horizontal or vertical strip (or a grid) of frames. */
function SheetPlayer(props: { asset: AssetSummary }) {
  const a = props.asset;
  const w = a.width ?? 1, h = a.height ?? 1;
  const horizontal = w >= h;
  const [fw, setFw] = useState(horizontal ? h : w);
  const [fh, setFh] = useState(horizontal ? h : w);
  const [fps, setFps] = useState(10);
  const cols = Math.max(1, Math.floor(w / Math.max(1, fw)));
  const rows = Math.max(1, Math.floor(h / Math.max(1, fh)));
  const frames = cols * rows;
  const urls = useRef<string>(fileUrl(a.path));
  return (
    <div className="sheet-player">
      <FramePlayer frames={Array.from({ length: frames }, (_, i) => ({ url: urls.current, sx: (i % cols) * fw, sy: Math.floor(i / cols) * fh, sw: fw, sh: fh }))} fps={fps} />
      <div className="sheet-controls">
        <label>Frame <input className="forge-input tiny" type="number" min={1} value={fw} onChange={(e) => setFw(Math.max(1, Number(e.target.value) || 1))} aria-label="Frame width" />
          × <input className="forge-input tiny" type="number" min={1} value={fh} onChange={(e) => setFh(Math.max(1, Number(e.target.value) || 1))} aria-label="Frame height" /></label>
        <label><input className="forge-input tiny" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.min(60, Math.max(1, Number(e.target.value) || 1)))} aria-label="Frames per second" /> fps</label>
        <span className="muted small">{frames} frames</span>
      </div>
    </div>
  );
}

export interface Frame { url: string; sx?: number; sy?: number; sw?: number; sh?: number }

/** Draws frames on a canvas at a steady rate, scaled up without blurring. */
export function FramePlayer(props: { frames: Frame[]; fps: number; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);
  const images = useRef<Map<string, HTMLImageElement>>(new Map());
  const box = props.size ?? 220;

  useEffect(() => {
    for (const f of props.frames) {
      if (!images.current.has(f.url)) {
        const img = new Image();
        img.src = f.url;
        images.current.set(f.url, img);
      }
    }
  }, [props.frames]);

  useEffect(() => {
    if (!playing || props.frames.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % props.frames.length), 1000 / props.fps);
    return () => clearInterval(t);
  }, [playing, props.fps, props.frames.length]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      const f = props.frames[index % Math.max(1, props.frames.length)];
      const img = f && images.current.get(f.url);
      if (!c || !img) return;
      if (!img.complete) { raf = requestAnimationFrame(draw); return; }
      const sw = f.sw ?? img.naturalWidth, sh = f.sh ?? img.naturalHeight;
      const scale = Math.max(1, Math.floor(Math.min(box / sw, box / sh))) || 1;
      c.width = sw * scale;
      c.height = sh * scale;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, f.sx ?? 0, f.sy ?? 0, sw, sh, 0, 0, sw * scale, sh * scale);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [index, props.frames, box]);

  return (
    <div className="frame-player">
      <canvas ref={canvas} aria-label="Animation preview" />
      <div className="frame-controls">
        <button className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
        <button className="icon-btn" disabled={playing} onClick={() => setIndex((i) => (i - 1 + props.frames.length) % props.frames.length)} aria-label="Previous frame">◀</button>
        <button className="icon-btn" disabled={playing} onClick={() => setIndex((i) => (i + 1) % props.frames.length)} aria-label="Next frame">▶▏</button>
        <span className="muted small">Frame {(index % Math.max(1, props.frames.length)) + 1} / {props.frames.length}</span>
      </div>
    </div>
  );
}

/** Small square thumbnail for grids and lists. */
export function Thumb(props: { asset: AssetSummary; size: number }) {
  const a = props.asset;
  const kind = previewKind(a);
  const [broken, setBroken] = useState(false);
  if (kind === "image" && !broken) {
    const small = (a.width ?? 999) <= props.size;
    return <img className={`thumb-img ${small ? "pixelated" : ""}`} src={fileUrl(a.path)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  }
  if (kind === "audio") return <span className="thumb-glyph" aria-hidden="true">♪{a.durationMs ? <small>{duration(a.durationMs)}</small> : null}</span>;
  return <span className="ext-badge">{a.ext.toUpperCase() || "FILE"}</span>;
}
