import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, type InstalledApp, type LogEntry } from "../api";
import { AppIcon } from "../AppCard";
import { timeAgo } from "../store";

export function Home(props: {
  apps: InstalledApp[];
  recent: Record<string, number>;
  problemCount: number;
  onLaunch: (app: InstalledApp) => void;
  onGo: (page: "applications" | "logs" | "settings") => void;
}) {
  const [activity, setActivity] = useState<LogEntry[]>([]);
  useEffect(() => {
    api.readLogs(8).then(setActivity).catch(() => setActivity([]));
  }, [props.recent]);

  const ready = props.apps.filter((a) => a.health === "ready");
  const recentApps = props.apps
    .filter((a) => props.recent[a.manifest.id])
    .sort((a, b) => props.recent[b.manifest.id] - props.recent[a.manifest.id])
    .slice(0, 4);
  const issues = props.apps.length - ready.length + props.problemCount;

  return (
    <>
      <PageHeader title="Welcome back" subtitle="Launch a Forge tool or pick up where you left off." />
      <div className="hub-tiles">
        <Card><div className="hub-tile"><div className="value">{props.apps.length}</div><div className="label">Installed apps</div></div></Card>
        <Card><div className="hub-tile"><div className="value">{ready.length}</div><div className="label">Ready to launch</div></div></Card>
        <Card>
          <div className="hub-tile">
            <div className="value">{issues}</div>
            <div className="label">{issues ? <Badge tone="warn">Needs attention</Badge> : "No problems found"}</div>
          </div>
        </Card>
      </div>

      {props.apps.length === 0 ? (
        <Card>
          <EmptyState title="No Forge apps installed yet">
            <p>Forge Hub looks for apps in the folders listed in Settings. Each app needs a <code>forge-app.json</code> file in its folder.</p>
            <Button variant="primary" onClick={() => props.onGo("settings")}>Open Settings</Button>
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="hub-section">Quick launch</div>
          <div className="quick">
            {ready.map((a) => (
              <button key={a.manifest.id} className="forge-btn" onClick={() => props.onLaunch(a)}>
                <AppIcon app={a} size={24} /> {a.manifest.name}
              </button>
            ))}
          </div>

          {recentApps.length > 0 && (
            <>
              <div className="hub-section">Recently used</div>
              <ul className="activity">
                {recentApps.map((a) => (
                  <li key={a.manifest.id}>
                    <span className="when">{timeAgo(props.recent[a.manifest.id])}</span>
                    <span>{a.manifest.name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className="hub-section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Recent activity
        <Button variant="ghost" onClick={() => props.onGo("logs")}>All logs</Button>
      </div>
      {activity.length === 0 ? (
        <p className="forge-page-sub">Nothing yet.</p>
      ) : (
        <ul className="activity">
          {activity.map((e, i) => (
            <li key={i}>
              <span className="when">{timeAgo(e.time)}</span>
              <span>{e.level !== "info" && <Badge tone={e.level === "error" ? "bad" : "warn"}>{e.level}</Badge>} {e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
