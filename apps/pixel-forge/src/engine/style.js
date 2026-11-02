// Style Training and style profiles, carried over from Sprite Foundry.
// Training measures your own finished sprites (palette, outlines, shade ramps, light, proportions)
// and turns the numbers into conversion rules. Plain measurement: no learned model.
/* eslint-disable */
import { SIZES, S, P, DEFAULTS, assets, medianCut, oklab, lch, hex, unhex, setPalette, profileOf, resetSettings } from './core.js';
import { resetAutoPalette, emit, dirty } from './editor.js';

// sprites: [{w, h, d}] RGBA, one sprite each. Everything below is plain measurement, no learned model.
export function spritesFromImage(im, cell){
  const out = [], {width:w, height:h, data} = im;
  // no transparency at all? treat the corner color as background
  let anyClear = false; for (let i = 3; i < data.length; i += 4) if (data[i] < 128){ anyClear = true; break; }
  const d = new Uint8ClampedArray(data);
  if (!anyClear){ const k = [d[0], d[1], d[2]]; for (let i = 0; i < d.length; i += 4) if (d[i] === k[0] && d[i+1] === k[1] && d[i+2] === k[2]) d[i+3] = 0; }
  const cw = cell > 0 ? cell : w, ch = cell > 0 ? cell : h;
  for (let y0 = 0; y0 + ch <= h; y0 += ch) for (let x0 = 0; x0 + cw <= w; x0 += cw){
    const c = new Uint8ClampedArray(cw * ch * 4); let opq = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++){ const s = ((y0 + y) * w + x0 + x) * 4, t = (y * cw + x) * 4;
      c[t] = d[s]; c[t+1] = d[s+1]; c[t+2] = d[s+2]; c[t+3] = d[s+3] >= 128 ? 255 : 0; if (c[t+3]) opq++; }
    if (opq >= 6) out.push({w:cw, h:ch, d:c});
  }
  return out;
}
export function analyzeStyle(sprites){
  const notes = [];
  // 1. palette: pixel art reuses a small set of exact colors, so count them
  const freq = new Map();
  for (const s of sprites) for (let i = 0; i < s.d.length; i += 4) if (s.d[i+3]){ const k = (s.d[i] << 16) | (s.d[i+1] << 8) | s.d[i+2]; freq.set(k, (freq.get(k) || 0) + 1); }
  let pal = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => [k >> 16, (k >> 8) & 255, k & 255]);
  if (pal.length > 48){
    notes.push(`Your sprites use ${pal.length} different colors, so they were grouped into 32. Pixel-perfect PNGs (no smoothing or JPEG) give an exact palette.`);
    const px = []; for (const [k, n] of freq) for (let r = 0; r < Math.min(n, 40); r++) px.push([k >> 16, (k >> 8) & 255, k & 255]);
    pal = medianCut(px, 32);
  }
  const labs = pal.map(c => oklab(...c));
  const idxOf = new Map(); pal.forEach((c, i) => idxOf.set((c[0] << 16) | (c[1] << 8) | c[2], i));
  const nearestPal = (r, g, b) => { const k = (r << 16) | (g << 8) | b; if (idxOf.has(k)) return idxOf.get(k); const L = oklab(r, g, b); let bi = 0, bd = 1e9; labs.forEach((q, i) => { const dd = (q[0]-L[0])**2 + (q[1]-L[1])**2 + (q[2]-L[2])**2; if (dd < bd){ bd = dd; bi = i; } }); idxOf.set(k, bi); return bi; };
  // index every sprite once
  const maps = sprites.map(s => { const m = new Int16Array(s.w * s.h).fill(-1); for (let i = 0; i < m.length; i++) if (s.d[i*4+3]) m[i] = nearestPal(s.d[i*4], s.d[i*4+1], s.d[i*4+2]); return {w:s.w, h:s.h, m}; });
  // 2. outline: what sits on the silhouette edge, and is the ring one or two pixels deep?
  const edgeCount = new Map(); let edges = 0, darkerEdge = 0, thick = 0, inkEdges = 0;
  const at = (S2, x, y) => (x < 0 || y < 0 || x >= S2.w || y >= S2.h) ? -1 : S2.m[y * S2.w + x];
  const D4 = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const s of maps) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){
    const v = s.m[y*s.w + x]; if (v < 0) continue;
    const open = D4.find(([dx, dy]) => at(s, x + dx, y + dy) < 0); if (!open) continue;
    edges++; edgeCount.set(v, (edgeCount.get(v) || 0) + 1);
    const inner = at(s, x - open[0], y - open[1]);
    if (inner >= 0 && labs[v][0] < labs[inner][0] - 0.08) darkerEdge++;
  }
  const ink = [...edgeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const inkShare = edges ? (edgeCount.get(ink) || 0) / edges : 0;
  for (const s of maps) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){
    if (s.m[y*s.w + x] !== ink) continue;
    const open = D4.find(([dx, dy]) => at(s, x + dx, y + dy) < 0); if (!open) continue;
    inkEdges++; if (at(s, x - open[0], y - open[1]) === ink) thick++;
  }
  const outline = inkShare > 0.55 && labs[ink][0] < 0.45 ? 'outer' : edges && darkerEdge / edges > 0.5 ? 'selective' : 'none';
  const outlineWidth = inkEdges && thick / inkEdges > 0.55 ? 2 : 1;
  // 3. shade ramps: neighboring colors of the same hue family, one lighter than the other
  const pairs = new Map();
  for (const s of maps) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){
    const a = s.m[y*s.w + x]; if (a < 0 || a === ink) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]){ const b = at(s, x + dx, y + dy); if (b < 0 || b === ink || b === a) continue;
      const k = a < b ? a * 1000 + b : b * 1000 + a; pairs.set(k, (pairs.get(k) || 0) + 1); }
  }
  const steps = [], hueSteps = [], shadowT = [], lightT = [], darker = new Map();
  let gx = 0, gy = 0;
  const isRampPair = (a, b) => {
    const [La, Ca, ha] = lch(labs[a]), [Lb, Cb, hb] = lch(labs[b]);
    const dL = Math.abs(La - Lb), dh = Math.abs(((hb - ha + 540) % 360) - 180);
    return dL > 0.035 && dL < 0.3 && (dh < 50 || (Ca < 0.04 && Cb < 0.04));
  };
  for (const [k, n] of pairs){
    if (n < 3) continue;
    let a = Math.floor(k / 1000), b = k % 1000; if (!isRampPair(a, b)) continue;
    if (labs[a][0] < labs[b][0]) [a, b] = [b, a];          // a = lighter, b = darker
    const [La, Ca, ha] = lch(labs[a]), [Lb, Cb, hb] = lch(labs[b]);
    const dh = ((hb - ha + 540) % 360) - 180;
    for (let r = 0; r < Math.min(n, 50); r++) steps.push(La - Lb);
    if (Ca > 0.04 && Cb > 0.04){ for (let r = 0; r < Math.min(n, 50); r++) hueSteps.push(Math.abs(dh));
      if (Math.abs(dh) > 2){ shadowT.push([hb + Math.sign(dh) * 45, n]); lightT.push([ha - Math.sign(dh) * 45, n]); } }
    if (!darker.has(a) || darker.get(a)[1] < n) darker.set(a, [b, n]);
  }
  // light direction: inside each ramp, which side of a pixel is brighter?
  for (const s of maps) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){
    const a = s.m[y*s.w + x]; if (a < 0 || a === ink) continue;
    const r = at(s, x + 1, y), dn = at(s, x, y + 1);
    if (r >= 0 && r !== a && r !== ink && isRampPair(a, r)) gx += labs[r][0] - labs[a][0];
    if (dn >= 0 && dn !== a && dn !== ink && isRampPair(a, dn)) gy += labs[dn][0] - labs[a][0];
  }
  const median = v => { if (!v.length) return null; const s = v.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
  const circMean = list => { let sx = 0, sy = 0; for (const [h, w] of list){ sx += Math.cos(h * Math.PI / 180) * w; sy += Math.sin(h * Math.PI / 180) * w; } return sx || sy ? Math.round((Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360) : null; };
  const rampStep = median(steps), rampHue = median(hueSteps);
  // ramp length: follow "darker partner" links to see how many shades a color family uses
  const chain = i => { let n = 1, cur = i, seen = new Set([i]); while (darker.has(cur) && n < 6){ cur = darker.get(cur)[0]; if (seen.has(cur)) break; seen.add(cur); n++; } return n; };
  const lens = [...darker.keys()].map(chain), avgLen = lens.length ? lens.reduce((p, q) => p + q, 0) / lens.length : 1;
  const shadeBands = avgLen >= 2.6 ? 2 : 1, shade = avgLen < 2.2 && hueSteps.length < 40 ? 'cel' : 'form';
  // gx > 0: pixels get brighter to the right (light from the right); gy < 0: brighter upward (light from above)
  const lightDir = gy < 0 && Math.abs(gx) < Math.abs(gy) * 0.35 ? 't' : gx < 0 ? 'tl' : 'tr';
  if (gy >= 0) notes.push('The lit side of your sprites is not clearly on top. Light direction was set from the left/right balance only.');
  // 4. proportions and pixel density
  const fills = [], aspects = [], sizes = new Map();
  for (const s of maps){
    let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.m[y*s.w + x] >= 0){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    fills.push((y1 - y0 + 1) / s.h); aspects.push((y1 - y0 + 1) / (x1 - x0 + 1));
    const sz = Math.max(s.w, s.h); sizes.set(sz, (sizes.get(sz) || 0) + 1);
  }
  const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 32;
  if (sprites.length < 20) notes.push(`Trained on ${sprites.length} sprite${sprites.length === 1 ? '' : 's'}. 20 or more give steadier results.`);
  if (!steps.length) notes.push('No shade ramps were found (flat colors only), so shading rules were left as they were.');
  return {
    count:sprites.length, palette:pal.map(hex), ink:hex(pal[ink]), outline, outlineWidth,
    rampStep:rampStep == null ? null : Math.max(5, Math.min(20, Math.round(rampStep * 100))),
    rampHue:rampHue == null ? null : Math.max(0, Math.min(40, Math.round(rampHue))),
    shadowHue:circMean(shadowT), lightHue:circMean(lightT), shadeBands, shade, light:lightDir,
    rampLength:+avgLen.toFixed(1), charHeight:Math.round((median(fills) || 0.85) * 100), aspect:+(median(aspects) || 1).toFixed(2),
    size, notes
  };
}
// nearest supported size for the trained pixel density
export const nearestSize = n => SIZES.reduce((b, s) => Math.abs(s - n) < Math.abs(b - n) ? s : b, SIZES[0]);
// make the measured style the project's rules; returns the size to preview
export function applyTrained(r){
  S.paletteMode = 'custom';
  Object.assign(S, {outline:r.outline, outlineWidth:r.outlineWidth, outlineHex:r.outline === 'outer' ? r.ink : null,
    shade:r.shade, shadeBands:r.shadeBands, light:r.light, fit:'height', charHeight:Math.max(30, Math.min(100, r.charHeight)), style:'custom', lockPalette:true});
  for (const k of ['rampStep', 'rampHue', 'shadowHue', 'lightHue']) if (r[k] != null) S[k] = r[k];
  // the trained colors are the palette; no per-size color cap, so every learned shade stays available
  for (const N of SIZES) S.profiles[N] = {...profileOf(N), colors:0};
  S.trained = {count:r.count, at:new Date().toISOString().slice(0, 10), size:r.size, aspect:r.aspect};
  setPalette(r.palette.map(unhex)); resetAutoPalette(); dirty.settings = true; emit();
  return nearestSize(r.size);
}

// a style profile: the palette plus every conversion setting, so a whole game matches
export function snapshotTheme(name){ return {app:'pixel-forge', version:1, name, palette:P.rgb.slice(0, P.baseCount).map(hex), settings:{...structuredClone(S), paletteMode:'custom'}}; }
export function isTheme(t){ return !!t && Array.isArray(t.palette) && t.palette.length > 1 && t.palette.every(h => typeof h === 'string'); }
export function applyTheme(t){
  if (!isTheme(t)) return false;
  resetSettings(t.settings || {});
  setPalette(t.palette.map(unhex)); resetAutoPalette();
  for (const a of assets) a.base = {};
  dirty.settings = true; emit();
  return true;
}
// what the project saves: the settings, and the palette when it is fixed
export function settingsSnapshot(){ return {settings:structuredClone(S), palette:S.paletteMode === 'custom' ? P.rgb.slice(0, P.baseCount).map(hex) : null}; }
export function loadSettings(saved){
  resetSettings(saved && saved.settings ? saved.settings : structuredClone(DEFAULTS));
  if (saved && Array.isArray(saved.palette) && saved.palette.length > 1) setPalette(saved.palette.map(unhex));
  resetAutoPalette();
}
