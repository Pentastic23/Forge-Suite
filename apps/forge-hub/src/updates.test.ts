import { describe, expect, it } from "vitest";
import { compareVersions, pickUpdate, repoFromUpdateSource, type GitHubRelease } from "./updates";

const rel = (tag: string, prerelease = false): GitHubRelease => ({
  tag_name: tag, name: tag, body: `notes ${tag}`, html_url: `https://x/${tag}`, prerelease, draft: false, published_at: null,
});

describe("repoFromUpdateSource", () => {
  it("reads owner/repo from GitHub URLs", () => {
    expect(repoFromUpdateSource("https://github.com/Pentastic23/forge-suite/releases")).toBe("Pentastic23/forge-suite");
    expect(repoFromUpdateSource("https://github.com/a/b.git")).toBe("a/b");
    expect(repoFromUpdateSource("https://example.com/a/b")).toBeUndefined();
    expect(repoFromUpdateSource(undefined)).toBeUndefined();
  });
});

describe("compareVersions", () => {
  it("orders versions", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("v1.10.0", "1.9.0")).toBeGreaterThan(0);
  });
});

describe("pickUpdate", () => {
  const releases = [
    rel("forge-core-v0.1.0"),
    rel("forge-core-v0.3.0-beta.1", true),
    rel("forge-core-v0.2.0"),
    rel("balance-forge-v9.0.0"),
  ];
  it("ignores other apps and prereleases on stable", () => {
    const u = pickUpdate(releases, "forge-core", "0.1.0");
    expect(u?.latest).toBe("0.2.0");
    expect(u?.available).toBe(true);
  });
  it("includes prereleases on beta", () => {
    expect(pickUpdate(releases, "forge-core", "0.1.0", "beta")?.latest).toBe("0.3.0-beta.1");
  });
  it("reports no update when current", () => {
    expect(pickUpdate(releases, "forge-core", "0.2.0")?.available).toBe(false);
  });
  it("falls back to plain v tags", () => {
    expect(pickUpdate([rel("v1.2.0")], "solo-app", "1.0.0")?.latest).toBe("1.2.0");
  });
});
