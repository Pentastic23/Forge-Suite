import { describe, expect, it } from "vitest";
import { cleanBrief, EMPTY_BRIEF, firstPrompt, imagePrompt, improveRequest, systemPrompt } from "./prompts";
import { cleanPrefs, DEFAULTS } from "./prefs";
import { extFor, parseBlocks } from "./markdown";

describe("system prompt", () => {
  const brief = { ...EMPTY_BRIEF, game: "Emberfall", engine: "godot", artStyle: "32 px pixel art" };
  it("names the game, engine and mode", () => {
    const s = systemPrompt("code", brief, null);
    expect(s).toContain("Emberfall");
    expect(s).toContain("Godot 4 (GDScript)");
    expect(s).toContain("fenced code blocks");
    expect(s).not.toContain("codex");
  });
  it("adds the codex only when it is turned on", () => {
    const codex = { project: "Emberfall", entries: [{ kind: "mob", name: "Cave Bat", summary: "Fast and fragile." }] };
    expect(systemPrompt("design", brief, codex)).toContain("- [mob] Cave Bat: Fast and fragile.");
    expect(systemPrompt("design", { ...brief, useCodex: false }, codex)).not.toContain("Cave Bat");
  });
  it("cleans a stored brief", () => {
    expect(cleanBrief({ engine: "cryengine", game: 5, useCodex: false })).toEqual({ ...EMPTY_BRIEF, useCodex: false });
  });
});

describe("image prompts", () => {
  const brief = { ...EMPTY_BRIEF, artStyle: "muted watercolor" };
  it("adds the preset and the art style", () => {
    expect(imagePrompt(" a slime ", "icon", brief, true)).toBe("a slime, game inventory icon, single object, centered, bold readable silhouette, no text, in this art style: muted watercolor");
    expect(imagePrompt("a slime", "none", brief, false)).toBe("a slime");
  });
  it("asks for a rewrite and reads the answer", () => {
    expect(improveRequest("model", "a chest", brief)).toContain("3D model generator");
    expect(firstPrompt("Here:\n```text\nA red chest\n```\nTips")).toBe("A red chest");
    expect(firstPrompt("  just text ")).toBe("just text");
  });
});

describe("settings", () => {
  it("falls back to defaults for anything unknown", () => {
    expect(cleanPrefs(null)).toEqual(DEFAULTS);
    const p = cleanPrefs({ chatProvider: "gemini", meshPolycount: 9e9, steps: 2.4, imageSize: "1024x1024", workflow: "x" });
    expect(p.chatProvider).toBe("anthropic");
    expect(p.meshPolycount).toBe(300000);
    expect(p.steps).toBe(4);
    expect(p.workflow).toBeNull();
  });
});

describe("markdown", () => {
  it("splits an answer into blocks", () => {
    const b = parseBlocks("# Title\n\nSome **bold** text\nmore\n\n- one\n- two\n  wrapped\n\n1. first\n2. second\n\n```gdscript\nfunc _ready():\n\tpass\n```\n> quote\n\n---");
    expect(b.map((x) => x.t)).toEqual(["h", "p", "ul", "ol", "code", "quote", "hr"]);
    expect(b[2]).toEqual({ t: "ul", items: ["one", "two wrapped"], start: 1 });
    expect(b[4]).toEqual({ t: "code", lang: "gdscript", code: "func _ready():\n\tpass" });
  });
  it("shows an unfinished code block while it is still being written", () => {
    expect(parseBlocks("```python\nprint(1)")).toEqual([{ t: "code", lang: "python", code: "print(1)" }]);
  });
  it("picks file extensions", () => {
    expect(extFor("gdscript")).toBe("gd");
    expect(extFor("csharp")).toBe("cs");
    expect(extFor("weird")).toBe("txt");
  });
});
