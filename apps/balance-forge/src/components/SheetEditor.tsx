import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, PageHeader } from "@forge/ui";
import type { Column, Computed, Row, Sheet } from "../api";
import { fmt, renameInFormula } from "../analysis";
import { ColumnDialog } from "./ColumnDialog";
import type { Notify } from "../App";

const KIND_MARK = { number: "#", text: "T", formula: "ƒ" } as const;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/** What a typed cell becomes: a number, text, or nothing. */
function parseCell(raw: string, col: Column): number | string | null {
  const t = raw.trim();
  if (!t) return null;
  if (col.kind === "number") {
    const n = Number(t.replace(/[,_\s]/g, ""));
    return Number.isFinite(n) ? n : t;
  }
  return t;
}

function Cell(props: { value: string; invalid?: boolean; align?: "right"; r: number; c: number; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(props.value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(props.value); }, [props.value, focused]);
  const move = (el: HTMLInputElement, dr: number) => {
    const next = el.closest("table")?.querySelector<HTMLInputElement>(`input[data-r="${props.r + dr}"][data-c="${props.c}"]`);
    next?.focus();
    next?.select();
  };
  return (
    <input
      className={["cell", props.align, props.invalid && "invalid"].filter(Boolean).join(" ")}
      value={draft}
      data-r={props.r}
      data-c={props.c}
      aria-label={props.label}
      title={props.invalid ? "Not a number, so formulas and charts skip it" : undefined}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); if (draft !== props.value) props.onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); if (draft !== props.value) props.onCommit(draft); move(e.currentTarget, e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { setDraft(props.value); e.currentTarget.blur(); }
        else if (e.key === "ArrowDown" && e.altKey) move(e.currentTarget, 1);
        else if (e.key === "ArrowUp" && e.altKey) move(e.currentTarget, -1);
      }}
    />
  );
}

type Sort = { key: string; dir: 1 | -1 } | null;

