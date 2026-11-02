import { useId, type ReactNode } from "react";
import { S, setSetting } from "../engine/editor";

/** Controls bound to one conversion setting. They read S on every render, so they follow undo and loaded profiles. */
export function Range(props: { k: string; label: string; min: number; max: number; step?: number; unit?: string; hint?: string }) {
  const id = useId();
  const v = Number(S[props.k] ?? 0);
  return (
    <div className="ctl range" title={props.hint}>
      <label htmlFor={id}>{props.label}</label>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={v}
        onChange={(e) => setSetting(props.k, +e.target.value)} />
      <output htmlFor={id}>{v}{props.unit ?? ""}</output>
    </div>
  );
}

export function Pick(props: { k: string; label: string; options: [string | number, string][]; numeric?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="ctl" title={props.hint}>
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="forge-input" value={String(S[props.k])}
        onChange={(e) => setSetting(props.k, props.numeric ? +e.target.value : e.target.value)}>
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export function Check(props: { k: string; label: string; text: string }) {
  const id = useId();
  return (
    <div className="ctl">
      <span className="ctl-label">{props.label}</span>
      <label className="check" htmlFor={id}>
        <input id={id} type="checkbox" checked={!!S[props.k]} onChange={(e) => setSetting(props.k, e.target.checked)} />
        {props.text}
      </label>
    </div>
  );
}

export function Color(props: { k: string; label: string; note?: string }) {
  const id = useId();
  return (
    <div className="ctl">
      <label htmlFor={id}>{props.label}</label>
      <span className="inline">
        <input id={id} type="color" className="swatch-input" value={String(S[props.k] ?? "#000000")} onChange={(e) => setSetting(props.k, e.target.value)} />
        {props.note && <span className="hint">{props.note}</span>}
      </span>
    </div>
  );
}

export function Section(props: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-sec">
      <div className="panel-sec-head"><h3>{props.title}</h3>{props.actions}</div>
      {props.children}
    </section>
  );
}

export const Hint = (props: { children: ReactNode }) => <p className="hint">{props.children}</p>;

/** A row of toggle buttons, one pressed. */
export function Seg<T extends string | number>(props: { value: T; options: [T, string, string?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map(([v, l, tip]) => (
        <button key={String(v)} aria-pressed={props.value === v} title={tip} onClick={() => props.onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
