import type { CSSProperties } from "react";
import { Badge, Button, Card } from "@forge/ui";
import { iconUrl, type InstalledApp } from "./api";

export function AppIcon({ app, size = 52 }: { app: InstalledApp; size?: number }) {
  const url = iconUrl(app);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.35), borderRadius: Math.round(size * 0.2), ...(app.manifest.accent ? { "--forge-accent": app.manifest.accent } : {}) };
  if (url) return <img className="app-icon" src={url} alt="" style={style as CSSProperties} />;
  const initials = app.manifest.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return <div className="app-icon" style={style as CSSProperties} aria-hidden>{initials}</div>;
}

export function HealthBadge({ app }: { app: InstalledApp }) {
  return app.health === "ready" ? <Badge tone="good">Ready</Badge> : <Badge tone="bad">Missing files</Badge>;
}

export function AppCard(props: {
  app: InstalledApp;
  favourite: boolean;
  onFavourite: () => void;
  onLaunch: () => void;
  onOpenFolder: () => void;
  launching: boolean;
}) {
  const { app } = props;
  const m = app.manifest;
  return (
    <Card interactive accent={m.accent}>
      <div className="app-card">
        <div className="app-card-head">
          <AppIcon app={app} />
          <div style={{ minWidth: 0 }}>
            <h3>{m.name}</h3>
            <div className="meta">
              <span>v{m.version}</span>
              {m.channel && m.channel !== "stable" && <Badge tone="warn">{m.channel}</Badge>}
              <HealthBadge app={app} />
            </div>
          </div>
        </div>
        <p>{m.description ?? "No description."}</p>
        {(m.tags ?? []).length > 0 && (
          <div className="meta">{(m.tags ?? []).map((t) => <Badge key={t}>{t}</Badge>)}</div>
        )}
        <div className="actions">
          <Button variant="primary" className="grow" disabled={app.health !== "ready" || props.launching} onClick={props.onLaunch}>
            {props.launching ? "Starting…" : "Launch"}
          </Button>
          <Button className="icon-btn star" aria-pressed={props.favourite} title="Favourite" onClick={props.onFavourite}>
            {props.favourite ? "★" : "☆"}
          </Button>
          <Button className="icon-btn" title="Open app folder" onClick={props.onOpenFolder}>⋯</Button>
        </div>
      </div>
    </Card>
  );
}