export function SheetEditor(props: {
  sheet: Sheet;
  computed?: Computed;
  saving: "saved" | "pending" | "saving" | "error";
  onChange: (s: Sheet) => void;
  onRename: () => void;
  onDelete: () => void;
  notify: Notify;
}) {
  const { sheet, computed, onChange } = props;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [dialog, setDialog] = useState<{ column?: Column } | null>(null);
  const [menu, setMenu] = useState(false);
  const focusNew = useRef<string>();

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let out = sheet.rows.map((r, i) => ({ r, i }));
    if (f) out = out.filter(({ r }) => r.name.toLowerCase().includes(f) || Object.values(r.values).some((v) => String(v ?? "").toLowerCase().includes(f)));
    if (sort) {
      const col = sheet.columns.find((c) => c.key === sort.key);
      const val = (r: Row): number | string | undefined =>
        sort.key === "name" ? r.name.toLowerCase() : col?.kind === "text" ? String(r.values[sort.key] ?? "").toLowerCase() : computed?.numbers[r.id]?.[sort.key];
      out.sort((a, b) => {
        const x = val(a.r), y = val(b.r);
        if (x === undefined || x === "") return 1;
        if (y === undefined || y === "") return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return out;
  }, [sheet, computed, filter, sort]);

  useEffect(() => {
    if (!focusNew.current) return;
    const el = document.querySelector<HTMLInputElement>(`input[data-row-name="${focusNew.current}"]`);
    focusNew.current = undefined;
    el?.focus();
  });

  const setRow = (id: string, change: (r: Row) => Row) => onChange({ ...sheet, rows: sheet.rows.map((r) => (r.id === id ? change(r) : r)) });
  const setValue = (row: Row, col: Column, raw: string) => setRow(row.id, (r) => {
    const values = { ...r.values };
    const v = parseCell(raw, col);
    if (v === null) delete values[col.key]; else values[col.key] = v;
    return { ...r, values };
  });
  const addRow = () => {
    const id = newId();
    focusNew.current = id;
    setFilter("");
    onChange({ ...sheet, rows: [...sheet.rows, { id, sourceId: null, name: "", values: {} }] });
  };
  const duplicateRow = (row: Row) => {
    const id = newId();
    const i = sheet.rows.findIndex((r) => r.id === row.id);
    const copy = { ...row, id, sourceId: null, name: `${row.name} copy`, values: { ...row.values } };
    onChange({ ...sheet, rows: [...sheet.rows.slice(0, i + 1), copy, ...sheet.rows.slice(i + 1)] });
  };
  const deleteRow = (row: Row) => {
    if (row.sourceId && !window.confirm(`"${row.name}" came from Forge Core. Delete it here? Importing again will add it back.`)) return;
    onChange({ ...sheet, rows: sheet.rows.filter((r) => r.id !== row.id) });
  };

  const saveColumn = (col: Column) => {
    const old = dialog?.column;
    let columns: Column[];
    let rowsNext = sheet.rows;
    if (!old) {
      columns = [...sheet.columns, col];
    } else {
      columns = sheet.columns.map((c) => (c.key === old.key ? col : c));
      if (old.key !== col.key) {
        columns = columns.map((c) => (c.formula ? { ...c, formula: renameInFormula(c.formula, old.key, col.key) } : c));
      }
      if (old.key !== col.key || col.kind === "formula") {
        rowsNext = sheet.rows.map((r) => {
          if (!(old.key in r.values)) return r;
          const values = { ...r.values };
          const v = values[old.key];
          delete values[old.key];
          if (col.kind !== "formula") values[col.key] = v;
          return { ...r, values };
        });
      }
      if (sort?.key === old.key) setSort(null);
    }
    onChange({ ...sheet, columns, rows: rowsNext });
    setDialog(null);
  };

  const deleteColumn = (col: Column) => {
    const users = sheet.columns.filter((c) => c.formula && renameInFormula(c.formula, col.key, "\u0000") !== c.formula);
    const extra = users.length ? ` ${users.map((u) => u.name).join(", ")} use${users.length === 1 ? "s" : ""} it and will show an error.` : "";
    if (!window.confirm(`Delete the column "${col.name}" and its values?${extra}`)) return;
    onChange({
      ...sheet,
      columns: sheet.columns.filter((c) => c.key !== col.key),
      rows: sheet.rows.map((r) => {
        if (!(col.key in r.values)) return r;
        const values = { ...r.values };
        delete values[col.key];
        return { ...r, values };
      }),
    });
    setDialog(null);
  };

  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));

  const colErrors = computed?.columnErrors ?? {};
  const errorCount = Object.keys(colErrors).length;
  const saveText = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…", error: "Not saved" }[props.saving];
  const sub = `${sheet.rows.length} ${sheet.rows.length === 1 ? "row" : "rows"}${sheet.sourceKind ? ` · from Forge Core ${sheet.sourceKind} entries` : ""}`;

  const header = (key: string, label: string, mark?: string, col?: Column) => (
    <th key={key} className={col && col.kind !== "text" ? "num" : undefined} aria-sort={sort?.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <div className="th">
        <button className="th-sort" title={col?.formula ? `${col.key} = ${col.formula}` : col ? `Key: ${col.key}` : undefined} onClick={() => toggleSort(key)}>
          {mark && <span className={`kind-mark ${col?.kind}`}>{mark}</span>}
          <span>{label}</span>
          {sort?.key === key && <span className="muted">{sort.dir === 1 ? "▲" : "▼"}</span>}
          {colErrors[key] && <span className="bad-text" title={colErrors[key]}>⚠</span>}
        </button>
        {col && <button className="th-edit" aria-label={`Edit column ${label}`} title="Edit column" onClick={() => setDialog({ column: col })}>⋯</button>}
      </div>
    </th>
  );

  return (
    <div className="sheet-page">
      <PageHeader
        title={sheet.name}
        subtitle={sub}
        actions={
          <>
            <span className={`save-state ${props.saving === "error" ? "bad-text" : ""}`} aria-live="polite">{saveText}</span>
            <Button onClick={() => setDialog({})}>Add column</Button>
            <Button variant="primary" onClick={addRow}>Add row</Button>
            <div style={{ position: "relative" }}>
              <Button variant="ghost" aria-label="More" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</Button>
              {menu && (
                <div className="picker-menu" role="menu" style={{ left: "auto", right: 0, width: 180 }} onMouseLeave={() => setMenu(false)}>
                  <button role="menuitem" onClick={() => { setMenu(false); props.onRename(); }}>Rename sheet</button>
                  <button role="menuitem" className="bad-text" onClick={() => { setMenu(false); props.onDelete(); }}>Delete sheet</button>
                </div>
              )}
            </div>
          </>
        }
      />
      <div className="toolbar">
        <input className="forge-input search" placeholder="Filter rows" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {errorCount > 0 && <Badge tone="bad">{errorCount} {errorCount === 1 ? "formula needs" : "formulas need"} fixing</Badge>}
        <span className="muted hint">Enter moves down · Esc undoes the cell · click a header to sort</span>
      </div>
      {errorCount > 0 && (
        <ul className="col-errors">
          {Object.entries(colErrors).map(([k, msg]) => {
            const col = sheet.columns.find((c) => c.key === k);
            return <li key={k}><button className="link" onClick={() => col && setDialog({ column: col })}>{col?.name ?? k}</button>: {msg}</li>;
          })}
        </ul>
      )}
      <div className="table-wrap sheet-wrap">
        <table className="sheet">
          <thead>
            <tr>
              {header("name", "Name")}
              {sheet.columns.map((c) => header(c.key, c.name, KIND_MARK[c.kind], c))}
              <th className="actions-col"><button className="th-add" onClick={() => setDialog({})} title="Add column" aria-label="Add column">+</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r }, ri) => (
              <tr key={r.id}>
                <td className="name-cell">
                  {r.sourceId && <span className="src-dot" title="Imported from Forge Core" />}
                  <input className="cell name" value={r.name} placeholder="Unnamed" data-row-name={r.id} data-r={ri} data-c={-1} aria-label="Row name"
                    onChange={(e) => setRow(r.id, (x) => ({ ...x, name: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (ri === rows.length - 1 && !e.shiftKey) addRow();
                      else e.currentTarget.closest("table")?.querySelector<HTMLInputElement>(`input[data-r="${ri + (e.shiftKey ? -1 : 1)}"][data-c="-1"]`)?.focus();
                    }} />
                </td>
                {sheet.columns.map((c, ci) => {
                  if (c.kind === "formula") {
                    const err = computed?.cellErrors[r.id]?.[c.key] ?? (colErrors[c.key] ? "Fix the formula first" : undefined);
                    const v = computed?.numbers[r.id]?.[c.key];
                    return (
                      <td key={c.key} className="num formula-cell" title={err}>
                        {err ? <span className="cell-error">⚠ {err.length > 22 ? "error" : err}</span> : fmt(v, c.decimals)}
                      </td>
                    );
                  }
                  const raw = r.values[c.key];
                  const text = raw === undefined || raw === null ? "" : String(raw);
                  const invalid = c.kind === "number" && text !== "" && !Number.isFinite(Number(text));
                  return (
                    <td key={c.key} className={c.kind === "number" ? "num" : undefined}>
                      <Cell value={text} invalid={invalid} align={c.kind === "number" ? "right" : undefined} r={ri} c={ci} label={`${r.name || "Row"} ${c.name}`} onCommit={(v) => setValue(r, c, v)} />
                    </td>
                  );
                })}
                <td className="row-actions">
                  <button title="Duplicate row" aria-label={`Duplicate ${r.name}`} onClick={() => duplicateRow(r)}>⧉</button>
                  <button title="Delete row" aria-label={`Delete ${r.name}`} onClick={() => deleteRow(r)}>×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={sheet.columns.length + 2} className="muted" style={{ padding: 24, textAlign: "center" }}>
                {filter ? "No rows match the filter." : "No rows yet. Add one, or import entries from Forge Core."}
              </td></tr>
            )}
          </tbody>
        </table>
        <button className="add-row" onClick={addRow}>+ Add row</button>
      </div>
      {dialog && (
        <ColumnDialog
          column={dialog.column}
          columns={sheet.columns}
          onSave={saveColumn}
          onDelete={dialog.column ? () => deleteColumn(dialog.column!) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
