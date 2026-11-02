import { describe, expect, it } from "vitest";
import { cleanPrefs, readyProblem, ai } from "./ai";

describe("AI settings", () => {
  it("starts off, on OpenAI, with safe defaults", () => {
    const p = cleanPrefs(null);
    expect(p).toMatchObject({ on: false, backend: "openai", quality: "medium", model: "gpt-image-1", comfyUrl: "http://127.0.0.1:8188", denoise: 0.55, steps: 24, size: 512, workflow: null });
  });
  it("keeps good values and repairs bad ones", () => {
    const p = cleanPrefs({ on: true, backend: "comfy", quality: "ultra", model: " ", denoise: 5, steps: 1000.4, size: 999, checkpoint: "dreamshaper_8.safetensors", workflowName: "x.json" });
    expect(p).toMatchObject({ on: true, backend: "comfy", quality: "medium", model: "gpt-image-1", denoise: 0.9, steps: 80, size: 512, checkpoint: "dreamshaper_8.safetensors", workflowName: "" });
    expect(cleanPrefs({ backend: "something" }).backend).toBe("openai");
    expect(cleanPrefs({ workflow: { "1": {} }, workflowName: "mine.json" })).toMatchObject({ workflow: { "1": {} }, workflowName: "mine.json" });
  });
  it("says what's missing before a run", () => {
    ai.prefs = cleanPrefs({ on: true });
    ai.hasKey = false;
    expect(readyProblem()).toContain("API key");
    ai.hasKey = true;
    expect(readyProblem()).toBe("");
    ai.prefs = cleanPrefs({ on: true, backend: "comfy" });
    expect(readyProblem()).toContain("checkpoint");
    ai.prefs = cleanPrefs({ on: true, backend: "comfy", checkpoint: "a.safetensors" });
    expect(readyProblem()).toBe("");
    ai.prefs = cleanPrefs({ on: true, backend: "comfy", workflow: { "1": {} } });
    expect(readyProblem()).toBe("");
  });
});
