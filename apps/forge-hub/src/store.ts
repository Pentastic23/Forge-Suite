import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type ScanResult } from "./api";

/** Favourites and pins are a per-user convenience, kept in the webview. */
function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function useToggleSet(key: string) {
  const [set, setSet] = useState(() => readSet(key));
  const toggle = useCallback(
    (id: string) =>
      setSet((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        writeSet(key, next);
        return next;
      }),
    [key],
  );
  return [set, toggle] as const;
}

export function useApps() {
  const [scan, setScan] = useState<ScanResult>({ apps: [], problems: [] });
  const [recent, setRecent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const lastCount = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [first, r] = await Promise.all([api.listApps(), api.recentApps()]);
      let s = first;
      // Apps don't vanish between two scans: if they seem to, look again before showing an empty list.
      for (let i = 0; i < 2 && s.apps.length === 0 && lastCount.current > 0; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        s = await api.listApps();
      }
      lastCount.current = s.apps.length;
      setScan(s);
      setRecent(r);
      setError(undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...scan, recent, loading, error, refresh };
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
