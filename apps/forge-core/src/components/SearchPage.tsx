import { useEffect, useState } from "react";
import { Card, EmptyState, PageHeader } from "@forge/ui";
import { api, type EntitySummary } from "../api";
import { MODULES } from "../modules";

export function SearchPage(props: { initialTag?: string; onOpen: (e: EntitySummary) => void }) {
  const [text, setText] = useState("");
  const [tag, setTag] = useState(props.initialTag ?? "");
  const [tags, setTags] = useState<[string, number][]>([]);
  const [results, setResults] = useState<EntitySummary[]>([]);

  useEffect(() => { setTag(props.initialTag ?? ""); }, [props.initialTag]);
  useEffect(() => { api.tags().then(setTags).catch(() => setTags([])); }, []);
  useEffect(() => {
    if (!text.trim() && !tag) { setResults([]); return; }
    const t = setTimeout(() => api.list({ text: text || undefined, tag: tag || undefined, limit: 300 }).then(setResults).catch(() => setResults([])), 150);
    return () => clearTimeout(t);
  }, [text, tag]);

  return (
    <>
      <PageHeader title="Search" subtitle="Searches names, summaries, descriptions, tags and field values across every module." />
      <div className="toolbar">
        <input className="forge-input search" autoFocus placeholder="Type to search, e.g. dragon or fire" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="forge-input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">Any tag</option>
          {tags.map(([t, n]) => <option key={t} value={t}>{t} ({n})</option>)}
        </select>
      </div>
      {!text.trim() && !tag ? (
        <Card><EmptyState title="Search your whole codex">Start typing, or pick a tag.</EmptyState></Card>
      ) : results.length === 0 ? (
        <Card><EmptyState title="Nothing found">Try fewer or shorter words.</EmptyState></Card>
      ) : (
        MODULES.map((m) => {
          const rows = results.filter((r) => r.kind === m.kind);
          if (!rows.length) return null;
          return (
            <div key={m.kind} className="search-group">
              <h3>{m.label} · {rows.length}</h3>
              <Card>
                {rows.map((r) => (
                  <button key={r.id} className="result" onClick={() => props.onOpen(r)}>
                    <div><b>{r.name}</b> <span className="muted">{r.entityType}</span></div>
                    {r.summary && <div className="sum">{r.summary}</div>}
                  </button>
                ))}
              </Card>
            </div>
          );
        })
      )}
    </>
  );
}
