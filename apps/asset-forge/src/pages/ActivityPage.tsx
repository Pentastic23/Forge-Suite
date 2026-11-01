import { useCallback, useEffect, useState } from "react";
import { Button, Card, PageHeader } from "@forge/ui";
import { api, errorText, when, type HistoryEvent } from "../api";
import type { Notify } from "../App";

/** Everything that happened in this project, newest first. */
export function ActivityPage(props: { version: number; onChanged: () => void; notify: Notify }) {
  const { notify } = props;
  const [events, setEvents] = useState<[string | null, HistoryEvent][]>();
  const [names, setNames] = useState<Record<string, string>>({});
  const [canUndo, setCanUndo] = useState(false);

  const load = useCallback(async () => {
    try {
      const ev = await api.activity(300);
      setEvents(ev);
      const ids = [...new Set(ev.map(([id]) => id).filter((x): x is string => !!x))];
      if (ids.length) {
        const page = await api.list({ ids, limit: ids.length });
        setNames(Object.fromEntries(page.assets.map((a) => [a.id, a.relPath])));
      }
      const last = await api.setting<unknown[]>("lastRename");
      setCanUndo(Array.isArray(last) && last.length > 0);
    } catch (e) { notify(errorText(e), true); }
  }, [notify]);
  useEffect(() => { void load(); }, [load, props.version]);

  const undo = async () => {
    if (!window.confirm("Put the files from the last rename back to their old names?")) return;
    try {
      const n = await api.renameUndo();
      notify(`Put ${n} files back`);
      props.onChanged();
    } catch (e) { notify(errorText(e), true); }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Activity"
        subtitle="What changed in this project: scans, edits, renames, exports and imports."
        actions={canUndo ? <Button onClick={() => void undo()}>Undo last rename</Button> : undefined}
      />
      <Card>
        {events && events.length === 0 && <p className="muted">Nothing has happened yet.</p>}
        <ul className="list-plain activity">
          {events?.map(([id, e], i) => (
            <li key={i}>
              <span className="activity-what">
                <b>{e.action}</b> {e.detail}
                {id && names[id] && <span className="muted small mono ellipsis"> · {names[id]}</span>}
              </span>
              <span className="muted small nowrap">{when(e.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
