import { useEffect, useRef, useState } from "react";
import { api, type EntitySummary } from "../api";
import { MODULE_BY_KIND, type Kind } from "../modules";

/** Chips for linked entries plus a search box to add more. */
export function LinkPicker(props: {
  to: Kind[];
  selected: string[];
  names: Record<string, [string, Kind]>;
  excludeId?: string;
  onChange: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<EntitySummary[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const toKey = props.to.join(",");
  const selKey = props.selected.join(",");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const kinds = toKey.split(",") as Kind[];
      const selected = new Set(selKey.split(","));
      const lists = await Promise.all(kinds.map((kind) => api.list({ kind, text: text || undefined, limit: 20 }).catch(() => [])));
      if (cancelled) return;
      setResults(lists.flat().filter((e) => e.id !== props.excludeId && !selected.has(e.id)).slice(0, 20));
      setActive(0);
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, open, toKey, selKey, props.excludeId]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const add = (id: string) => { props.onChange([...props.selected, id]); setText(""); };
  const target = props.to.map((k) => MODULE_BY_KIND[k].label.toLowerCase()).join(" or ");

  return (
    <div className="picker" ref={box}>
      {props.selected.length > 0 && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {props.selected.map((id) => (
            <span key={id} className="chip link" onClick={() => props.onOpen(id)} title="Open">
              {props.names[id]?.[0] ?? "Unknown entry"}
              <button aria-label="Remove link" onClick={(e) => { e.stopPropagation(); props.onChange(props.selected.filter((x) => x !== id)); }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input
        className="forge-input"
        style={{ width: "100%" }}
        placeholder={`Link ${target}…`}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && results[active]) { e.preventDefault(); add(results[active].id); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <div className="picker-menu">
          {results.length === 0 ? (
            <div className="muted" style={{ padding: "8px 10px" }}>No {target} found. Create them first, then link them here.</div>
          ) : (
            results.map((r, i) => (
              <button key={r.id} className={i === active ? "active" : undefined} onMouseDown={(e) => { e.preventDefault(); add(r.id); }}>
                <span>{r.name}</span>
                <span className="muted">{r.entityType || MODULE_BY_KIND[r.kind].singular}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
