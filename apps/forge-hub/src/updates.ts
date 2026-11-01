/**
 * Update checks against GitHub releases. Suite apps share one repo, so each
 * app's releases are tagged "<app id>-v<version>" (e.g. "forge-core-v0.2.0").
 * A repo holding a single app may use plain "v<version>" tags instead.
 */
import type { ReleaseChannel } from "@forge/formats";

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
}

export interface UpdateInfo {
  latest: string;
  available: boolean;
  notes: string;
  url: string;
  publishedAt: string | null;
}

/** "https://github.com/owner/repo/releases" -> "owner/repo". */
export function repoFromUpdateSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const m = source.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Returns [major, minor, patch, prerelease] or undefined if not a version. */
export function parseVersion(v: string): [number, number, number, string] | undefined {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""] : undefined;
}

/** Positive if a > b. A prerelease sorts below its release (1.0.0-beta < 1.0.0). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number);
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return 1;
  if (!pb[3]) return -1;
  return pa[3] < pb[3] ? -1 : 1;
}

function versionFromTag(tag: string, appId: string): string | undefined {
  const prefix = `${appId}-v`;
  if (tag.startsWith(prefix)) return tag.slice(prefix.length);
  if (/^v\d/.test(tag)) return tag.slice(1);
  return undefined;
}

/** Picks the newest release for this app that the channel allows. */
export function pickUpdate(
  releases: GitHubRelease[],
  appId: string,
  installed: string,
  channel: ReleaseChannel = "stable",
): UpdateInfo | undefined {
  const own = releases.filter((r) => r.tag_name.startsWith(`${appId}-v`));
  const pool = own.length ? own : releases;
  let best: { r: GitHubRelease; v: string } | undefined;
  for (const r of pool) {
    if (r.draft) continue;
    if (channel === "stable" && r.prerelease) continue;
    const v = versionFromTag(r.tag_name, appId);
    if (!v || !parseVersion(v)) continue;
    if (!best || compareVersions(v, best.v) > 0) best = { r, v };
  }
  if (!best) return undefined;
  return {
    latest: best.v,
    available: compareVersions(best.v, installed) > 0,
    notes: best.r.body ?? "",
    url: best.r.html_url,
    publishedAt: best.r.published_at,
  };
}

export async function checkForUpdate(
  appId: string,
  installed: string,
  updateSource: string | undefined,
  channel?: ReleaseChannel,
): Promise<UpdateInfo | undefined> {
  const repo = repoFromUpdateSource(updateSource);
  if (!repo) throw new Error("No GitHub update source in this app's manifest");
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return pickUpdate((await res.json()) as GitHubRelease[], appId, installed, channel);
}
