import { describe, expect, it } from "vitest";
import { validateManifest } from "./manifest";
import { exchangeKindForFile } from "./exchange";

const good = { id: "balance-forge", name: "Balance Forge", version: "0.1.0", executable: "BalanceForge.exe" };

describe("validateManifest", () => {
  it("accepts a minimal manifest", () => {
    expect(validateManifest(good).ok).toBe(true);
  });
  it("lists every missing field", () => {
    const r = validateManifest({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(4);
  });
  it("rejects bad ids, versions and channels", () => {
    const r = validateManifest({ ...good, id: "Balance Forge", version: "1", channel: "nightly" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/id.*version.*channel/s);
  });
  it("rejects executables outside the app folder", () => {
    for (const exe of ["../evil.exe", "C:\\evil.exe", "/bin/sh"]) {
      expect(validateManifest({ ...good, executable: exe }).ok).toBe(false);
    }
  });
});

describe("exchangeKindForFile", () => {
  it("maps extensions to kinds", () => {
    expect(exchangeKindForFile("Mobs.forgecodex")).toBe("codex");
    expect(exchangeKindForFile("hero.FORGEASSET")).toBe("asset");
    expect(exchangeKindForFile("notes.txt")).toBeUndefined();
  });
});
