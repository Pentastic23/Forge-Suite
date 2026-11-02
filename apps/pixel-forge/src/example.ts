// The Emberfall example project: sketches of the same hero, enemies, effect and items as the
// other Forge apps' examples (see examples/emberfall), drawn by code on "paper" so nothing comes
// from other art. Each one goes through the same conversion as a photo of a real sketch.
import { api } from "./api";
import { autoRig, bakePreset, getNextId, newAnim, newAsset, PRESET_ORDER, setKey, setNextId, type Asset, type Bone } from "./engine/core";
import { assetToDoc, exampleAsset, imageToPngB64 } from "./engine/doc";

type Pt = [number, number];
const W = 480;

/** A sheet of paper and a slightly shaky pen, so the sketches look hand drawn. */
function paper(seed: number) {
  const c = document.createElement("canvas");
  c.width = W; c.height = W;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f6f3ea"; g.fillRect(0, 0, W, W);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(120,110,90,${rnd() * 0.06})`; g.fillRect(rnd() * W, rnd() * W, 2, 2); }
  g.lineJoin = "round"; g.lineCap = "round";
  const path = (pts: Pt[], close = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => { x += (rnd() - 0.5) * 4; y += (rnd() - 0.5) * 4; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    if (close) g.closePath();
  };
  const ell = (cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 40): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  const shape = (pts: Pt[], fill: string, ink = 9) => { path(pts); g.fillStyle = fill; g.fill(); if (ink) { path(pts); g.strokeStyle = "#2b2420"; g.lineWidth = ink; g.stroke(); } };
  const fill = (pts: Pt[], color: string) => { path(pts); g.fillStyle = color; g.fill(); };
  const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const done = () => g.getImageData(0, 0, W, W);
  return { g, ell, shape, fill, rect, done };
}

// ---------------------------------------------------------------- sketches

/** Warden Lysa Thorne, the hero: standing, legs apart and arms away from the body, so auto-rig finds every limb. */
function wardenSketch() {
  const p = paper(11);
  const { ell, shape, fill, rect } = p;
  const skin = "#f0c9a0", cloak = "#3f7a5a", cloakDark = "#2f5e45", boots = "#5b4636", hair = "#b5462f";
  // legs
  shape([[200, 285], [232, 285], [226, 405], [196, 405]], "#6b5a48");
  shape([[248, 285], [280, 285], [284, 405], [254, 405]], "#6b5a48");
  shape(rect(186, 398, 44, 26), boots);
  shape(rect(250, 398, 44, 26), boots);
  // arms, held a little away from the body
  shape([[192, 160], [176, 168], [138, 270], [158, 280]], cloakDark);
  shape([[288, 160], [304, 168], [342, 270], [322, 280]], cloakDark);
  shape(ell(146, 285, 14, 14), skin, 7);
  shape(ell(334, 285, 14, 14), skin, 7);
  // body
  shape([[192, 150], [288, 150], [296, 292], [184, 292]], cloak);
  fill([[240, 152], [288, 150], [296, 292], [240, 292]], cloakDark);
  shape(rect(186, 252, 108, 16), "#8a5a3a", 6);
  shape(ell(240, 260, 9, 9), "#e0a526", 5);
  // head and hair
  shape(ell(240, 104, 40, 44), skin);
  shape([...ell(240, 96, 44, 40, Math.PI, Math.PI * 2, 20), [284, 110], [272, 92], [208, 92], [196, 110]], hair);
  fill(ell(226, 112, 5, 7), "#2b2420");
  fill(ell(256, 112, 5, 7), "#2b2420");
  return p.done();
}

function slimeSketch(body: string, shade: string, seed: number, ember: boolean) {
  const p = paper(seed);
  const { ell, shape, fill } = p;
  const dome: Pt[] = [...ell(240, 380, 170, 190, Math.PI, Math.PI * 2), [410, 392], [70, 392]];
  shape(dome, body, 10);
  fill([...ell(240, 380, 170, 190, Math.PI * 1.7, Math.PI * 2, 14), [410, 392], [300, 392]], shade);
  fill(ell(170, 260, 26, 18), "#ffffff");
  if (ember) {
    // flames stay inside the outline, so background removal can't leak in
    fill([[196, 262], [214, 222], [232, 266]], "#ffd23f");
    fill([[262, 256], [282, 214], [298, 262]], "#ffd23f");
  } else {
    fill(ell(300, 240, 20, 10), "#b5e48c");
    fill(ell(330, 300, 14, 8), "#b5e48c");
  }
  fill(ell(205, 320, 11, 17), "#2b2420");
  fill(ell(275, 320, 11, 17), "#2b2420");
  return p.done();
}

function batSketch() {
  const p = paper(23);
  const { ell, shape, fill } = p;
  shape([[240, 230], [70, 150], [90, 220], [60, 250], [110, 270], [100, 310], [215, 280]], "#5b4a7a");
  shape([[240, 230], [410, 150], [390, 220], [420, 250], [370, 270], [380, 310], [265, 280]], "#5b4a7a");
  shape(ell(240, 260, 52, 62), "#3b2f52");
  shape([[205, 210], [212, 165], [228, 205]], "#3b2f52", 7);
  shape([[252, 205], [268, 165], [275, 210]], "#3b2f52", 7);
  fill(ell(222, 250, 8, 8), "#ff5a4a");
  fill(ell(258, 250, 8, 8), "#ff5a4a");
  fill([[228, 285], [234, 300], [240, 285]], "#ffffff");
  fill([[244, 285], [250, 300], [256, 285]], "#ffffff");
  return p.done();
}

function fireBoltSketch() {
  const p = paper(31);
  const { ell, shape, fill } = p;
  shape([[60, 250], [180, 205], [300, 190], [330, 240], [300, 290], [180, 285]], "#ff9a3c");
  shape(ell(330, 240, 80, 80), "#ff7a1a");
  fill(ell(340, 240, 46, 46), "#ffd23f");
  fill(ell(350, 236, 20, 20), "#fff6c8");
  fill([[120, 230], [200, 222], [190, 238]], "#ffd23f");
  fill([[140, 265], [215, 258], [205, 272]], "#ffd23f");
  return p.done();
}

function potionSketch() {
  const p = paper(41);
  const { ell, shape, fill, rect } = p;
  shape(rect(205, 90, 70, 90), "#d6e4ea");
  shape(rect(195, 70, 90, 30), "#8d6e63");
  shape(ell(240, 290, 130, 130), "#e53935");
  fill([...ell(240, 290, 130, 130, Math.PI * 1.75, Math.PI * 2.6, 18)], "#b71c1c");
  fill(ell(190, 250, 26, 40), "#ff8a80");
  fill(ell(180, 240, 10, 16), "#ffffff");
  return p.done();
}

// ---------------------------------------------------------------- rigs

function bone(id: number, name: string, parent: number | null, h: Pt, t: Pt, z = 0, connected = false): Bone {
  return { id, name, parent, connected, hx: h[0], hy: h[1], tx: t[0], ty: t[1], z };
}

/** Reserves ids for bones and animations, the way the editor hands them out. */
function ids(n: number): number[] {
  const first = getNextId();
  setNextId(first + n);
  return Array.from({ length: n }, (_, i) => first + i);
}

/** A slime: a body bone with the top chained on, squashing and stretching while idle. */
function rigSlime(a: Asset) {
  const [body, top] = ids(2);
  a.rig.bones.push(bone(body, "body", null, [0.5, 0.8], [0.5, 0.55]), bone(top, "top", body, [0.5, 0.55], [0.5, 0.3], 1, true));
  const idle = a.anims[0];
  idle.frames = 8; idle.fps = 8;
  setKey(idle, body, 0, { sy: 1, sx: 1 }); setKey(idle, body, 4, { sy: 0.88, sx: 1.08 });
  setKey(idle, top, 0, { rot: -4 }); setKey(idle, top, 4, { rot: 4 });
  const hop = newAnim("hop");
  hop.fps = 10;
  setKey(hop, body, 0, { sy: 0.85, sx: 1.1 }); setKey(hop, body, 3, { y: -0.12, sy: 1.1, sx: 0.92 }); setKey(hop, body, 6, { sy: 0.85, sx: 1.1 });
  a.anims.push(hop);
}

/** The bat: a body with a wing on each side, flapping. */
function rigBat(a: Asset) {
  const [body, wl, wr] = ids(3);
  a.rig.bones.push(
    bone(body, "body", null, [0.5, 0.66], [0.5, 0.42], 1),
    bone(wl, "wing_l", body, [0.46, 0.5], [0.16, 0.4]),
    bone(wr, "wing_r", body, [0.54, 0.5], [0.84, 0.4]),
  );
  const fly = a.anims[0];
  fly.name = "fly"; fly.frames = 6; fly.fps = 12;
  setKey(fly, wl, 0, { rot: -25 }); setKey(fly, wl, 3, { rot: 30 });
  setKey(fly, wr, 0, { rot: 25 }); setKey(fly, wr, 3, { rot: -30 });
  setKey(fly, body, 0, { y: 0 }); setKey(fly, body, 3, { y: 0.03 });
}

/** The hero: one-click auto-rig, then all nine preset animations. */
function rigHero(a: Asset) {
  if (!autoRig(a, "humanoid").ok) return;
  for (const id of PRESET_ORDER) {
    let an = a.anims.find((x) => x.name === id);
    if (!an) { an = newAnim(id); a.anims.push(an); }
    if (!bakePreset(a, an, id)) {
      if (an.name !== "idle") a.anims = a.anims.filter((x) => x !== an);
      break;
    }
  }
}

// ---------------------------------------------------------------- the project

interface Entry { make: () => Asset; folder: string; tags: string[]; favorite?: boolean }

function sketch(name: string, src: ImageData, rig?: (a: Asset) => void): Asset {
  const a = newAsset(name, src);
  rig?.(a);
  return a;
}

const ENTRIES: Entry[] = [
  { make: () => sketch("warden_lysa", wardenSketch(), rigHero), folder: "Characters", tags: ["hero", "npc", "mosslight-woods"], favorite: true },
  { make: () => sketch("moss_slime", slimeSketch("#7cc35a", "#5a9a41", 17, false), rigSlime), folder: "Enemies", tags: ["slime", "mosslight-woods"] },
  { make: () => sketch("ember_slime", slimeSketch("#e8662a", "#b8451c", 19, true), rigSlime), folder: "Enemies", tags: ["slime", "fire", "cinder-hollow"], favorite: true },
  { make: () => sketch("cave_bat", batSketch(), rigBat), folder: "Enemies", tags: ["flying", "cinder-hollow"] },
  { make: () => sketch("fire_bolt", fireBoltSketch()), folder: "Effects", tags: ["fire", "skill"] },
  { make: () => sketch("health_potion", potionSketch()), folder: "Icons", tags: ["item", "potion"] },
  { make: () => exampleAsset(), folder: "Characters", tags: ["mushroom"] },
];

/** Fills a just-made example project with its sketches. */
export async function fillExample(): Promise<void> {
  for (const e of ENTRIES) {
    const a = e.make();
    const id = await api.addSketch({ name: a.name, folder: e.folder, png: imageToPngB64(a.src), doc: assetToDoc(a) });
    await api.updateLibrary([id], { tags: e.tags, favorite: !!e.favorite });
  }
}
