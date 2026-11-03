import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { api, type InstalledApp, type LogEntry } from "../api";
import { AppIcon } from "../AppCard";
import { timeAgo } from "../store";

/** What each app's Emberfall example shows, in the order the work flows between them. */
const EXAMPLE_TOUR: { id: string; name: string; what: string }[] = [
  { id: "forge-core", name: "Forge Core", what: "The design: zones, mobs, items, skills, quests and lore, linked to each other, with version history." },
  { id: "balance-forge", name: "Balance Forge", what: "The same mobs and items as stat sheets with formulas, a weapons sheet with two outliers, a patch to compare and an economy to simulate." },
  { id: "asset-forge", name: "Asset Forge", what: "Sprites, icons, sounds and music for those entries, a few problems for Checks to find, and production slots to finish." },
  { id: "pixel-forge", name: "Pixel Forge", what: "Sketches of the hero, the enemies, an effect and an item, rigged and animated, ready to export." },
  { id: "ai-forge", name: "AI Forge", what: "The game brief and codex for the assistant, finished chats about the bat's code, a mini-boss and an icon prompt, and a library to try." },
];

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

      <div className="hub-section">Example game: Emberfall</div>
      <Card>
        <p className="forge-page-sub" style={{ marginTop: 0 }}>
          Every app comes with the same small made-up game, so you can see how they work and how they pass work to each other.
          Open an app and press <b>Open example</b> on its start screen.
        </p>
        <ul className="activity">
          {EXAMPLE_TOUR.map((t) => {
            const app = ready.find((a) => a.manifest.id === t.id);
            return (
              <li key={t.id} style={{ alignItems: "center" }}>
                <span style={{ minWidth: 120, fontWeight: 600 }}>{t.name}</span>
                <span style={{ flex: 1 }}>{t.what}</span>
                {app && <Button variant="ghost" onClick={() => props.onLaunch(app)}>Open</Button>}
              </li>
            );
          })}
        </ul>
      </Card>

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
