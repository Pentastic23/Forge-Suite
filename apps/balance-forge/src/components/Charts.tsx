// Small hand-drawn SVG charts. Colours come from CSS variables in balance.css.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { compact, fmt, pct, signedPct, ticks, type CurveLevel, type Fit, type Judged, type Point } from "../analysis";

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const M = { top: 16, right: 20, bottom: 44, left: 60 };

function scale(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

function Axes(props: { w: number; h: number; xt: number[]; yt: number[]; x: (v: number) => number; y: (v: number) => number; xLabel: string; yLabel: string }) {
  const { w, h, xt, yt, x, y } = props;
  return (
    <g className="axes">
      {yt.map((t) => (
        <g key={`y${t}`}>
          <line className="grid" x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} />
          <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{compact(t)}</text>
        </g>
      ))}
      {xt.map((t) => (
        <text key={`x${t}`} x={x(t)} y={h - M.bottom + 18} textAnchor="middle">{compact(t)}</text>
      ))}
      <line className="axis" x1={M.left} x2={w - M.right} y1={h - M.bottom} y2={h - M.bottom} />
      <text className="axis-label" x={(M.left + w - M.right) / 2} y={h - 6} textAnchor="middle">{props.xLabel}</text>
      <text className="axis-label" transform={`translate(14 ${(M.top + h - M.bottom) / 2}) rotate(-90)`} textAnchor="middle">{props.yLabel}</text>
    </g>
  );
}

function Tip(props: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(props.x + 12, 0), props.w - 220);
  return <div className="chart-tip" style={{ left, top: Math.max(props.y - 12, 0) }}>{props.children}</div>;
}

/** Marker shape per verdict, so the flag never relies on colour alone. */
function Mark(props: { x: number; y: number; verdict: "strong" | "weak" | "ok" | "jump" | "dip"; active?: boolean }) {
  const r = props.active ? 6 : 4.5;
  const cls = `mark ${props.verdict}`;
  if (props.verdict === "strong" || props.verdict === "jump") {
    const s = r * 1.35;
    return <path className={cls} d={`M${props.x},${props.y - s} L${props.x + s},${props.y + s * 0.8} L${props.x - s},${props.y + s * 0.8} Z`} />;
  }
  if (props.verdict === "weak" || props.verdict === "dip") {
    const s = r * 1.35;
    return <path className={cls} d={`M${props.x},${props.y + s} L${props.x + s},${props.y - s * 0.8} L${props.x - s},${props.y - s * 0.8} Z`} />;
  }
  return <circle className={cls} cx={props.x} cy={props.y} r={r} />;
}

