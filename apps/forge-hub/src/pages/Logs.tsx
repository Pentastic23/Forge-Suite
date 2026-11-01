import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, errorText, type Level, type LogEntry } from "../api";

export function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<"all" | Level>("all");
  const [source, setSource] = useState("all");

  const load = () =>
    api.readLogs(2000).then((e) => { setEntries(e); setError(undefined); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);

  const sources = useMemo(() => [...new Set(entries.map((e) => e.source))].sort(), [entries]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) => (level === "all" || e.level === level) && (source === "all" || e.source === source) && (!q || e.message.toLowerCase().includes(q)),
    );
  }, [entries, query, level, source]);

  const exportShown = () => {
    const blob = new Blob([JSON.stringify(shown, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `forge-hub-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Launches, crashes and Forge Hub events. Old entries are cleared after the number of days set in Settings."
        actions={<><Button onClick={() => void load()}>Refresh</Button><Button onClick={exportShown} disabled={!shown.length}>Export</Button></>}
      />
      <div className="toolbar">
        <input className="forge-input" placeholder="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="forge-input" value={level} onChange={(e) => setLevel(e.target.value as "all" | Level)} aria-label="Level">
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <select className="forge-input" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p style={{ color: "var(--forge-bad)" }}>{error}</p>}
      {shown.length === 0 ? (
        <Card><EmptyState title="No log entries">{entries.length ? "Nothing matches these filters." : "Activity will show up here."}</EmptyState></Card>
      ) : (
        <Card>
          <table className="log-table">
            <thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th></tr></thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={i}>
                  <td className="time">{new Date(e.time).toLocaleString()}</td>
                  <td><Badge tone={e.level === "error" ? "bad" : e.level === "warn" ? "warn" : undefined}>{e.level}</Badge></td>
                  <td>{e.source}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
