import type { ReactNode } from "react";

export function Field(props: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="lbl">{props.label}</span>
      {props.children}
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export function Select<T extends string | number>(props: { value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <select className="forge-input" value={String(props.value)} disabled={props.disabled}
      onChange={(e) => props.onChange(props.options.find(([k]) => String(k) === e.target.value)![0])}>
      {props.options.map(([k, label]) => <option key={String(k)} value={String(k)}>{label}</option>)}
    </select>
  );
}

export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map(([k, l]) => <button key={k} aria-pressed={props.value === k} onClick={() => props.onChange(k)}>{l}</button>)}
    </div>
  );
}
