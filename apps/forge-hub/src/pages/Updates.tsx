import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader } from "@forge/ui";
import { errorText, type InstalledApp } from "../api";
import { AppIcon } from "../AppCard";
import { checkForUpdate, type UpdateInfo } from "../updates";

type Status = { state: "idle" } | { state: "checking" } | { state: "done"; info?: UpdateInfo } | { state: "error"; message: string };

export function Updates(props: { apps: InstalledApp[]; checkOnOpen: boolean }) {
  const [status, setStatus] = useState<Record<string, Status>>({});

  const checkAll = useCallback(async () => {
    await Promise.all(
      props.apps.map(async (a) => {
        const m = a.manifest;
        setStatus((s) => ({ ...s, [m.id]: { state: "checking" } }));
        try {
          const info = await checkForUpdate(m.id, m.version, m.updateSource, m.channel);
          setStatus((s) => ({ ...s, [m.id]: { state: "done", info } }));
        } catch (e) {
          setStatus((s) => ({ ...s, [m.id]: { state: "error", message: errorText(e) } }));
        }
      }),
    );
  }, [props.apps]);

  useEffect(() => {
    if (props.checkOnOpen && props.apps.length) void checkAll();
  }, [props.checkOnOpen, props.apps, checkAll]);

  return (
    <>
      <PageHeader
        title="Updates"
        subtitle="Checks each app's GitHub releases on its channel. Installing updates from here comes in the next version of Forge Hub."
        actions={<Button variant="primary" onClick={() => void checkAll()} disabled={!props.apps.length}>Check now</Button>}
      />
      {props.apps.length === 0 ? (
        <Card><EmptyState title="Nothing to update">Install a Forge app first.</EmptyState></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {props.apps.map((a) => {
            const s = status[a.manifest.id] ?? { state: "idle" };
            return (
              <Card key={a.manifest.id} accent={a.manifest.accent}>
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <AppIcon app={a} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{a.manifest.name}</strong>
                      <span className="forge-page-sub" style={{ margin: 0 }}>v{a.manifest.version}</span>
                      <Badge>{a.manifest.channel ?? "stable"}</Badge>
                      {s.state === "checking" && <Badge>Checking…</Badge>}
                      {s.state === "error" && <Badge tone="bad">{s.message}</Badge>}
                      {s.state === "done" && !s.info && <Badge>No releases yet</Badge>}
                      {s.state === "done" && s.info && !s.info.available && <Badge tone="good">Up to date</Badge>}
                      {s.state === "done" && s.info?.available && <Badge tone="warn">v{s.info.latest} available</Badge>}
                    </div>
                    {s.state === "done" && s.info?.available && (
                      <>
                        {s.info.notes && <pre className="notes">{s.info.notes}</pre>}
                        <a href={s.info.url} target="_blank" rel="noreferrer" style={{ color: "var(--forge-accent)" }}>Release page</a>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
