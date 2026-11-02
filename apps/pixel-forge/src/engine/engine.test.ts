import { beforeAll, describe, expect, it } from "vitest";

// The engine runs in the app's webview; Node only lacks ImageData.
beforeAll(() => {
  (globalThis as { ImageData?: unknown }).ImageData ??= class {
    data: Uint8ClampedArray; width: number; height: number;
    constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
      if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
      else { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; }
    }
  };
});

/** A paper sketch: a dark closed outline around a blue body and a skin-colored head. */
function sketch(): ImageData {
  const W = 120, H = 180, d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([244, 240, 230, 255], i * 4);
  for (let y = 20; y < 170; y++) for (let x = 30; x < 90; x++) {
    const edge = x < 34 || x > 85 || y < 24 || y > 165;
    d.set(edge ? [30, 25, 20] : y < 70 ? [230, 180, 150] : [60, 90, 200], (y * W + x) * 4);
  }
  return new ImageData(d, W, H);
}

describe("colour math", async () => {
  const E = await import("./core.js");
  it("round-trips hex", () => {
    expect(E.hex([255, 128, 0])).toBe("#ff8000");
    expect(E.unhex("#ff8000")).toEqual([255, 128, 0]);
    expect(E.unhex("f80")).toEqual([255, 136, 0]);
  });
  it("puts white and black at the ends of OKLab lightness", () => {
    expect(E.oklab(255, 255, 255)[0]).toBeCloseTo(1, 3);
    expect(E.oklab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });
});

describe("conversion", async () => {
  const E = await import("./core.js");
  it("turns a sketch into pixel art at every size, dropping the paper", () => {
    E.assets.length = 0;
    const a = E.newAsset("hero", sketch());
    E.assets.push(a);
    let last = 0;
    for (const N of E.SIZES) {
      const idx = E.finalize(E.buildBase(a, N), N);
      expect(idx.length).toBe(N * N);
      let filled = 0;
      for (const v of idx) if (v >= 0) filled++;
      expect(filled).toBeGreaterThan(last);
      expect(filled).toBeLessThan(N * N * 0.8);   // the background is gone
      last = filled;
    }
    expect(E.P.rgb.length).toBeGreaterThan(2);
  });
  it("rigs the sketch and bakes a walk", () => {
    const a = E.assets[0];
    const r = E.autoRig(a, "humanoid");
    expect(r.ok).toBe(true);
    expect(a.rig.bones.length).toBeGreaterThan(8);
    const an = E.newAnim("walk");
    a.anims.push(an);
    expect(E.bakePreset(a, an, "walk")).toBe(true);
    const frames = E.rigFrames(E.buildBase(a, 32), 32, an, a);
    expect(frames).toHaveLength(an.frames);
  });
});

describe("project documents", async () => {
  const E = await import("./core.js");
  const D = await import("./doc.js");
  it("run-length encodes layer labels", () => {
    const arr = new Int32Array([0, 0, 0, 5, 5, 7]);
    expect(D.rleOut(arr)).toEqual([0, 3, 5, 2, 7, 1]);
    expect([...D.rleIn(D.rleOut(arr), 6)]).toEqual([...arr]);
  });
  it("keeps touch-ups, rig and animations through a save and load", () => {
    const a = E.assets[0] ?? E.newAsset("hero", sketch());
    a.edits[32] = new Map([[5, "#ff0000"], [6, null]]);
    a.erasePts.push({ x: 0.1, y: 0.2 });
    const doc = JSON.parse(JSON.stringify(D.assetToDoc(a)));
    const b = D.docToAsset(99, a.name, a.src, doc);
    expect(b.id).toBe(99);
    expect([...b.edits[32]]).toEqual([[5, "#ff0000"], [6, null]]);
    expect(b.erasePts).toEqual(a.erasePts);
    expect(b.rig.bones).toEqual(a.rig.bones);
    expect(b.anims.map((x) => x.name)).toEqual(a.anims.map((x) => x.name));
    if (a.rig.labels) expect([...b.rig.labels!]).toEqual([...a.rig.labels]);
    expect(E.getNextId()).toBeGreaterThan(Math.max(...a.rig.bones.map((x) => x.id)));
  });
  it("starts fresh from a missing or broken document", () => {
    const b = D.docToAsset(3, "x", sketch(), "nonsense");
    expect(b.anims).toHaveLength(1);
    expect(b.rig.bones).toEqual([]);
  });
});

describe("palettes and style training", async () => {
  const Ed = await import("./editor.js");
  const St = await import("./style.js");
  it("reads hex, GIMP and RGB palette lists", () => {
    const t = "GIMP Palette\nName: test\n#\n255 0 0\tred\n#00ff00\n0000ff\n; comment\n";
    expect(Ed.parsePaletteText(t)).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
  });
  it("makes safe names", () => {
    expect(Ed.snake("Big Axe.png")).toBe("big_axe");
    expect(Ed.snake("  Hero -- Knight!! ")).toBe("hero_knight");
  });
  it("measures a solid outline and a palette from finished sprites", () => {
    const mk = (body: number[], shade: number[]) => {
      const d = new Uint8ClampedArray(32 * 32 * 4);
      const px = (x: number, y: number, c: number[]) => d.set([...c, 255], (y * 32 + x) * 4);
      for (let y = 8; y < 30; y++) for (let x = 8; x < 24; x++) {
        const edge = x === 8 || x === 23 || y === 8 || y === 29;
        px(x, y, edge ? [27, 20, 36] : y > 22 ? shade : body);
      }
      return { w: 32, h: 32, d };
    };
    const r = St.analyzeStyle([mk([79, 163, 90], [47, 109, 71]), mk([199, 91, 59], [138, 53, 54]), mk([74, 111, 194], [45, 63, 134])]);
    expect(r.count).toBe(3);
    expect(r.outline).toBe("outer");
    expect(r.ink).toBe("#1b1424");
    expect(r.palette).toHaveLength(7);
    expect(r.size).toBe(32);
  });
  it("saves and restores a style profile", () => {
    Ed.setSetting("rampStep", 17);
    const t = St.snapshotTheme("forest");
    Ed.setSetting("rampStep", 6);
    expect(St.applyTheme(t)).toBe(true);
    expect(Ed.S.rampStep).toBe(17);
    expect(St.applyTheme({ nope: 1 })).toBe(false);
  });
});

describe("AI coloring", async () => {
  const C = await import("./core.js");
  const Ed = await import("./editor.js");
  const D = await import("./doc.js");
  it("wraps the person's words in instructions that keep the drawing", () => {
    C.S.light = "tr";
    C.S.lockPalette = false;
    const p = Ed.buildAIPrompt("  red cloak  ");
    expect(p).toContain("light from the top right");
    expect(p).toContain("Keep exactly the same pose");
    expect(p.endsWith("Colors and details: red cloak")).toBe(true);
    expect(Ed.buildAIPrompt("")).not.toContain("Colors and details");
    expect(Ed.buildAIPrompt("x".repeat(900)).length).toBeLessThan(1400);
    C.setPalette([[255, 0, 0], [0, 0, 255]]);
    C.S.lockPalette = true;
    expect(Ed.buildAIPrompt()).toContain("Use only these colors: #ff0000, #0000ff.");
    C.S.lockPalette = false;
  });
  it("picks the image shape closest to the sketch", () => {
    const at = (w: number, h: number) => Ed.aiSizeFor({ src: new ImageData(w, h) } as never);
    expect([at(100, 180), at(100, 100), at(200, 100)]).toEqual(["1024x1536", "1024x1024", "1536x1024"]);
  });
  it("keeps an AI image that already has a transparent background", () => {
    const im = sketch();
    for (let i = 0; i < im.width * im.height; i++) if (im.data[i * 4] === 244) im.data.fill(0, i * 4, i * 4 + 4);
    const a = C.newAsset("cutout", sketch());
    Ed.setAIImage(a, im);
    const idx = C.finalize(C.buildBase(a, 32), 32);
    let filled = 0;
    for (const v of idx) if (v >= 0) filled++;
    expect(filled).toBeGreaterThan(32 * 32 * 0.15);
    expect(filled).toBeLessThan(32 * 32 * 0.8);
  });
  it("switches between the AI version and the sketch, and remembers the choice", () => {
    const a = C.newAsset("knight", sketch());
    const before = C.preKey(a);
    Ed.setAIImage(a, sketch());
    expect(a.useAI).toBe(true);
    const withAI = C.preKey(a);
    expect(withAI).not.toBe(before);
    const doc = JSON.parse(JSON.stringify(D.assetToDoc(a)));
    expect(doc.useAI).toBe(true);
    expect(D.docToAsset(7, "knight", a.src, doc).useAI).toBe(true);
    Ed.setAIImage(a, null);
    expect([a.useAI, a.aiSrc, C.preKey(a)]).toEqual([false, null, before]);
    expect(D.assetToDoc(a).useAI).toBe(false);
  });
});