export function Legend(props: { items: { label: string; shape: "dot" | "up" | "down" | "line" | "band"; tone?: string }[] }) {
  return (
    <div className="legend">
      {props.items.map((i) => (
        <span key={i.label}>
          <svg width="16" height="12" aria-hidden="true">
            {i.shape === "dot" && <circle className={`mark ${i.tone ?? "ok"}`} cx="8" cy="6" r="4" />}
            {i.shape === "up" && <path className={`mark ${i.tone ?? "strong"}`} d="M8,1 L14,11 L2,11 Z" />}
            {i.shape === "down" && <path className={`mark ${i.tone ?? "weak"}`} d="M8,11 L14,1 L2,1 Z" />}
            {i.shape === "line" && <line className={i.tone ?? "trend"} x1="1" x2="15" y1="6" y2="6" />}
            {i.shape === "band" && <rect className="band" x="1" y="1" width="14" height="10" rx="2" />}
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ScatterChart(props: { rows: Judged[]; fit: Fit | null; xLabel: string; yLabel: string; selected?: string; onSelect?: (id: string) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Judged>();
  const h = 340;
  const xs = props.rows.map((r) => r.x), ys = props.rows.map((r) => r.y);
  const xt = ticks(Math.min(0, ...xs), Math.max(...xs));
  const yt = ticks(Math.min(0, ...ys), Math.max(...ys));
  const x = scale(xt[0], xt[xt.length - 1], M.left, w - M.right);
  const y = scale(yt[0], yt[yt.length - 1], h - M.bottom, M.top);
  const fit = props.fit;
  const clampY = (v: number) => Math.min(Math.max(v, yt[0]), yt[yt.length - 1]);
  // Flagged rows get a name label; the rest rely on hover and the table.
  const labelled = new Set([...props.rows].filter((r) => r.verdict !== "ok").sort((a, b) => Math.abs(b.off) - Math.abs(a.off)).slice(0, 8).map((r) => r.id));
  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={`${props.yLabel} against ${props.xLabel}`}>
        <Axes w={w} h={h} xt={xt} yt={yt} x={x} y={y} xLabel={props.xLabel} yLabel={props.yLabel} />
        {fit && (
          <line className="trend" x1={x(xt[0])} y1={y(clampY(fit.slope * xt[0] + fit.intercept))} x2={x(xt[xt.length - 1])} y2={y(clampY(fit.slope * xt[xt.length - 1] + fit.intercept))} />
        )}
        {props.rows.map((r) => (
          <g key={r.id} className="hit" onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(undefined)} onClick={() => props.onSelect?.(r.id)}>
            <circle cx={x(r.x)} cy={y(r.y)} r={11} fill="transparent" />
            <Mark x={x(r.x)} y={y(r.y)} verdict={r.verdict} active={hover?.id === r.id || props.selected === r.id} />
            {labelled.has(r.id) && <text className="point-label" x={x(r.x) + 9} y={y(r.y) - 8}>{r.name}</text>}
          </g>
        ))}
      </svg>
      {hover && (
        <Tip x={x(hover.x)} y={y(hover.y)} w={w}>
          <b>{hover.name}</b>
          <div>{props.xLabel}: {fmt(hover.x)}</div>
          <div>{props.yLabel}: {fmt(hover.y)}</div>
          <div className="muted">Trend expects {fmt(hover.expected)} ({signedPct(hover.off)})</div>
        </Tip>
      )}
    </div>
  );
}

/** Rows as small dots, with a line through the median of each level. */
export function CurveChart(props: { levels: CurveLevel[]; points: Point[]; xLabel: string; yLabel: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<CurveLevel>();
  const h = 300;
  const xs = props.levels.map((r) => r.x), ys = props.points.map((r) => r.y);
  const xt = ticks(Math.min(...xs), Math.max(...xs));
  const yt = ticks(Math.min(0, ...ys), Math.max(...ys));
  const x = scale(xt[0], xt[xt.length - 1], M.left, w - M.right);
  const y = scale(yt[0], yt[yt.length - 1], h - M.bottom, M.top);
  const d = props.levels.map((r, i) => `${i ? "L" : "M"}${x(r.x)},${y(r.y)}`).join(" ");
  const many = props.points.length > props.levels.length;
  const levelName = (l: CurveLevel) => (l.names.length === 1 ? l.names[0] : `${props.xLabel} ${fmt(l.x)}`);
  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={`${props.yLabel} by ${props.xLabel}`}>
        <Axes w={w} h={h} xt={xt} yt={yt} x={x} y={y} xLabel={props.xLabel} yLabel={props.yLabel} />
        {many && props.points.map((p) => <circle key={p.id} className="dot-faint" cx={x(p.x)} cy={y(p.y)} r={3} />)}
        <path className="series" d={d} />
        {props.levels.map((l) => (
          <g key={l.x} className="hit" onMouseEnter={() => setHover(l)} onMouseLeave={() => setHover(undefined)}>
            <circle cx={x(l.x)} cy={y(l.y)} r={12} fill="transparent" />
            <Mark x={x(l.x)} y={y(l.y)} verdict={l.flag ?? "ok"} active={hover?.x === l.x} />
            {l.flag && <text className="point-label" x={x(l.x) + 9} y={y(l.y) - 9}>{levelName(l)}</text>}
          </g>
        ))}
      </svg>
      {hover && (
        <Tip x={x(hover.x)} y={y(hover.y)} w={w}>
          <b>{props.xLabel} {fmt(hover.x)}</b>
          <div>{many ? "Median " : ""}{props.yLabel}: {fmt(hover.y)}</div>
          {hover.growth !== null && <div className="muted">{signedPct(hover.growth - 1)} on the level before</div>}
          {hover.names.length > 1 && <div className="muted">{hover.names.length} rows: {hover.names.slice(0, 4).join(", ")}{hover.names.length > 4 ? "…" : ""}</div>}
        </Tip>
      )}
    </div>
  );
}

export function BandChart(props: { steps: number[]; p10: number[]; p50: number[]; p90: number[]; xLabel: string; yLabel: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number>();
  const h = 320;
  const { steps, p10, p50, p90 } = props;
  const xt = ticks(steps[0] ?? 0, steps[steps.length - 1] ?? 1);
  const yt = ticks(Math.min(0, ...p10), Math.max(...p90));
  const x = scale(xt[0], xt[xt.length - 1], M.left, w - M.right);
  const y = scale(yt[0], yt[yt.length - 1], h - M.bottom, M.top);
  const band = steps.map((s, i) => `${i ? "L" : "M"}${x(s)},${y(p90[i])}`).join(" ") + " " + steps.map((s, i) => `L${x(s)},${y(p10[i])}`).reverse().join(" ") + " Z";
  const mid = steps.map((s, i) => `${i ? "L" : "M"}${x(s)},${y(p50[i])}`).join(" ");
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + M.left;
    let best = 0;
    for (let i = 1; i < steps.length; i++) if (Math.abs(x(steps[i]) - px) < Math.abs(x(steps[best]) - px)) best = i;
    setHover(best);
  };
  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={`${props.yLabel} over ${props.xLabel}`}>
        <Axes w={w} h={h} xt={xt} yt={yt} x={x} y={y} xLabel={props.xLabel} yLabel={props.yLabel} />
        <path className="band" d={band} />
        <path className="series" d={mid} />
        {hover !== undefined && (
          <>
            <line className="crosshair" x1={x(steps[hover])} x2={x(steps[hover])} y1={M.top} y2={h - M.bottom} />
            <circle className="mark ok" cx={x(steps[hover])} cy={y(p50[hover])} r={5} />
          </>
        )}
        <rect x={M.left} y={M.top} width={w - M.left - M.right} height={h - M.top - M.bottom} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} />
      </svg>
      {hover !== undefined && (
        <Tip x={x(steps[hover])} y={y(p90[hover])} w={w}>
          <b>{props.xLabel} {steps[hover]}</b>
          <div>Typical: {fmt(p50[hover])}</div>
          <div className="muted">Middle 80%: {fmt(p10[hover])} to {fmt(p90[hover])}</div>
        </Tip>
      )}
    </div>
  );
}

/** Win-rate grid: each cell is how often the row beats the column. */
export function Heatmap(props: { names: string[]; rates: number[][] }) {
  const n = props.names.length;
  const cell = n > 24 ? 22 : n > 14 ? 30 : 44;
  const label = Math.min(160, Math.max(...props.names.map((s) => s.length)) * 7 + 12);
  const showText = cell >= 30;
  const color = (v: number) => {
    // Diverging: blue when the row wins, orange when it loses, grey at even.
    const t = Math.min(1, Math.abs(v - 0.5) * 2);
    const pole = v >= 0.5 ? "var(--div-win)" : "var(--div-lose)";
    return `color-mix(in srgb, ${pole} ${Math.round(t * 100)}%, var(--div-mid))`;
  };
  return (
    <div className="heatmap-wrap">
      <table className="heatmap" style={{ ["--cell" as string]: `${cell}px` }}>
        <thead>
          <tr>
            <th style={{ width: label }} />
            {props.names.map((nm, j) => <th key={j} className="col-head" title={nm}><span>{nm}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {props.names.map((nm, i) => (
            <tr key={i}>
              <th className="row-head" title={nm}>{nm}</th>
              {props.rates[i].map((v, j) => (
                <td key={j} style={{ background: i === j ? "transparent" : color(v) }} title={i === j ? undefined : `${nm} beats ${props.names[j]} ${pct(v)} of the time`}>
                  {i !== j && showText ? Math.round(v * 100) : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
