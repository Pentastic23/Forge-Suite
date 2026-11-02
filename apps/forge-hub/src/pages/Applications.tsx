import { useMemo, useState } from "react";
import { Button, Card, EmptyState, PageHeader } from "@forge/ui";
import type { InstalledApp, ScanResult } from "../api";
import { AppCard } from "../AppCard";

type Sort = "name" | "recent";

export function Applications(props: {
  apps: InstalledApp[];
  problems: ScanResult["problems"];
  recent: Record<string, number>;
  favourites: Set<string>;
  onFavourite: (id: string) => void;
  onLaunch: (app: InstalledApp) => void;
  onOpenFolder: (path: string) => void;
  launchingId?: string;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [sort, setSort] = useState<Sort>("name");

  const categories = useMemo(
    () => [...new Set(props.apps.map((a) => a.manifest.category).filter((c): c is string => !!c))].sort(),
    [props.apps],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = props.apps.filter((a) => {
      const m = a.manifest;
      if (onlyFavourites && !props.favourites.has(m.id)) return false;
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      return [m.name, m.description ?? "", ...(m.tags ?? [])].some((s) => s.toLowerCase().includes(q));
    });
    const fav = (a: InstalledApp) => (props.favourites.has(a.manifest.id) ? 0 : 1);
    return list.sort((a, b) => {
      const pinned = fav(a) - fav(b);
      if (pinned) return pinned;
      if (sort === "recent") return (props.recent[b.manifest.id] ?? 0) - (props.recent[a.manifest.id] ?? 0);
      return a.manifest.name.localeCompare(b.manifest.name);
    });
  }, [props.apps, props.favourites, props.recent, query, category, onlyFavourites, sort]);

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="Every Forge app Forge Hub found on this PC. Favourites stay at the top."
        actions={<Button onClick={props.onRefresh}>Rescan</Button>}
      />
      <div className="toolbar">
        <input className="forge-input" placeholder="Search apps, descriptions and tags" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="forge-input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="forge-input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="name">Sort by name</option>
          <option value="recent">Sort by last used</option>
        </select>
        <Button aria-pressed={onlyFavourites} className="star" onClick={() => setOnlyFavourites((v) => !v)}>
          {onlyFavourites ? "★ Favourites" : "☆ Favourites"}
        </Button>
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState title={props.apps.length ? "No apps match" : "No apps installed"}>{props.apps.length ? <p>Try a different search.</p> : <p>Forge Hub searched every usual install place and found no Forge apps. If yours are somewhere else, add that folder in Settings.</p>}</EmptyState></Card>
      ) : (
        <div className="forge-grid">
          {shown.map((a) => (
            <AppCard
              key={a.manifest.id}
              app={a}
              favourite={props.favourites.has(a.manifest.id)}
              onFavourite={() => props.onFavourite(a.manifest.id)}
              onLaunch={() => props.onLaunch(a)}
              onOpenFolder={() => props.onOpenFolder(a.folder)}
              launching={props.launchingId === a.manifest.id}
            />
          ))}
        </div>
      )}

      {props.problems.length > 0 && (
        <>
          <div className="hub-section">Skipped folders</div>
          <Card>
            <ul className="problems">
              {props.problems.map((p) => (
                <li key={p.path}><code>{p.path}</code>: {p.errors.join("; ")}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}
