import { useEffect, useState } from "react";
import { AppShell, Card, type NavItem } from "@forge/ui";
import logo from "../../../brand/forge-hub-logo-256.png";
import { api, errorText, type InstalledApp, type Settings } from "./api";
import { useApps, useToggleSet } from "./store";
import { Home } from "./pages/Home";
import { Applications } from "./pages/Applications";
import { Updates } from "./pages/Updates";
import { Logs } from "./pages/Logs";
import { Settings as SettingsPage } from "./pages/Settings";

type Page = "home" | "applications" | "updates" | "logs" | "settings";

const NAV: NavItem<Page>[] = [
  { key: "home", label: "Home" },
  { key: "applications", label: "Applications" },
  { key: "updates", label: "Updates" },
  { key: "logs", label: "Logs" },
];
const FOOTER: NavItem<Page>[] = [{ key: "settings", label: "Settings" }];

export function App() {
  const [page, setPage] = useState<Page>("home");
  const apps = useApps();
  const [favourites, toggleFavourite] = useToggleSet("forge-hub.favourites");
  const [launchingId, setLaunchingId] = useState<string>();
  const [toast, setToast] = useState<{ msg: string; bad?: boolean }>();
  const [settings, setSettings] = useState<Settings>();

  useEffect(() => { api.getSettings().then(setSettings).catch(() => undefined); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (msg: string, bad?: boolean) => setToast({ msg, bad });

  const launch = async (app: InstalledApp) => {
    setLaunchingId(app.manifest.id);
    try {
      await api.launchApp(app.manifest.id);
      notify(`${app.manifest.name} is starting`);
      void apps.refresh();
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setLaunchingId(undefined);
    }
  };
  const openFolder = (p: string) => api.openFolder(p).catch((e) => notify(errorText(e), true));

  return (
    <AppShell brand={{ name: "Forge Hub", logo }} nav={NAV} footerNav={FOOTER} current={page} onNavigate={setPage}>
      {apps.error && <Card><p style={{ color: "var(--forge-bad)", margin: 0 }}>Could not read installed apps: {apps.error}</p></Card>}
      {page === "home" && <Home apps={apps.apps} recent={apps.recent} problemCount={apps.problems.length} onLaunch={launch} onGo={setPage} />}
      {page === "applications" && (
        <Applications
          apps={apps.apps}
          problems={apps.problems}
          recent={apps.recent}
          favourites={favourites}
          onFavourite={toggleFavourite}
          onLaunch={launch}
          onOpenFolder={openFolder}
          launchingId={launchingId}
          onRefresh={() => void apps.refresh()}
        />
      )}
      {page === "updates" && <Updates apps={apps.apps} checkOnOpen={settings?.checkUpdatesOnStart ?? true} />}
      {page === "logs" && <Logs />}
      {page === "settings" && (
        <SettingsPage
          notify={notify}
          onSaved={() => {
            void apps.refresh();
            api.getSettings().then(setSettings).catch(() => undefined);
          }}
        />
      )}
      {toast && (
        <div className="toast">
          <Card accent={toast.bad ? "var(--forge-bad)" : undefined}><span role="status">{toast.msg}</span></Card>
        </div>
      )}
    </AppShell>
  );
}
