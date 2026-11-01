import { Badge, Card } from "@forge/ui";
import type { EntitySummary } from "../api";
import { formatValue, type ModuleDef } from "../modules";

export function EntityTable(props: { mod: ModuleDef; rows: EntitySummary[]; selectedId?: string; onSelect: (id: string) => void }) {
  const cols = props.mod.columns.map((k) => props.mod.fields.find((f) => f.key === k)!);
  return (
    <div className="table-wrap">
      <table className="entity-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            {cols.map((c) => <th key={c.key}>{c.label}</th>)}
            <th>Tags</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r) => (
            <tr key={r.id} aria-selected={r.id === props.selectedId} onClick={() => props.onSelect(r.id)}>
              <td className="name" title={r.name}>{r.name}</td>
              <td>{r.entityType}</td>
              <td>{r.status}</td>
              {cols.map((c) => <td key={c.key}>{formatValue(r.fields[c.key], c)}</td>)}
              <td title={r.tags.join(", ")}>{r.tags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EntityCards(props: { mod: ModuleDef; rows: EntitySummary[]; selectedId?: string; onSelect: (id: string) => void }) {
  const cols = props.mod.columns.map((k) => props.mod.fields.find((f) => f.key === k)!);
  return (
    <div className="cards">
      {props.rows.map((r) => (
        <div key={r.id} onClick={() => props.onSelect(r.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && props.onSelect(r.id)}>
          <Card interactive className={r.id === props.selectedId ? "selected" : undefined}>
            <div className="entity-card">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {r.entityType && <Badge>{r.entityType}</Badge>}
                {r.status && <Badge tone={r.status === "Final" ? "good" : r.status === "Cut" ? "bad" : undefined}>{r.status}</Badge>}
              </div>
              <h4>{r.name}</h4>
              {r.summary && <p>{r.summary}</p>}
              <div className="stats">
                {cols.map((c) => {
                  const v = formatValue(r.fields[c.key], c);
                  return v ? <span key={c.key}>{c.label} <b>{v}</b></span> : null;
                })}
              </div>
              {r.tags.length > 0 && <div className="chips">{r.tags.map((t) => <span key={t} className="chip" style={{ paddingRight: 10 }}>{t}</span>)}</div>}
            </div>
          </Card>
        </div>
      ))}
    </div>
  );
}
