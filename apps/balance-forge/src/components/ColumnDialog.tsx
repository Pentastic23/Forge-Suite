import { useEffect, useState } from "react";
import { Button, Card } from "@forge/ui";
import { api, type Column, type ColumnKind } from "../api";
import { isValidKey, uniqueKey } from "../analysis";

const KINDS: { kind: ColumnKind; label: string; hint: string }[] = [
  { kind: "number", label: "Number", hint: "A stat you type in, like health or cost." },
  { kind: "formula", label: "Formula", hint: "Worked out from other columns, like damage × attack speed." },
  { kind: "text", label: "Text", hint: "A label, like a role or faction. Not used in charts." },
];

/** Adds or edits one column. `column` undefined means a new column. */
export function ColumnDialog(props: {
  column?: Column;
  columns: Column[];
  onSave: (col: Column) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const editing = props.column;
  const [name, setName] = useState(editing?.name ?? "");
  const [key, setKey] = useState(editing?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(!!editing);
  const [kind, setKind] = useState<ColumnKind>(editing?.kind ?? "number");
  const [formula, setFormula] = useState(editing?.formula ?? "");
  const [decimals, setDecimals] = useState(editing?.decimals ?? null);
  const [check, setCheck] = useState<{ ok: boolean; text: string }>();

  useEffect(() => {
    if (!keyTouched) setKey(name.trim() ? uniqueKey(name, props.columns) : "");
  }, [name, keyTouched, props.columns]);

  useEffect(() => {
    if (kind !== "formula" || !formula.trim()) { setCheck(undefined); return; }
    const t = setTimeout(() => {
      api.checkFormula(formula).then(
        (refs) => {
          const known = new Set(props.columns.flatMap((c) => [c.key.toLowerCase(), c.name.trim().toLowerCase()]));
          known.add(key.toLowerCase());
          const unknown = refs.filter((r) => !known.has(r.trim().toLowerCase()));
          if (unknown.length) setCheck({ ok: false, text: `No column called ${unknown.map((u) => `"${u}"`).join(", ")}` });
          else if (refs.some((r) => r.trim().toLowerCase() === key.toLowerCase() || r.trim().toLowerCase() === name.trim().toLowerCase())) setCheck({ ok: false, text: "A formula can't use its own column" });
          else setCheck({ ok: true, text: refs.length ? `Uses ${refs.join(", ")}` : "Looks good" });
        },
        (e) => setCheck({ ok: false, text: String(e) }),
      );
    }, 200);
    return () => clearTimeout(t);
  }, [formula, kind, key, name, props.columns]);

  const others = props.columns.filter((c) => c.key !== editing?.key);
  const keyProblem = !key ? "Needs a key" : !isValidKey(key) ? "Letters, digits and _ only, not starting with a digit"
    : key.toLowerCase() === "name" ? "\"name\" is the row name" : others.some((c) => c.key.toLowerCase() === key.toLowerCase()) ? "Another column uses this key" : null;
  const canSave = name.trim() && !keyProblem && (kind !== "formula" || formula.trim());

  const submit = () => {
    if (!canSave) return;
    props.onSave({ key, name: name.trim(), kind, formula: kind === "formula" ? formula.trim() : null, decimals });
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" role="dialog" aria-label={editing ? "Edit column" : "Add column"}>
        <Card>
          <h3>{editing ? `Edit "${editing.name}"` : "Add a column"}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="row2">
              <label className="field"><span>Name</span>
                <input className="forge-input" autoFocus value={name} placeholder="Attack speed" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </label>
              <label className="field"><span>Key for formulas</span>
                <input className="forge-input mono" value={key} placeholder="attackSpeed" onChange={(e) => { setKey(e.target.value.trim()); setKeyTouched(true); }} />
                {keyProblem && name.trim() && <small className="bad-text">{keyProblem}</small>}
              </label>
            </div>
            <div className="field"><span>Type</span>
              <div className="kind-pick" role="radiogroup">
                {KINDS.map((k) => (
                  <button key={k.kind} role="radio" aria-checked={kind === k.kind} onClick={() => setKind(k.kind)}>
                    <b>{k.label}</b><small>{k.hint}</small>
                  </button>
                ))}
              </div>
            </div>
            {kind === "formula" && (
              <label className="field"><span>Formula</span>
                <textarea className="forge-input mono" rows={2} value={formula} placeholder="damage * attackSpeed" onChange={(e) => setFormula(e.target.value)} />
                {check && <small className={check.ok ? "muted" : "bad-text"}>{check.text}</small>}
                <small className="muted">
                  Use other columns by key, or by name in brackets like <code>[Attack speed]</code>. Operators: + − × ÷ ^ and comparisons.
                  Functions: min, max, avg, sum, clamp, abs, round, floor, ceil, sqrt, pow, log, exp, if(test, then, else).
                </small>
              </label>
            )}
            {kind !== "text" && (
              <label className="field" style={{ maxWidth: 200 }}><span>Decimal places</span>
                <select className="forge-input" value={decimals ?? ""} onChange={(e) => setDecimals(e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">Automatic</option>
                  {[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {props.onDelete && <Button variant="ghost" className="danger" onClick={props.onDelete}>Delete column</Button>}
            <span style={{ flex: 1 }} />
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canSave} onClick={submit}>{editing ? "Save" : "Add column"}</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
