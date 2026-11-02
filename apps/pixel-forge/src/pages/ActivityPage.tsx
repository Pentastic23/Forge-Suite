import { useEffect, useState } from "react";
import { Card, PageHeader } from "@forge/ui";
import { api, errorText, when, type Event } from "../api";
import type { Notify } from "../App";

/** Everything that happened in this project, newest first. */
export function ActivityPage(props: { notify: Notify }) {
  const { notify } = props;
  const [events, setEvents] = useState<Event[]>();
  useEffect(() => { api.activity(300).then(setEvents).catch((e) => notify(errorText(e), true)); }, [notify]);
  return (
    <div className="stack">
      <PageHeader title="Activity" subtitle="What changed in this project: sketches added and removed, library changes and exports." />
      <Card>
        {events && events.length === 0 && <p className="muted">Nothing has happened yet.</p>}
        <ul className="list-plain activity">
          {events?.map((e, i) => (
            <li key={i}>
              <span className="activity-what"><b>{e.action}</b> {e.detail}</span>
              <span className="muted small nowrap">{when(e.at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
