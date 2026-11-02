// Pixel Forge conversion engine, carried over from Sprite Foundry.
// Every pixel is computed from the sketch you give it: no image models run here.
// The functions below are kept close to the original so results stay identical.
/* eslint-disable */
const SIZES = [16, 32, 48, 64, 128];
// Style presets are shading and color RULES (how far shades step, which way hue shifts, outline type), not art.
const STYLES = {
  fantasy:{label:'Fantasy', shade:'form', shadeBands:2, rampStep:11, rampHue:18, shadowHue:280, lightHue:80, outline:'selective', sat:12, contrast:10},
  scifi:{label:'Sci-fi', shade:'form', shadeBands:2, rampStep:13, rampHue:12, shadowHue:235, lightHue:190, outline:'outer', sat:4, contrast:18},
  cartoon:{label:'Cartoon', shade:'cel', shadeBands:1, rampStep:13, rampHue:10, shadowHue:260, lightHue:70, outline:'outer', sat:25, contrast:12},
  anime:{label:'Anime', shade:'cel', shadeBands:1, rampStep:10, rampHue:24, shadowHue:295, lightHue:60, outline:'selective', sat:14, contrast:8},
  realistic:{label:'Realistic', shade:'form', shadeBands:2, rampStep:8, rampHue:6, shadowHue:250, lightHue:80, outline:'selective', sat:0, contrast:8}
};
const DEFAULTS = {
  paletteMode:'auto', autoCount:12,
  bg:'outlined', bgTol:48, fit:'bottom', marginPct:4,
  method:'dominant', lineBoost:1.5, coverage:35,
  bright:0, contrast:10, sat:12,
  dither:'none', ditherAmt:50, despeckle:true,
  outline:'selective', outline8:false, outlineHex:null,
  style:'fantasy', shade:'form', shadeBands:2, light:'tl',
  rampStep:11, rampHue:18, shadowHue:280, lightHue:80, materials:{},
  pixelPerfect:true, cleanShading:true, outlineWidth:1, charHeight:85, trained:null, lockPalette:false,
  variantCount:0, variantSpread:60, exportVariants:false,
  lineDark:40, eraseTol:30, inkGap:3, flatten:true, uncolored:'auto', fillHex:'#a3b1c2',
  // how each size is built: redraw = flat shapes + clean outline (for tiny sprites), keep = downsample the drawing.
  // outline "in" draws the outline on the sprite's own edge pixels, so tiny sprites don't lose 2px of width to it
  profiles:{
    16:{lines:'redraw', inner:false, colors:5, simplify:1, shade:'none', olPos:'in'},
    32:{lines:'redraw', inner:true, colors:8, simplify:1, shade:'global', olPos:'out'},
    48:{lines:'redraw', inner:true, colors:10, simplify:1, shade:'global', olPos:'out'},
    64:{lines:'redraw', inner:true, colors:0, simplify:0, shade:'global', olPos:'out'},
    128:{lines:'redraw', inner:true, colors:0, simplify:0, shade:'global', olPos:'out'}
  },
  exportSizes:{16:true,32:true,48:true,64:true,128:true},
  exportFormats:{godot:true, unity:false, gamemaker:false, spine:false, sequence:false, sheetjson:false},
  godotPath:'res://art/sprites'
};

const S = structuredClone(DEFAULTS);
// replaces every setting in place (a loaded profile or project), so modules holding S see the change
function resetSettings(next){ for (const k of Object.keys(S)) delete S[k]; Object.assign(S, structuredClone(DEFAULTS), next || {}); S.profiles = Object.assign(structuredClone(DEFAULTS.profiles), (next || {}).profiles || {}); S.exportFormats = Object.assign({}, DEFAULTS.exportFormats, (next || {}).exportFormats || {}); S.exportSizes = Object.assign({}, DEFAULTS.exportSizes, (next || {}).exportSizes || {}); }
// asset: {id,name,sample,src,edits:{N:Map},fedits:{animId:{N:{f:Map}}},erasePts,facing,ev,pre,preKey,base,
//         rig:{bones:[], mesh:null}, anims:[{id,name,frames,fps,loop,keys:{boneId:[{f,rot,x,y,sx,sy,ease}]}}], curAnim}
const assets = [];
let nextId = 1;
const getNextId = () => nextId;
function setNextId(n){ nextId = Math.max(nextId, n); }
// the editor records undo history; the engine only asks for a snapshot before changing a rig
let undoHook = () => {};
function setUndoHook(f){ undoHook = f; }
function pushUndo(a){ undoHook(a); }
function newAnim(name){ return {id:nextId++, name, frames:8, fps:8, loop:true, keys:{}}; }
function newAsset(name, src){
  const an = newAnim('idle');
  return {id:nextId++, name, src, edits:{}, fedits:{}, erasePts:[], facing:'right', ev:{}, base:{}, rig:{bones:[], mesh:null}, anims:[an], curAnim:an.id};
}

/* ---------- color math (OKLab) ---------- */
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function oklab(r, g, b){
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
          1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
          0.0259040371*l + 0.7827717662*m - 0.8086757660*s];
}
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const unhex = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };

// OKLab -> sRGB, pulling chroma in until the color fits the sRGB gamut
function labToRgb(L, a, b){
  for (let k = 0; k < 24; k++){
    const l_ = L + 0.3963377774*a + 0.2158037573*b, m_ = L - 0.1055613458*a - 0.0638541728*b, s_ = L - 0.0894841775*a - 1.2914855480*b;
    const l = l_**3, m = m_**3, s = s_**3;
    const lin3 = [4.0767416621*l - 3.3077115913*m + 0.2309699292*s, -1.2684380046*l + 2.6097574011*m - 0.3413193965*s, -0.0041960863*l - 0.7034186147*m + 1.7076147010*s];
    if (lin3.every(v => v >= -0.0005 && v <= 1.0005) || k === 23)
      return lin3.map(v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); });
    a *= 0.9; b *= 0.9;
  }
}
const lch = lab => [lab[0], Math.hypot(lab[1], lab[2]), (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360];
const fromLch = (L, C, h) => labToRgb(L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180));
const hueTo = (h, target, step) => { let d = ((target - h + 540) % 360) - 180; return (h + Math.sign(d) * Math.min(Math.abs(d), step) + 360) % 360; };
const MATERIALS = {cloth:'Cloth / default', skin:'Skin', metal:'Metal', leather:'Leather / wood', glow:'Glow / magic'};
function guessMaterial(lab){
  const [L, C, h] = lch(lab);
  if (C < 0.035 && L > 0.42) return 'metal';
  if (C > 0.03 && C < 0.15 && L > 0.62 && h > 30 && h < 80) return 'skin';
  if (C > 0.03 && L < 0.6 && h > 35 && h < 80) return 'leather';
  return 'cloth';
}
// how far one shading step moves, per material: [lightness step, hue shift scale, shadow chroma, highlight chroma]
const MAT_RULES = {cloth:[1, 1, 1.05, 0.85], skin:[0.8, 0.6, 1.1, 0.9], metal:[1.35, 0.7, 0.8, 0.35], leather:[1, 0.8, 1.0, 0.8], glow:[0.9, 0.5, 1, 0.6]};
const P = {rgb:[], lab:[], dark:[], light:[], mat:[], darkest:0, lightest:0, lut:null, ver:0, baseCount:0};
// setPalette takes the BASE colors (what conversion uses). Shadow and highlight shades are added after them:
// an existing shade of the same hue is reused, otherwise a hue-shifted one is generated (cool shadows, warm light).
function setPalette(list){
  const seen = new Set(), rgb = [];
  for (const c of list){ const h = hex(c); if (!seen.has(h)){ seen.add(h); rgb.push(c.slice(0, 3)); } }
  if (!rgb.length) rgb.push([0,0,0], [255,255,255]);
  P.rgb = rgb.slice(0, 64); P.baseCount = P.rgb.length;
  P.lab = P.rgb.map(c => oklab(...c));
  const nb = P.baseCount;
  P.darkest = 0; P.lightest = 0;
  for (let i = 0; i < nb; i++){ if (P.lab[i][0] < P.lab[P.darkest][0]) P.darkest = i; if (P.lab[i][0] > P.lab[P.lightest][0]) P.lightest = i; }
  P.mat = P.rgb.map((c, i) => (S.materials && S.materials[hex(c)]) || guessMaterial(P.lab[i]));
  P.dark = []; P.light = [];
  const add = (rgb3, mat) => {
    const lab = oklab(...rgb3);
    for (let j = 0; j < P.rgb.length; j++){ const q = P.lab[j]; if ((q[0]-lab[0])**2 + (q[1]-lab[1])**2 + (q[2]-lab[2])**2 < 0.0006) return j; }
    P.rgb.push(rgb3); P.lab.push(lab); P.mat.push(mat); return P.rgb.length - 1;
  };
  // find a same-hue base color about one step darker/lighter, else make one
  const shadeOf = (i, dir) => {
    const mat = P.mat[i], [mL, mH, mCs, mCh] = MAT_RULES[mat] || MAT_RULES.cloth;
    const [L, C, h] = lch(P.lab[i]), dL = ((S.rampStep || 11) / 100) * mL;
    if (dir < 0 && mat === 'glow') return i;
    const targetL = L + dir * (dir > 0 && mat === 'metal' ? dL * 1.5 : dL);
    if (targetL < 0.06 || targetL > 0.985) return i;
    let best = -1, bs = 1e9;
    for (let j = 0; j < nb; j++){
      if (j === i || j === P.darkest) continue;
      const [L2, C2, h2] = lch(P.lab[j]), dl = (L2 - L) * dir;
      if (dl < dL * 0.45 || dl > dL * 1.9) continue;
      const dh = Math.abs(((h2 - h + 540) % 360) - 180);
      if (!(C < 0.03 && C2 < 0.04) && dh > 38) continue;
      const s = (L2 - targetL) ** 2 + (C2 - C) ** 2 * 0.5 + (dh / 360) ** 2 * 0.3;
      if (s < bs){ bs = s; best = j; }
    }
    if (best >= 0 || S.lockPalette) return best >= 0 ? best : i;   // locked palettes never gain colors
    const hs = (S.rampHue ?? 16) * mH;
    const nh = C < 0.02 ? h : hueTo(h, dir < 0 ? (S.shadowHue ?? 265) : (S.lightHue ?? 85), hs);
    const nC = Math.max(0, C * (dir < 0 ? mCs : mCh)) + (C < 0.02 && dir < 0 ? 0.012 : 0);
    return add(fromLch(targetL, nC, nh), mat);
  };
  for (let i = 0; i < nb; i++){
    if (i === P.darkest){ P.dark[i] = i; P.light[i] = i; continue; }
    P.dark[i] = shadeOf(i, -1); P.light[i] = shadeOf(i, 1);
  }
  // generated shades link back so ramps chain (deep shadow = shadow of shadow)
  for (let i = 0; i < P.rgb.length; i++){ if (P.dark[i] == null) P.dark[i] = i; if (P.light[i] == null) P.light[i] = i; }
  for (let i = 0; i < nb; i++){
    const d = P.dark[i], l = P.light[i];
    if (d >= nb){ P.light[d] = i; if (P.dark[d] === d && !S.lockPalette) P.dark[d] = (() => { const [L, C, h] = lch(P.lab[d]); const mat = P.mat[d], [mL, mH, mCs] = MAT_RULES[mat] || MAT_RULES.cloth;
      const tL = L - ((S.rampStep || 11) / 100) * mL; return tL < 0.06 ? d : add(fromLch(tL, C * mCs, C < 0.02 ? h : hueTo(h, S.shadowHue ?? 265, (S.rampHue ?? 16) * mH)), mat); })(); }
    if (l >= nb) P.dark[l] = i;
  }
  for (let i = 0; i < P.rgb.length; i++){ if (P.dark[i] == null) P.dark[i] = i; if (P.light[i] == null) P.light[i] = i; }
  P.lightest = P.rgb.reduce((b, _, i) => P.lab[i][0] > P.lab[b][0] ? i : b, 0);
  P.lut = new Int16Array(32768).fill(-1);
  P.ver++;
}
// limit: search only the first `limit` colors (conversion uses base colors; shades are added by shading)
function nearest(r, g, b, limit = P.lab.length){
  const [L, A, B] = oklab(r, g, b); let bi = 0, bs = 1e9;
  for (let i = 0; i < limit; i++){ const p = P.lab[i]; const d = (L-p[0])**2 + (A-p[1])**2 + (B-p[2])**2; if (d < bs){ bs = d; bi = i; } }
  return bi;
}
function lutNearest(r, g, b){
  const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let v = P.lut[k]; if (v < 0){ v = nearest((r & 248) | 4, (g & 248) | 4, (b & 248) | 4, P.baseCount); P.lut[k] = v; } return v;
}
function medianCut(px, k){
  let boxes = [px];
  while (boxes.length < k){
    let bi = -1, br = 0, bc = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let c = 0; c < 3; c++){ let lo = 255, hi = 0; for (const p of b){ if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } const r = (hi - lo) * Math.sqrt(b.length); if (r > br){ br = r; bi = i; bc = c; } } });
    if (bi < 0) break;
    const b = boxes[bi].sort((p, q) => p[bc] - q[bc]); const m = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
  }
  return boxes.filter(b => b.length).map(b => { const s = [0,0,0]; for (const p of b){ s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => Math.round(v / b.length)); })
    .sort((a, b) => oklab(...a)[0] - oklab(...b)[0]);
}
function bayer(n){ let m = [[0]]; while (m.length < n){ const s = m.length, o = []; for (let y = 0; y < 2*s; y++){ const row = []; for (let x = 0; x < 2*s; x++) row.push(m[y % s][x % s] * 4 + [[0,2],[3,1]][(y / s) | 0][(x / s) | 0]); o.push(row); } m = o; } return m; }
const B2 = bayer(2), B4 = bayer(4), B8 = bayer(8);

/* ---------- stage 1: source preprocessing (background removal + adjustments) ---------- */
function preKey(a){ return [S.bg, S.bgTol, S.bright, S.contrast, S.sat, S.lineDark, S.eraseTol, S.inkGap, S.flatten, S.uncolored, S.fillHex, JSON.stringify(a.erasePts || []), JSON.stringify(a.colorPts || []), a.useAI && a.aiSrc ? 'ai' + (a.aiVer || 0) : 'sketch'].join('|'); }
function adjFn(){
  const br = S.bright * 2.55, c = S.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c)), sat = 1 + S.sat / 100;
  return (r, g, b) => {
    r = f * (r + br - 128) + 128; g = f * (g + br - 128) + 128; b = f * (b + br - 128) + 128;
    const y = 0.299*r + 0.587*g + 0.114*b;
    r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat;
    return [r < 0 ? 0 : r > 255 ? 255 : r | 0, g < 0 ? 0 : g > 255 ? 255 : g | 0, b < 0 ? 0 : b > 255 ? 255 : b | 0];
  };
}
function preprocess(a){
  const k = preKey(a); if (a.pre && a.preKey === k) return a.pre;
  const src = a.useAI && a.aiSrc ? a.aiSrc : a.src;   // the AI-colored version when it is chosen
  const {width:w, height:h} = src, d = new Uint8ClampedArray(src.data);
  const op = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) op[i] = d[i*4+3] >= 128 ? 1 : 0;
  // flood-remove pixels connected to the seeds whose color is within tol of key
  const flood = (seeds, key, tol2) => {
    const near = i => { const dr = d[i*4]-key[0], dg = d[i*4+1]-key[1], db = d[i*4+2]-key[2]; return dr*dr + dg*dg + db*db <= tol2; };
    const st = [], seen = new Uint8Array(w*h);
    const push = i => { if (!seen[i]){ seen[i] = 1; if (op[i] && near(i)) st.push(i); } };
    seeds.forEach(push);
    while (st.length){ const i = st.pop(); op[i] = 0; const x = i % w;
      if (x > 0) push(i-1); if (x < w-1) push(i+1); if (i >= w) push(i-w); if (i < w*(h-1)) push(i+w); }
  };
  const edgeSeeds = () => { const s = []; for (let x = 0; x < w; x++) s.push(x, (h-1)*w + x); for (let y = 0; y < h; y++) s.push(y*w, y*w + w - 1); return s; };
  const lum = i => 0.2126*d[i*4] + 0.7152*d[i*4+1] + 0.0722*d[i*4+2];
  const chroma = i => Math.max(d[i*4], d[i*4+1], d[i*4+2]) - Math.min(d[i*4], d[i*4+1], d[i*4+2]);
  // flood over pixels where test(i) holds, starting from seeds; returns the visited mask
  const floodMask = (seeds, test) => {
    const m = new Uint8Array(w*h), st = [];
    for (const s of seeds) if (!m[s] && test(s)){ m[s] = 1; st.push(s); }
    while (st.length){ const i = st.pop(), x = i % w;
      for (const j of [x > 0 ? i-1 : -1, x < w-1 ? i+1 : -1, i >= w ? i-w : -1, i < w*(h-1) ? i+w : -1])
        if (j >= 0 && !m[j] && test(j)){ m[j] = 1; st.push(j); } }
    return m;
  };
  let warn = '';
  if ((S.bg === 'paper' || S.bg === 'outlined') && S.flatten) flattenPaper(d, w, h);
  // areas the person clicked on the sketch (shadows, stray marks) go first, so they can't act as an outline
  for (const pt of a.erasePts || []){
    const sx = Math.min(w-1, Math.max(0, Math.floor(pt.x * w))), sy = Math.min(h-1, Math.max(0, Math.floor(pt.y * h))), s0 = sy*w + sx;
    if (op[s0]) flood([s0], [d[s0*4], d[s0*4+1], d[s0*4+2]], S.eraseTol * S.eraseTol);
  }
  if (S.bg === 'outlined'){
    // Inside my outline: whatever can be reached from the image edge without crossing ink is background.
    // Paper texture, lighting, shadows and stains outside the drawn border can't survive this.
    const inkMax = S.lineDark / 100 * 255;
    const ink = new Uint8Array(w*h);
    for (let i = 0; i < w*h; i++) if (op[i] && lum(i) < inkMax && chroma(i) < 70) ink[i] = 1;
    // close small breaks in the border: grow ink by `gap` pixels before flooding
    const gap = S.inkGap | 0; let wall = ink;
    for (let k = 0; k < gap; k++){ const nx = wall.slice();
      for (let i = 0; i < w*h; i++) if (!wall[i]){ const x = i % w;
        if ((x > 0 && wall[i-1]) || (x < w-1 && wall[i+1]) || (i >= w && wall[i-w]) || (i < w*(h-1) && wall[i+w])) nx[i] = 1; }
      wall = nx; }
    const bgm = floodMask(edgeSeeds(), i => !wall[i]);
    // give back the ring the wall borrowed on the outside of the line
    for (let k = 0; k < gap; k++){ const nx = bgm.slice();
      for (let i = 0; i < w*h; i++) if (!bgm[i] && !ink[i]){ const x = i % w;
        if ((x > 0 && bgm[i-1]) || (x < w-1 && bgm[i+1]) || (i >= w && bgm[i-w]) || (i < w*(h-1) && bgm[i+w])) nx[i] = 1; }
      bgm.set(nx); }
    let kept = 0; for (let i = 0; i < w*h; i++){ if (bgm[i]) op[i] = 0; else if (op[i]) kept++; }
    if (kept < w * h * 0.005) warn = 'Your outline looks open, so the inside leaked out. Raise "Close gaps" or close the line.';
  } else if (S.bg === 'paper'){
    // Photo of paper: paper = bright and nearly colorless after the lighting fix
    const minL = 255 - S.bgTol * 0.9, maxC = 25 + S.bgTol * 0.3;
    const isPaper = i => op[i] && lum(i) >= minL && chroma(i) < maxC;
    const bgm = floodMask(edgeSeeds(), isPaper);
    for (let i = 0; i < w*h; i++) if (bgm[i]) op[i] = 0;
    // paper showing through closed gaps: remove paper patches bigger than a speck (eye highlights stay)
    const seen = new Uint8Array(w*h), minArea = w * h * 0.0015;
    for (let s = 0; s < w*h; s++){
      if (seen[s] || !isPaper(s)) continue;
      const comp = [s], st = [s]; seen[s] = 1;
      while (st.length){ const i = st.pop(), x = i % w;
        for (const j of [x > 0 ? i-1 : -1, x < w-1 ? i+1 : -1, i >= w ? i-w : -1, i < w*(h-1) ? i+w : -1])
          if (j >= 0 && !seen[j] && isPaper(j)){ seen[j] = 1; st.push(j); comp.push(j); } }
      if (comp.length > minArea) for (const i of comp) op[i] = 0;
    }
    // shadows and table edges: colorless blobs that run off the photo's border are not artwork
    const lab = new Int32Array(w*h).fill(-1);
    for (let s = 0; s < w*h; s++){
      if (!op[s] || lab[s] >= 0) continue;
      const comp = [s], st = [s]; lab[s] = s; let edge = false, chr = 0;
      while (st.length){ const i = st.pop(), x = i % w; chr += chroma(i);
        if (x === 0 || x === w-1 || i < w || i >= w*(h-1)) edge = true;
        for (const j of [x > 0 ? i-1 : -1, x < w-1 ? i+1 : -1, i >= w ? i-w : -1, i < w*(h-1) ? i+w : -1])
          if (j >= 0 && op[j] && lab[j] < 0){ lab[j] = s; st.push(j); comp.push(j); } }
      if (edge && chr / comp.length < 24) for (const i of comp) op[i] = 0;
    }
  } else if (S.bg !== 'none'){
    const corners = [0, w-1, (h-1)*w, h*w-1].filter(i => op[i]);
    if (corners.length){
      const key = [0,1,2].map(c => corners.reduce((s, i) => s + d[i*4+c], 0) / corners.length);
      const tol2 = S.bgTol * S.bgTol;
      if (S.bg === 'key'){ for (let i = 0; i < w*h; i++){ const dr = d[i*4]-key[0], dg = d[i*4+1]-key[1], db = d[i*4+2]-key[2]; if (op[i] && dr*dr + dg*dg + db*db <= tol2) op[i] = 0; } }
      else {
        const seeds = [];
        for (let x = 0; x < w; x++) seeds.push(x, (h-1)*w + x);
        for (let y = 0; y < h; y++) seeds.push(y*w, y*w + w - 1);
        flood(seeds, key, tol2);
        // "gaps" mode: background showing through closed gaps (between an arm and the body) is not connected
        // to the edge, so remove leftover background-colored patches bigger than a speck. Opt-in, because
        // white paint (spots, eye whites) looks the same as paper.
        const seen = new Uint8Array(w*h), minArea = S.bg === 'gaps' ? w * h * 0.001 : Infinity;
        const near = i => { const dr = d[i*4]-key[0], dg = d[i*4+1]-key[1], db = d[i*4+2]-key[2]; return dr*dr + dg*dg + db*db <= tol2; };
        for (let s = 0; s < w*h; s++){
          if (seen[s] || !op[s] || !near(s)) continue;
          const comp = [s], st = [s]; seen[s] = 1;
          while (st.length){ const i = st.pop(), x = i % w;
            for (const j of [x > 0 ? i-1 : -1, x < w-1 ? i+1 : -1, i >= w ? i-w : -1, i < w*(h-1) ? i+w : -1])
              if (j >= 0 && !seen[j] && op[j] && near(j)){ seen[j] = 1; st.push(j); comp.push(j); } }
          if (comp.length > minArea) for (const i of comp) op[i] = 0;
        }
      }
    }
  }
  // line art: bare paper left inside the drawing. Fill it so the sprite gets real color, shading and an outline
  // instead of a white silhouette. "auto" only does this when most of the drawing is unpainted.
  let unpainted = 0, filledPaper = false;
  if (S.bg === 'outlined' || S.bg === 'paper'){
    const minL = 255 - S.bgTol * 0.9, maxC = 25 + S.bgTol * 0.3, paperPx = []; let kept = 0;
    for (let i = 0; i < w*h; i++){ if (!op[i]) continue; kept++; if (lum(i) >= minL && chroma(i) < maxC) paperPx.push(i); }
    unpainted = kept ? paperPx.length / kept : 0;
    if (S.uncolored === 'fill' || (S.uncolored !== 'keep' && unpainted > 0.45)){
      const fc = unhex(S.fillHex || '#a3b1c2'); for (const i of paperPx){ d[i*4] = fc[0]; d[i*4+1] = fc[1]; d[i*4+2] = fc[2]; }
      filledPaper = paperPx.length > 0;
    }
  }
  // areas the person colored: flood from each click over pixels of the clicked color, stopping at ink lines,
  // so one click colors the hair (or jacket, or skin) on the sketch itself and every size follows
  if (a.colorPts && a.colorPts.length){
    const inkMax = S.lineDark / 100 * 255, isInk = i => lum(i) < inkMax && chroma(i) < 70;
    for (const cp of a.colorPts){
      let s0 = -1, bd = 1e9; const cx = Math.floor(cp.x * w), cy = Math.floor(cp.y * h);
      // the click may land on a line: use the nearest non-line pixel
      for (let y = Math.max(0, cy - 8); y <= Math.min(h - 1, cy + 8); y++) for (let x = Math.max(0, cx - 8); x <= Math.min(w - 1, cx + 8); x++){
        const i = y*w + x; if (!op[i] || isInk(i)) continue; const dd = (x - cx) ** 2 + (y - cy) ** 2; if (dd < bd){ bd = dd; s0 = i; } }
      if (s0 < 0) continue;
      const key = [d[s0*4], d[s0*4+1], d[s0*4+2]], fc = unhex(cp.hex), tol2 = 40 * 40;
      const m = floodMask([s0], i => { if (!op[i] || isInk(i)) return false; const dr = d[i*4]-key[0], dg = d[i*4+1]-key[1], db = d[i*4+2]-key[2]; return dr*dr + dg*dg + db*db <= tol2; });
      for (let i = 0; i < w*h; i++) if (m[i]){ d[i*4] = fc[0]; d[i*4+1] = fc[1]; d[i*4+2] = fc[2]; }
    }
  }
  // drop dust: opaque islands far smaller than the main drawing (JPEG noise, paper marks) would stretch the framing box
  {
    const lab = new Int32Array(w*h).fill(-1), sizes = [];
    for (let s = 0; s < w*h; s++){
      if (!op[s] || lab[s] >= 0) continue;
      const id = sizes.length, st = [s]; lab[s] = id; let n = 0;
      while (st.length){ const i = st.pop(), x = i % w; n++;
        for (const j of [x > 0 ? i-1 : -1, x < w-1 ? i+1 : -1, i >= w ? i-w : -1, i < w*(h-1) ? i+w : -1])
          if (j >= 0 && op[j] && lab[j] < 0){ lab[j] = id; st.push(j); } }
      sizes.push(n);
    }
    const big = Math.max(0, ...sizes), minKeep = Math.max(12, big * 0.004);
    for (let i = 0; i < w*h; i++) if (op[i] && sizes[lab[i]] < minKeep) op[i] = 0;
  }
  const adj = adjFn(), line = new Uint8Array(w*h), lineMax = S.lineDark / 100 * 255;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = y*w + x;
    if (!op[i]){ d[i*4+3] = 0; continue; }
    const r = d[i*4], g = d[i*4+1], b = d[i*4+2];
    // ink = dark AND close to neutral, so dark navy or deep red fills are not mistaken for line art
    if (0.2126*r + 0.7152*g + 0.0722*b < lineMax && Math.max(r, g, b) - Math.min(r, g, b) < 28) line[i] = 1;
    const c = adj(r, g, b); d[i*4] = c[0]; d[i*4+1] = c[1]; d[i*4+2] = c[2]; d[i*4+3] = 255;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bbox = x1 < 0 ? {x:0, y:0, w, h} : {x:x0, y:y0, w:x1-x0+1, h:y1-y0+1};
  a.pre = {w, h, d, bbox, line, warn, unpainted, filledPaper}; a.preKey = k; a.base = {};
  return a.pre;
}
// Fit a smooth quadratic surface to the paper (bright, colorless pixels) per channel and divide it out.
function flattenPaper(d, w, h){
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 16000))), samples = [];
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step){
    const i = (y*w + x) * 4, r = d[i], g = d[i+1], b = d[i+2];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 40) samples.push([x / w, y / h, r, g, b, 0.2126*r + 0.7152*g + 0.0722*b]);
  }
  if (samples.length < 50) return;
  const sorted = samples.map(s => s[5]).sort((p, q) => p - q), cutL = sorted[Math.floor(sorted.length * 0.4)];
  let pts = samples.filter(s => s[5] >= cutL);
  const terms = (x, y) => [1, x, y, x*x, x*y, y*y];
  const fit = (pts, ch) => {
    const A = Array.from({length:6}, () => new Float64Array(7));
    for (const p of pts){ const t = terms(p[0], p[1]); for (let r = 0; r < 6; r++){ for (let c = 0; c < 6; c++) A[r][c] += t[r] * t[c]; A[r][6] += t[r] * p[ch]; } }
    for (let r = 0; r < 6; r++) A[r][r] += 1e-6;
    for (let c = 0; c < 6; c++){ let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < 6; r++) if (r !== c){ const f = A[r][c] / A[c][c]; for (let k = c; k < 7; k++) A[r][k] -= f * A[c][k]; } }
    return A.map((row, r) => row[6] / row[r]);
  };
  const evalF = (co, x, y) => { const t = terms(x, y); let v = 0; for (let k = 0; k < 6; k++) v += co[k] * t[k]; return v; };
  let co = [2, 3, 4].map(ch => fit(pts, ch));
  // second pass: drop samples clearly darker than the first fit (drawing, not paper)
  pts = pts.filter(p => p[5] >= 0.88 * (0.2126*evalF(co[0], p[0], p[1]) + 0.7152*evalF(co[1], p[0], p[1]) + 0.0722*evalF(co[2], p[0], p[1])));
  if (pts.length > 30) co = [2, 3, 4].map(ch => fit(pts, ch));
  for (let y = 0; y < h; y++){ const ny = y / h;
    for (let x = 0; x < w; x++){ const i = (y*w + x) * 4, nx = x / w;
      for (let c = 0; c < 3; c++){ const bgv = Math.max(40, evalF(co[c], nx, ny)); d[i+c] = Math.min(255, d[i+c] * 248 / bgv); } } }
}
function autoPalette(){
  // fills and ink are sampled separately: thick line art would otherwise eat half the palette with near-blacks
  const px = [], ink = [0, 0, 0]; let inkN = 0;
  for (const a of assets){ const p = preprocess(a), n = p.w*p.h, step = Math.max(1, Math.floor(n / (24000 / assets.length)));
    for (let i = 0; i < n; i += step){ if (!p.d[i*4+3]) continue;
      if (p.line[i]){ ink[0] += p.d[i*4]; ink[1] += p.d[i*4+1]; ink[2] += p.d[i*4+2]; inkN++; }
      else px.push([p.d[i*4], p.d[i*4+1], p.d[i*4+2]]); } }
  if (!px.length && !inkN) return [[0,0,0],[255,255,255]];
  // merge near-identical results (a big flat area splits into several almost-equal shades otherwise)
  const raw = px.length ? medianCut(px, Math.max(2, S.autoCount - (inkN ? 1 : 0))) : [], cols = [];
  for (const c of raw){ const L = oklab(...c); if (!cols.some(q => { const M = oklab(...q); return (L[0]-M[0])**2 + (L[1]-M[1])**2 + (L[2]-M[2])**2 < 0.0009; })) cols.push(c); }
  if (inkN) cols.unshift(ink.map(v => Math.round(v / inkN)));
  return cols;
}

/* ---------- stage 2: downscale to an indexed sprite ---------- */
function marginPx(N, p){ const lineArt = p && (p.unpainted || 0) > 0.45; return Math.round(S.marginPct / 100 * N) + (S.outline !== 'none' && (profileOf(N).olPos !== 'in' || lineArt) ? 1 : 0); }
const profileOf = N => Object.assign({lines:'keep', inner:true, colors:0, simplify:0, shade:'global', olPos:'out'}, S.profiles && S.profiles[N]);
function baseKey(a, N){ return [a.preKey, P.ver, S.fit, S.marginPct, S.outline, S.method, S.lineBoost, S.coverage, S.dither, S.ditherAmt, S.despeckle, JSON.stringify(profileOf(N)), a.ev[N] || 0].join('|'); }
function buildBase(a, N){
  preprocess(a);
  if (!P.lut) setPalette(autoPalette());
  const k = baseKey(a, N); if (a.base[N] && a.base[N].key === k) return a.base[N].idx;
  const prof = profileOf(N);
  const out = prof.lines === 'redraw' ? redrawBase(a.pre, N, prof) : downsampleBase(a.pre, N);
  if (prof.colors > 0) limitColors(out, prof.colors);
  for (let pass = 0; pass < prof.simplify; pass++) simplifyPass(out, N);
  if (S.despeckle) despeckle(out, N);
  const ed = a.edits[N];
  if (ed) for (const [i, h] of ed) out[i] = h === null ? -1 : nearest(...unhex(h));
  a.base[N] = {key:k, idx:out};
  return out;
}
// where the drawing lands inside the N×N cell
function frameRect(p, N){
  const bb = S.fit === 'full' ? {x:0, y:0, w:p.w, h:p.h} : p.bbox;
  const m = marginPx(N, p), inner = Math.max(1, N - 2*m);
  // "height": every character is drawn the same number of pixels tall (the profile's pixel density),
  // shrinking only if it would not fit the cell sideways
  const scale = S.fit === 'height'
    ? Math.max(bb.h / Math.max(1, Math.min(inner, Math.round(N * (+S.charHeight || 85) / 100))), bb.w / inner)
    : Math.max(bb.w, bb.h) / inner;
  const tw = Math.max(1, Math.min(inner, Math.round(bb.w / scale))), th = Math.max(1, Math.min(inner, Math.round(bb.h / scale)));
  return {bb, scale, tw, th, ox:Math.floor((N - tw) / 2), oy:S.fit === 'bottom' || S.fit === 'height' ? N - m - th : Math.floor((N - th) / 2)};
}
// Low-res "redraw": the drawn line art is not shrunk. Each cell takes the dominant FILL color under it;
// cells that are mostly line become outline space (on the edge) or an inner line (inside), so the app's
// own 1px outline replaces the sketch's thick strokes and texture doesn't turn into noise.
function redrawBase(p, N, prof){
  const out = new Int16Array(N*N).fill(-1), lineCell = new Int16Array(N*N).fill(-1), inkShare = new Float32Array(N*N), fillOf = new Int16Array(N*N).fill(-1);
  const {bb, scale, tw, th, ox, oy} = frameRect(p, N), lineArt = (p.unpainted || 0) > 0.45;
  // a lower fill cutoff than "keep" mode so thin limbs and spikes survive at tiny sizes
  const votes = new Float32Array(P.rgb.length), touched = [], cut = S.coverage / 100 * 0.7;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++){
    const sx0 = bb.x + tx * scale, sy0 = bb.y + ty * scale, xa = Math.floor(sx0), ya = Math.floor(sy0);
    const xb = Math.min(p.w, Math.max(xa + 1, Math.ceil(sx0 + scale))), yb = Math.min(p.h, Math.max(ya + 1, Math.ceil(sy0 + scale)));
    let tot = 0, opq = 0, lines = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++){
      const pi = y * p.w + x, i = pi * 4; tot++;
      if (!p.d[i+3]) continue; opq++;
      if (p.line[pi]){ lines++; continue; }
      const ci = lutNearest(p.d[i], p.d[i+1], p.d[i+2]);
      if (votes[ci] === 0) touched.push(ci); votes[ci]++;
    }
    let best = -1, bv = 0; for (const ci of touched){ if (votes[ci] > bv){ bv = votes[ci]; best = ci; } votes[ci] = 0; } touched.length = 0;
    const j = (oy + ty) * N + ox + tx;
    if (!tot) continue;
    // line art: the lines ARE the drawing, so any cell a line crosses becomes ink. Bigger sprites keep thinner
    // lines (face, hair strands, folds); small ones keep only the bold lines, so they stay readable.
    if (lineArt && lines >= Math.max(1, scale * (N >= 64 ? 0.8 : N >= 48 ? 1.2 : 1.8))){ out[j] = -2; lineCell[j] = N >= 64 ? -5 : -6; inkShare[j] = opq ? lines / opq : 1; fillOf[j] = best; continue; }
    // a pen stroke crossing the cell keeps it, even when the stroke is far thinner than one pixel at this size:
    // "at least a 1.5px-wide stroke in the source" scales with the size, so thin lines survive at 16 and 32 too
    const stroke = lines >= Math.max(2, 1.5 * scale), sparse = opq / tot < cut;
    if (sparse && !stroke) continue;
    // inside a filled shape, only solid marks (eyes, bold inner lines) stay ink; fine texture lines (scales,
    // hatching) give way to the fill so small sprites don't drown in black
    if (sparse){ out[j] = -2; lineCell[j] = -4; }      // -4: only a thin stroke passes through here
    else if (best < 0 || lines / opq >= 0.7){ lineCell[j] = best < 0 ? -3 : best; out[j] = -2; }
    else out[j] = best;
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? -1 : out[y*N + x];
  const lineIdx = S.outline === 'selective' ? null : P.darkest;
  const res = out.slice();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const j = y*N + x; if (out[j] !== -2) continue;
    const n4 = [at(x-1, y), at(x+1, y), at(x, y-1), at(x, y+1)];
    const n8 = [...n4, at(x-1, y-1), at(x+1, y-1), at(x-1, y+1), at(x+1, y+1)];
    if (lineCell[j] === -5){
      // line-art ink: the drawn outline (on the edge) always stays, and becomes the sprite's outline; inner lines
      // stay when this size keeps inner lines, otherwise they give way to the surrounding fill
      const fills = n4.filter(v => v >= 0);
      res[j] = prof.inner || !fills.length || n4.some(v => v === -1) ? P.darkest : modeOf(fills);
      continue;
    }
    if (lineCell[j] === -6){
      // small line-art sprites: the drawn outline makes way for a clean 1px outline around the fill, and only dense
      // ink (eyes, a mass of hair strands) stays inside, so thin figures keep their color instead of turning black
      const fills = n4.filter(v => v >= 0);
      if (!n8.some(v => v >= 0)) res[j] = P.darkest;
      else if (n4.some(v => v === -1)) res[j] = -1;
      else res[j] = prof.inner && inkShare[j] >= (N >= 48 ? 0.32 : 0.45) ? P.darkest : (fills.length ? modeOf(fills) : fillOf[j] >= 0 ? fillOf[j] : P.darkest);
      continue;
    }
    if (!n8.some(v => v >= 0)){ res[j] = P.darkest; continue; }      // a stroke on its own (antenna, whisker, staff): keep it as ink
    if (lineCell[j] === -4){ res[j] = -1; continue; }                // a thin stroke hugging a filled shape: the auto outline covers it
    if (n4.some(v => v === -1)){ res[j] = -1; continue; }           // on a filled shape's edge: the auto outline goes here
    const fills = n4.filter(v => v >= 0);
    if (!fills.length){ res[j] = P.darkest; continue; }              // thin feature drawn only as a line: keep it
    const mode = modeOf(fills), fb = lineCell[j] >= 0 ? lineCell[j] : mode;
    res[j] = prof.inner ? (lineIdx ?? P.dark[P.dark[fb]]) : fb;
  }
  out.set(res);
  if (lineArt) out.lineArt = true;     // tells the outline step to use the drawing's ink color
  return out;
}
function modeOf(list){ const c = new Map(); let b = list[0], bc = 0; for (const v of list){ const n = (c.get(v) || 0) + 1; c.set(v, n); if (n > bc){ bc = n; b = v; } } return b; }
// keep only the `max` most-used palette colors, merging the rest into their nearest kept color
function limitColors(out, max){
  const cnt = new Map(); for (const v of out) if (v >= 0) cnt.set(v, (cnt.get(v) || 0) + 1);
  const keepDark = cnt.has(P.darkest);
  const used = [...cnt.keys()], remap = new Map();
  while (used.length > max + (keepDark ? 1 : 0)){
    used.sort((a, b) => cnt.get(a) - cnt.get(b));
    const vi = used.findIndex(v => v !== P.darkest); const v = used.splice(vi, 1)[0];
    let best = used[0], bd = 1e9;
    for (const u of used){ if (u === P.darkest && used.length > 1) continue; const A = P.lab[v], B = P.lab[u]; const dd = (A[0]-B[0])**2 + (A[1]-B[1])**2 + (A[2]-B[2])**2; if (dd < bd){ bd = dd; best = u; } }
    remap.set(v, best); cnt.set(best, cnt.get(best) + cnt.get(v));
  }
  if (!remap.size) return;
  for (let i = 0; i < out.length; i++){ let v = out[i]; while (remap.has(v)) v = remap.get(v); out[i] = v; }
}
// majority filter: removes texture noise and fills pinholes, keeps the silhouette
function simplifyPass(out, N){
  const src = out.slice(), at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? -1 : src[y*N + x];
  const cnt = new Map();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const v = src[y*N + x];
    if (v < 0){
      const n4 = [at(x-1, y), at(x+1, y), at(x, y-1), at(x, y+1)].filter(q => q >= 0);
      if (n4.length >= 3) out[y*N + x] = modeOf(n4);
      continue;
    }
    if (v === P.darkest) continue;   // ink details (eyes, inner lines) are deliberate, never "noise"
    cnt.clear();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const q = at(x + dx, y + dy); if (q >= 0) cnt.set(q, (cnt.get(q) || 0) + 1); }
    for (const [q, c] of cnt) if (q !== v && c >= 5 && (cnt.get(v) || 0) <= 2){ out[y*N + x] = q; break; }
  }
}
function despeckle(out, N){
  const src = out.slice(), at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? -1 : src[y*N + x];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const v = src[y*N + x]; if (v < 0) continue;
    const n4 = [at(x-1,y), at(x+1,y), at(x,y-1), at(x,y+1)];
    // only truly isolated specks go: a 1px diagonal pen line touches its neighbors only at the corners
    if (n4.every(q => q < 0) && [at(x-1,y-1), at(x+1,y-1), at(x-1,y+1), at(x+1,y+1)].every(q => q < 0)) out[y*N + x] = -1;
    else if (n4[0] >= 0 && n4.every(q => q === n4[0]) && n4[0] !== v) out[y*N + x] = n4[0];
    else if (S.pixelPerfect && n4.filter(q => q >= 0).length === 1){
      const k = n4.findIndex(q => q >= 0), [dx, dy] = [[-1, 0], [1, 0], [0, -1], [0, 1]][k];
      const f1 = dx ? at(x + dx, y - 1) : at(x - 1, y + dy), f2 = dx ? at(x + dx, y + 1) : at(x + 1, y + dy);
      if (f1 >= 0 && f2 >= 0) out[y*N + x] = -1;
    }
  }
}
function downsampleBase(p, N){
  const out = new Int16Array(N*N).fill(-1);
  const {bb, scale, tw, th, ox, oy} = frameRect(p, N);
  const votes = new Float32Array(P.rgb.length), touched = [];
  const cut = S.coverage / 100, boost = S.lineBoost;
  const bm = S.dither === 'b2' ? B2 : S.dither === 'b4' ? B4 : null, bn = bm ? bm.length : 1, damt = S.ditherAmt / 100 * 64;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++){
    const sx0 = bb.x + tx * scale, sy0 = bb.y + ty * scale;
    const xa = Math.floor(sx0), ya = Math.floor(sy0);
    const xb = Math.min(p.w, Math.max(xa + 1, Math.ceil(sx0 + scale))), yb = Math.min(p.h, Math.max(ya + 1, Math.ceil(sy0 + scale)));
    let tot = 0, opq = 0, sr = 0, sg = 0, sb = 0;
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++){
      const i = (y * p.w + x) * 4; tot++;
      if (!p.d[i+3]) continue; opq++;
      const r = p.d[i], g = p.d[i+1], b = p.d[i+2];
      if (S.method === 'dominant'){
        const ci = lutNearest(r, g, b);
        const dark = Math.max(0, 0.6 - P.lab[ci][0]) / 0.6;
        if (votes[ci] === 0) touched.push(ci);
        votes[ci] += 1 + boost * dark * dark * 4;
      } else { sr += r; sg += g; sb += b; }
    }
    let idx = -1;
    if (tot && opq / tot >= cut){
      if (S.method === 'dominant'){ let bv = -1; for (const ci of touched) if (votes[ci] > bv){ bv = votes[ci]; idx = ci; } }
      else {
        let r = sr / opq, g = sg / opq, b = sb / opq;
        if (bm){ const t = ((bm[(oy+ty) % bn][(ox+tx) % bn] + 0.5) / (bn*bn) - 0.5) * damt; r += t; g += t; b += t; }
        idx = nearest(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)), P.baseCount);
      }
    }
    for (const ci of touched) votes[ci] = 0; touched.length = 0;
    out[(oy + ty) * N + ox + tx] = idx;
  }
  return out;
}

/* ---------- stage 3: shading + outline (all colors stay in the palette) ---------- */
// chamfer distance (in pixels) from each opaque pixel to the nearest boundary: transparency, or a pixel
// that sameRegion() says belongs to a different color region
function edgeDistance(src, N, sameRegion){
  const INF = 1e6, d = new Float32Array(N*N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const i = y*N + x; if (src[i] < 0){ d[i] = 0; continue; }
    let edge = x === 0 || y === 0 || x === N-1 || y === N-1;
    if (!edge) for (const j of [i-1, i+1, i-N, i+N]) if (src[j] < 0 || !sameRegion(src[i], src[j])){ edge = true; break; }
    d[i] = edge ? 1 : INF;
  }
  const pass = (y0, y1, dy, x0, x1, dx) => {
    for (let y = y0; y !== y1; y += dy) for (let x = x0; x !== x1; x += dx){
      const i = y*N + x; if (d[i] <= 1) continue;
      for (const [ox, oy, c] of [[-dx, 0, 1], [0, -dy, 1], [-dx, -dy, 1.414], [dx, -dy, 1.414]]){
        const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny*N + nx; if (src[j] < 0 || !sameRegion(src[i], src[j])) continue;
        if (d[j] + c < d[i]) d[i] = d[j] + c;
      }
    }
  };
  pass(0, N, 1, 0, N, 1); pass(N-1, -1, -1, N-1, -1, -1);
  return d;
}
// Volume shading: treat each color region (and the whole silhouette) as a soft dome, light it from the
// chosen direction, and band the result into ramp steps. Gives shaped shadows instead of 1px edge rims.
function formShade(src, N, out, cel){
  const region = (a, b) => a === b || P.light[a] === b || P.dark[a] === b || P.light[b] === a || P.dark[b] === a;
  const dR = edgeDistance(src, N, region), dG = edgeDistance(src, N, () => true);
  const cap = Math.max(2, N / 7), h = new Float32Array(N*N);
  for (let i = 0; i < N*N; i++) if (src[i] >= 0) h[i] = 0.6 * Math.min(dR[i], cap) + 0.4 * Math.min(dG[i], cap * 1.6);
  for (let pass = 0; pass < 2; pass++){ const t = h.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){ const i = y*N + x; if (src[i] < 0) continue; let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; s += t[yy*N + xx]; n++; }
      h[i] = s / n; } }
  const lx = S.light === 'tl' ? -1 : S.light === 'tr' ? 1 : 0, ly = -1, lz = 1.1, lLen = Math.hypot(lx, ly, lz);
  const nz = Math.max(0.6, cap * 0.45), flat = lz / lLen;
  const H = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? 0 : h[y*N + x];
  const lvl = new Int8Array(N*N), bands = +S.shadeBands || 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const i = y*N + x, v = src[i]; if (v < 0) continue;
    const gx = (H(x+1, y) - H(x-1, y)) / 2, gy = (H(x, y+1) - H(x, y-1)) / 2;
    const nl = Math.hypot(gx, gy, nz), I = (-gx * lx - gy * ly + nz * lz) / (nl * lLen) - flat;
    const mat = P.mat[v];
    const hiT = cel ? 0.16 : mat === 'metal' ? 0.06 : 0.1, shT = cel ? -0.12 : mat === 'metal' ? -0.12 : -0.16, deepT = mat === 'metal' ? -0.34 : -0.42;
    let L = 0;
    if (I > hiT) L = 1;
    else if (mat !== 'glow' && I < shT) L = bands >= 2 && !cel && I < deepT ? -2 : -1;
    lvl[i] = L;
  }
  if (S.cleanShading){
    // smooth levels inside each color region, then fold tiny clusters back into the base color
    const src2 = lvl.slice();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const i = y*N + x, v = src[i]; if (v < 0) continue; const cnt = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){ const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const j = yy*N + xx; if (src[j] !== v) continue; cnt.set(src2[j], (cnt.get(src2[j]) || 0) + 1); }
      for (const [l, c] of cnt) if (l !== src2[i] && c >= 5){ lvl[i] = l; break; }
    }
    const minC = N <= 32 ? 2 : 3, seen = new Uint8Array(N*N);
    for (let s = 0; s < N*N; s++){
      if (seen[s] || src[s] < 0 || lvl[s] === 0) continue;
      const comp = [s], st = [s]; seen[s] = 1;
      while (st.length){ const i = st.pop(), x = i % N;
        for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1])
          if (j >= 0 && !seen[j] && src[j] === src[s] && lvl[j] === lvl[s]){ seen[j] = 1; st.push(j); comp.push(j); } }
      if (comp.length < minC) for (const i of comp) lvl[i] = 0;
    }
  }
  for (let i = 0; i < N*N; i++){ const v = src[i]; if (v < 0 || v === P.darkest) continue;
    out[i] = lvl[i] === 1 ? P.light[v] : lvl[i] === -1 ? P.dark[v] : lvl[i] === -2 ? P.dark[P.dark[v]] : v; }
}
// steps: 'both' (still sprites), 'shade' (rig: shade the rest pose so shading moves with it), 'outline' (rig: after deforming)
function finalize(src, N, steps = 'both'){
  const out = src.slice(), at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? -1 : src[y*N + x];
  const pr = profileOf(N).shade, shade = steps === 'outline' ? 'none' : pr === 'global' ? S.shade : pr;
  if (shade === 'form' || shade === 'cel') formShade(src, N, out, shade === 'cel');
  else if (shade !== 'none'){
    const lx = S.light === 'tl' ? -1 : S.light === 'tr' ? 1 : 0, ly = -1;
    const depth = shade === 'deep' ? 2 : 1, hl = shade !== 'rim';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const v = src[y*N + x]; if (v < 0) continue;
      let shadow = 0;
      for (let k = 1; k <= depth && !shadow; k++) if ((lx && at(x - lx*k, y) < 0) || at(x, y - ly*k) < 0) shadow = k;
      if (shadow) out[y*N + x] = shadow === 1 && depth === 2 ? P.dark[P.dark[v]] : P.dark[v];
      else if (hl && ((lx && at(x + lx, y) < 0) || at(x, y + ly) < 0)) out[y*N + x] = P.light[v];
    }
  }
  if (steps === 'shade') return out;
  if (S.outline !== 'none'){
    // line-art sprites take the drawing's own ink for their outline, whatever the outline style says
    const solid = S.outline === 'outer' || src.lineArt, olc = src.lineArt ? P.darkest : S.outlineHex ? nearest(...unhex(S.outlineHex)) : P.darkest;
    const dirs = S.outline8 ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] : [[1,0],[-1,0],[0,1],[0,-1]];
    // line art always outlines outside: tiny line-art figures are thin, and an inside outline would swallow them
    const ol = new Uint8Array(N*N), inside = profileOf(N).olPos === 'in' && !src.lineArt, shadedOut = out.slice();
    if (inside){
      // inside: the sprite's own edge pixels become the outline, so the silhouette doesn't grow
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        const v = src[y*N + x]; if (v < 0) continue;
        if (dirs.some(([dx, dy]) => at(x + dx, y + dy) < 0)){ ol[y*N + x] = 1; out[y*N + x] = solid ? olc : P.dark[P.dark[v]]; }
      }
    } else for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      if (src[y*N + x] >= 0) continue;
      for (const [dx, dy] of dirs){ const q = at(x + dx, y + dy); if (q >= 0 && q !== P.darkest){ ol[y*N + x] = 1; out[y*N + x] = solid ? olc : P.dark[P.dark[q]]; break; } }
    }
    if (S.pixelPerfect){
      // pixel-perfect: drop the elbow pixel of every L in the outline, so lines step diagonally 1px at a time
      const snap = ol.slice(), So = (x, y) => x >= 0 && y >= 0 && x < N && y < N && snap[y*N + x];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        if (!So(x, y)) continue;
        for (const [ax, ay, bx, by] of [[-1, 0, 0, -1], [0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0]]){
          if (!So(x + ax, y + ay) || !So(x + bx, y + by)) continue;
          const i = y*N + x;
          if (inside){
            // the elbow turns back into fill if that doesn't open the sprite to the outside
            if (at(x - ax, y - ay) >= 0 && at(x - bx, y - by) >= 0 && src[i] >= 0){ ol[i] = 0; out[i] = shadedOut[i]; break; }
          } else if (S.outline8){
            // only diagonal-only outline pixels can go (they don't cover any fill side)
            if (![[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => at(x + dx, y + dy) >= 0)){ ol[i] = 0; out[i] = -1; break; }
          }
        }
      }
    }
    // thick outlines: a second outside ring, only where there's room for it (48 px and up)
    if (+S.outlineWidth === 2 && !inside && N >= 48){
      const ring = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        const i = y*N + x; if (out[i] >= 0) continue;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < N && yy < N && ol[yy*N + xx]){ ring.push([i, out[yy*N + xx]]); break; } }
      }
      for (const [i, c] of ring) out[i] = c;
    }
  }
  return out;
}
// pal: an optional replacement palette (color variants reuse the same indexed sprite)
function toImage(idx, N, pal = P.rgb){
  const im = new ImageData(N, N);
  for (let i = 0; i < N*N; i++){ const v = idx[i]; if (v < 0) continue; const c = pal[v]; im.data[i*4] = c[0]; im.data[i*4+1] = c[1]; im.data[i*4+2] = c[2]; im.data[i*4+3] = 255; }
  return im;
}
// color variants: rotate the hue of every colorful palette entry (skin and ink stay put), lightness unchanged
function variantPalettes(){
  const out = [], n = +S.variantCount || 0;
  // a color belongs to a skin ramp if it, or the shade next to it in either direction, is skin
  const skin = i => [i, P.light[i], P.dark[i], P.light[P.light[i]], P.dark[P.dark[i]]].some(j => P.mat[j] === 'skin');
  for (let k = 1; k <= n; k++){
    const rot = k * (+S.variantSpread || 60);
    out.push(P.rgb.map((c, i) => {
      const [L, C, h] = lch(P.lab[i]);
      if (i === P.darkest || C < 0.03 || skin(i)) return c;
      return fromLch(L, C, (h + rot) % 360);
    }));
  }
  return out;
}

/* ---------- stage 4: skeletal animation (bones, mesh skinning, keyframes) ---------- */
// Everything in the rig lives in normalized sprite space (0..1 across the cell), so one rig drives every size.
// Translations in poses are stored in "px at 32" (1 = one pixel on a 32×32 sprite) to keep numbers readable.
// 2D affine matrix [a, b, c, d, e, f] maps (x, y) -> (a*x + c*y + e, b*x + d*y + f)
const mMul = (m, n) => [m[0]*n[0] + m[2]*n[1], m[1]*n[0] + m[3]*n[1], m[0]*n[2] + m[2]*n[3], m[1]*n[2] + m[3]*n[3], m[0]*n[4] + m[2]*n[5] + m[4], m[1]*n[4] + m[3]*n[5] + m[5]];
const mInv = m => { const det = (m[0]*m[3] - m[1]*m[2]) || 1e-9; return [m[3]/det, -m[1]/det, -m[2]/det, m[0]/det, (m[2]*m[5] - m[3]*m[4])/det, (m[1]*m[4] - m[0]*m[5])/det]; };
const mApply = (m, x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
const mTRS = (tx, ty, rot, sx = 1, sy = 1) => { const c = Math.cos(rot), s = Math.sin(rot); return [c*sx, s*sx, -s*sy, c*sy, tx, ty]; };
const IDENT = [1, 0, 0, 1, 0, 0];
const boneAngle = b => Math.atan2(b.ty - b.hy, b.tx - b.hx);
const boneLen = b => Math.hypot(b.tx - b.hx, b.ty - b.hy);
const restMat = b => mTRS(b.hx, b.hy, boneAngle(b));
const REST = {rot:0, x:0, y:0, sx:1, sy:1};
const CHANNELS = ['rot', 'x', 'y', 'sx', 'sy'];
// parents before children
function boneOrder(bones){
  const out = [], seen = new Set(), byId = new Map(bones.map(b => [b.id, b]));
  const visit = b => { if (seen.has(b.id)) return; seen.add(b.id); const p = byId.get(b.parent); if (p) visit(p); out.push(b); };
  bones.forEach(visit); return out;
}
function descendants(bones, id){ const out = new Set([id]); let grew = true; while (grew){ grew = false; for (const b of bones) if (!out.has(b.id) && out.has(b.parent)){ out.add(b.id); grew = true; } } out.delete(id); return out; }
// world matrices for a pose. Bone world = parentWorld · T(move, in parent space) · localRest · R(rot) · S(scale)
function worldPose(bones, pose){
  const W = {}, R = {};
  for (const b of boneOrder(bones)){
    const rest = restMat(b); R[b.id] = rest;
    const hasP = b.parent != null && R[b.parent];
    const local = hasP ? mMul(mInv(R[b.parent]), rest) : rest;
    const p = pose[b.id] || REST;
    W[b.id] = mMul(hasP ? W[b.parent] : IDENT, mMul(mTRS(p.x / 32, p.y / 32, 0), mMul(local, mTRS(0, 0, p.rot * Math.PI / 180, p.sx, p.sy))));
  }
  return {W, R};
}
const posedEnds = (W, b) => ({head:mApply(W[b.id], 0, 0), tail:mApply(W[b.id], boneLen(b), 0)});

// keyframes: an.keys[boneId] = sorted [{f, rot, x, y, sx, sy, ease}]; ease shapes the move toward the next key
const EASES = {ease:t => t*t*(3 - 2*t), linear:t => t, in:t => t*t, out:t => 1 - (1 - t)*(1 - t), step:() => 0};
function channelsAt(keys, f, F, loop){
  if (!keys || !keys.length) return {...REST};
  let list = keys;
  if (loop && keys.length) list = [{...keys[keys.length - 1], f:keys[keys.length - 1].f - F}, ...keys, {...keys[0], f:keys[0].f + F}];
  let k0 = null, k1 = null;
  for (const k of list){ if (k.f <= f) k0 = k; if (k.f >= f && !k1) k1 = k; }
  if (!k0) k0 = k1; if (!k1) k1 = k0;
  if (k0 === k1 || k1.f === k0.f) return pick(k0);
  const t = (EASES[k0.ease] || EASES.ease)((f - k0.f) / (k1.f - k0.f)), o = {};
  for (const c of CHANNELS) o[c] = k0[c] + (k1[c] - k0[c]) * t;
  return o;
}
const pick = k => ({rot:k.rot, x:k.x, y:k.y, sx:k.sx, sy:k.sy});
function poseAt(a, an, f){ const pose = {}; for (const b of a.rig.bones) pose[b.id] = channelsAt(an.keys[b.id], f, an.frames, an.loop); return pose; }
function setKey(an, boneId, f, vals, ease){
  const list = an.keys[boneId] || (an.keys[boneId] = []);
  let k = list.find(q => q.f === f);
  if (!k){ k = {f, ...REST, ease:ease || 'ease'}; list.push(k); list.sort((p, q) => p.f - q.f); }
  Object.assign(k, vals); if (ease) k.ease = ease;
  return k;
}

// mesh: a grid of quads (two triangles each) over the sprite's pixels, built in rest space
function buildMesh(a, grid){
  const N = 64, base = buildBase(a, N), g = Math.max(4, grid | 0), on = new Uint8Array(g * g);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (base[y*N + x] >= 0) on[Math.min(g-1, (y / N * g) | 0) * g + Math.min(g-1, (x / N * g) | 0)] = 1;
  // pad by two cells so lower sizes (whose silhouettes differ slightly) are still fully covered
  let cells = on;
  for (let k = 0; k < 2; k++){ const nx = cells.slice();
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) if (!cells[j*g + i])
      for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){ const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < g && jj < g && cells[jj*g + ii]){ nx[j*g + i] = 1; break; } }
    cells = nx; }
  const vid = new Map(), verts = [], tris = [];
  const v = (i, j) => { const k = j * (g + 1) + i; if (!vid.has(k)){ vid.set(k, verts.length); verts.push([i / g, j / g]); } return vid.get(k); };
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) if (cells[j*g + i]){
    const a0 = v(i, j), b0 = v(i + 1, j), c0 = v(i, j + 1), d0 = v(i + 1, j + 1);
    tris.push([a0, b0, d0], [a0, d0, c0]);
  }
  return {grid:g, verts, tris, weights:verts.map(() => ({})), painted:false, srcKey:a.base[N] && a.base[N].key};
}
function segDist(x, y, b){
  const vx = b.tx - b.hx, vy = b.ty - b.hy, L2 = vx*vx + vy*vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - b.hx) * vx + (y - b.hy) * vy) / L2));
  return Math.hypot(x - (b.hx + vx*t), y - (b.hy + vy*t));
}
// automatic weights: inverse distance to each bone, sharpened, three strongest bones per vertex
function autoWeights(mesh, bones){
  if (!mesh) return;
  mesh.weights = mesh.verts.map(([x, y]) => {
    if (!bones.length) return {};
    const ws = bones.map(b => [b.id, 1 / Math.pow(segDist(x, y, b) + 0.012, 4)]).sort((p, q) => q[1] - p[1]).slice(0, 3);
    const sum = ws.reduce((s, w) => s + w[1], 0), o = {};
    for (const [id, w] of ws) if (w / sum > 0.02) o[id] = w / sum;
    return normW(o);
  });
  mesh.painted = false;
}
function normW(o){ const s = Object.values(o).reduce((p, q) => p + q, 0); if (s > 0) for (const k in o) o[k] /= s; return o; }
// paint the selected bone's influence: add, remove, or smooth toward the neighborhood average
function paintWeights(mesh, bones, boneId, cx, cy, r, strength, mode){
  const near = [];
  mesh.verts.forEach(([x, y], i) => { const dd = Math.hypot(x - cx, y - cy); if (dd < r) near.push([i, 1 - dd / r]); });
  if (!near.length) return false;
  const avg = mode === 'smooth' ? near.reduce((s, [i]) => s + (mesh.weights[i][boneId] || 0), 0) / near.length : 0;
  for (const [i, fall] of near){
    const w = mesh.weights[i], curW = w[boneId] || 0, f = strength * fall;
    const nw = Math.max(0, Math.min(1, mode === 'add' ? curW + (1 - curW) * f : mode === 'sub' ? curW * (1 - f) : curW + (avg - curW) * f));
    const others = Object.keys(w).filter(k => +k !== boneId), oSum = others.reduce((s, k) => s + w[k], 0);
    if (others.length && oSum > 1e-6) for (const k of others) w[k] = w[k] / oSum * (1 - nw);
    else if (nw < 1){
      // nothing else holds this vertex: hand the rest to the nearest other bone
      const [x, y] = mesh.verts[i]; let best = null, bd = 1e9;
      for (const b of bones) if (b.id !== boneId){ const dd = segDist(x, y, b); if (dd < bd){ bd = dd; best = b.id; } }
      if (best != null) w[best] = 1 - nw;
    }
    w[boneId] = nw; for (const k in w) if (w[k] < 1e-4) delete w[k];
    normW(w);
  }
  mesh.painted = true;
  return true;
}
// snapN: when set, each bone's joint lands on a whole pixel of an N×N sprite, so rigid parts move pixel-perfect
function skinVerts(mesh, bones, pose, snapN){
  const {W, R} = worldPose(bones, pose), Sk = {};
  for (const b of bones){
    const m = mMul(W[b.id], mInv(R[b.id]));
    // snap how far the joint moved (not where it sits), so the rest pose stays exactly the drawn sprite
    if (snapN){ const p = mApply(m, b.hx, b.hy), dx = p[0] - b.hx, dy = p[1] - b.hy; m[4] += Math.round(dx * snapN) / snapN - dx;
      m[5] += Math.round(dy * snapN) / snapN - dy; }
    Sk[b.id] = m;
  }
  return mesh.verts.map(([x, y], i) => {
    let ox = 0, oy = 0, tw = 0;
    for (const id in mesh.weights[i]){ const m = Sk[id]; if (!m) continue; const w = mesh.weights[i][id], p = mApply(m, x, y); ox += p[0] * w; oy += p[1] * w; tw += w; }
    return tw > 0 ? [ox / tw, oy / tw] : [x, y];
  });
}
// triangle draw order follows the draw order of the bone that owns most of it
function triOrder(mesh, bones){
  const z = new Map(bones.map(b => [b.id, b.z || 0]));
  if (mesh.triLayer) return mesh.tris.map((t, k) => [k, z.get(mesh.triLayer[k]) || 0]).sort((p, q) => p[1] - q[1]).map(p => p[0]);
  return mesh.tris.map((t, k) => {
    const acc = {}; for (const vi of t) for (const id in mesh.weights[vi]) acc[id] = (acc[id] || 0) + mesh.weights[vi][id];
    let best = null, bw = -1; for (const id in acc) if (acc[id] > bw){ bw = acc[id]; best = id; }
    return [k, best == null ? 0 : (z.get(+best) || 0)];
  }).sort((p, q) => p[1] - q[1]).map(p => p[0]);
}
// draw the deformed mesh: 3×3 supersampled, each sample looks up the rest-pose pixel under it, then majority vote
// tex: per-layer textures for layered meshes (each triangle only shows its own layer's pixels)
function renderSkinned(base, N, mesh, def, order, tex){
  const SS = 3, M = N * SS, buf = new Int16Array(M * M).fill(-1);
  for (const t of order){
    const src = tex && mesh.triLayer ? tex.get(mesh.triLayer[t]) : base; if (!src) continue;
    const [i0, i1, i2] = mesh.tris[t];
    const ax = def[i0][0]*M, ay = def[i0][1]*M, bx = def[i1][0]*M, by = def[i1][1]*M, cx = def[i2][0]*M, cy = def[i2][1]*M;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(area) < 1e-9) continue;
    const r0 = mesh.verts[i0], r1 = mesh.verts[i1], r2 = mesh.verts[i2];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(M - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(M - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++){
      const sx = px + 0.5, sy = py + 0.5;
      const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) / area, w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) / area, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const rx = Math.floor((w0*r0[0] + w1*r1[0] + w2*r2[0]) * N), ry = Math.floor((w0*r0[1] + w1*r1[1] + w2*r2[1]) * N);
      if (rx < 0 || ry < 0 || rx >= N || ry >= N) continue;
      const v = src[ry*N + rx]; if (v >= 0) buf[py*M + px] = v;
    }
  }
  const out = new Int16Array(N * N).fill(-1), cnt = new Map();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    cnt.clear(); let opq = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++){ const v = buf[(y*SS + j) * M + x*SS + i]; if (v >= 0){ opq++; cnt.set(v, (cnt.get(v) || 0) + 1); } }
    if (opq >= 5){ let bv = -1, bc = 0; for (const [v, c] of cnt) if (c > bc){ bc = c; bv = v; } out[y*N + x] = bv; }
  }
  // close pinholes the deformation opened inside the body
  for (let pass = 0; pass < 2; pass++){
    const src = out.slice(), at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? -1 : src[y*N + x];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      if (src[y*N + x] >= 0 || base[y*N + x] < 0) continue;
      const n = [at(x-1, y), at(x+1, y), at(x, y-1), at(x, y+1)].filter(v => v >= 0);
      if (n.length >= 3) out[y*N + x] = modeOf(n);
    }
  }
  return out;
}
// make sure a rigged sketch has a mesh that matches its current pixels
function ensureMesh(a){
  const rig = a.rig; if (!rig.bones.length) return null;
  buildBase(a, 64);
  const key = a.base[64] && a.base[64].key;
  if (rig.labels){
    if (!rig.mesh || !rig.mesh.layered || (!rig.mesh.painted && rig.mesh.srcKey !== key)) rig.mesh = buildLayeredMesh(a, rig.mesh ? rig.mesh.grid : 24);
  } else if (!rig.mesh || (!rig.mesh.painted && rig.mesh.srcKey !== key)){ rig.mesh = buildMesh(a, rig.mesh ? rig.mesh.grid : 20); autoWeights(rig.mesh, rig.bones); }
  return rig.mesh;
}
function rigFrames(base, N, an, a){
  const frames = [], mesh = ensureMesh(a), bones = a.rig.bones, order = mesh ? triOrder(mesh, bones) : null;
  // shading is painted onto the rest pose first so it travels with each part, like a real texture
  const shaded = mesh ? finalize(base, N, 'shade') : null;
  const tex = mesh && mesh.triLayer && a.rig.labels ? layerTextures(a, N, shaded) : null, snap = a.rig.snap !== false ? N : 0;
  for (let f = 0; f < Math.max(1, an.frames | 0); f++){
    const rend = mesh ? renderSkinned(shaded, N, mesh, skinVerts(mesh, bones, poseAt(a, an, f), snap), order, tex) : null;
    if (rend) rend.lineArt = base.lineArt;
    const fin = mesh ? finalize(rend, N, 'outline') : finalize(base, N);
    const fe = a.fedits && a.fedits[an.id] && a.fedits[an.id][N] && a.fedits[an.id][N][f];
    if (fe) for (const [i, h] of fe) fin[i] = h === null ? -1 : nearest(...unhex(h));
    frames.push(fin);
  }
  return frames;
}

/* ---------- auto-rig: read the body from the silhouette, then build bones, layers and weights ---------- */
const LR = 128;   // analysis and layer-mask resolution (normalized rig space sampled at 128×128)
const N8 = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
// Zhang-Suen thinning: shrinks the silhouette to a 1px-wide center line that keeps its shape's branches
function thin(src, N){
  const m = src.slice(), P = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? 0 : m[y*N + x];
  for (let changed = true; changed;){
    changed = false;
    for (let pass = 0; pass < 2; pass++){
      const del = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        if (!m[y*N + x]) continue;
        const p = [P(x, y-1), P(x+1, y-1), P(x+1, y), P(x+1, y+1), P(x, y+1), P(x-1, y+1), P(x-1, y), P(x-1, y-1)];
        const B = p.reduce((s, v) => s + v, 0); if (B < 2 || B > 6) continue;
        let A = 0; for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++; if (A !== 1) continue;
        if (pass === 0 ? (p[0] && p[2] && p[4]) || (p[2] && p[4] && p[6]) : (p[0] && p[2] && p[6]) || (p[0] && p[4] && p[6])) continue;
        del.push(y*N + x);
      }
      for (const i of del) m[i] = 0; if (del.length) changed = true;
    }
  }
  return m;
}
const skDeg = (sk, N, i) => { const x = i % N, y = (i / N) | 0; let d = 0; for (const [dx, dy] of N8){ const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && sk[yy*N + xx]) d++; } return d; };
const skNbrs = (sk, N, i) => { const x = i % N, y = (i / N) | 0, o = []; for (const [dx, dy] of N8){ const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < N && yy < N && sk[yy*N + xx]) o.push(yy*N + xx); } return o; };
// remove short spurs (bumps in the outline make tiny side branches)
// how many separate skeleton lines leave pixel i (3+ = a real branch point; a 2px-thick spot on a line is still 2)
const crossings = (sk, N, i) => { const x = i % N, y = (i / N) | 0, P2 = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < N && yy < N && sk[yy*N + xx] ? 1 : 0; };
  const ring = [P2(0,-1), P2(1,-1), P2(1,0), P2(1,1), P2(0,1), P2(-1,1), P2(-1,0), P2(-1,-1)]; let A = 0; for (let k = 0; k < 8; k++) if (!ring[k] && ring[(k + 1) % 8]) A++; return A; };
function prune(sk, N, minLen){
  for (let round = 0; round < 3; round++){
    for (let i = 0; i < N*N; i++){
      if (!sk[i] || !isEnd(sk, N, i)) continue;
      const branch = [i], seen = new Set([i]); let cur = i, hitJunction = false;
      while (branch.length <= minLen){
        const nx = skNbrs(sk, N, cur).filter(j => !seen.has(j));
        if (!nx.length) break;                                   // the whole line is short and stands alone: keep it
        // step along the line, preferring straight (4-connected) neighbors
        nx.sort((p, q) => (Math.abs(p - cur) === 1 || Math.abs(p - cur) === N ? 0 : 1) - (Math.abs(q - cur) === 1 || Math.abs(q - cur) === N ? 0 : 1));
        for (const j of nx) seen.add(j);
        cur = nx[0];
        if (crossings(sk, N, cur) >= 3){ hitJunction = true; break; }
        branch.push(cur);
      }
      if (hitJunction && branch.length < minLen) for (const j of branch) sk[j] = 0;
    }
  }
  return sk;
}
// an end: its skeleton neighbors form one unbroken group (so 2px-thick tips count, not just single-neighbor ones)
const isEnd = (sk, N, i) => { const x = i % N, y = (i / N) | 0, P2 = (dx, dy) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < N && yy < N && sk[yy*N + xx] ? 1 : 0; };
  const ring = [P2(0,-1), P2(1,-1), P2(1,0), P2(1,1), P2(0,1), P2(-1,1), P2(-1,0), P2(-1,-1)], deg = ring.reduce((s, v) => s + v, 0);
  let A = 0; for (let k = 0; k < 8; k++) if (!ring[k] && ring[(k + 1) % 8]) A++; return deg >= 1 && deg <= 2 && A === 1; };
const skEnds = (sk, N) => { const o = []; for (let i = 0; i < N*N; i++) if (sk[i] && isEnd(sk, N, i)) o.push([i % N, (i / N) | 0]); return o; };
// shortest path along the skeleton (8-connected BFS); null when the two points aren't connected
function skPath(sk, N, a, b){
  const snap = p => { let best = -1, bd = 1e9; for (let i = 0; i < N*N; i++) if (sk[i]){ const d = (i % N - p[0]) ** 2 + (((i / N) | 0) - p[1]) ** 2; if (d < bd){ bd = d; best = i; } } return best; };
  const s = snap(a), t = snap(b); if (s < 0 || t < 0) return null;
  const prev = new Int32Array(N*N).fill(-2); prev[s] = -1; const q = [s];
  for (let h = 0; h < q.length; h++){ const i = q[h]; if (i === t) break; for (const j of skNbrs(sk, N, i)) if (prev[j] === -2){ prev[j] = i; q.push(j); } }
  if (prev[t] === -2) return null;
  const path = []; for (let i = t; i !== -1; i = prev[i]) path.push([i % N, (i / N) | 0]); return path.reverse();
}
const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const along = (path, t, a, b) => path && path.length > 2 ? path[Math.min(path.length - 1, Math.round((path.length - 1) * t))] : lerp2(a, b, t);
function maskInfo(m, N){
  let x0 = N, y0 = N, x1 = -1, y1 = -1, sx = 0, n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y*N + x]){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; n++; }
  const row = y => { let a = -1, b = -1, s = 0, c = 0; y = Math.max(0, Math.min(N - 1, Math.round(y))); for (let x = 0; x < N; x++) if (m[y*N + x]){ if (a < 0) a = x; b = x; s += x; c++; } return {a, b, c, mid:c ? s / c : (x0 + x1) / 2}; };
  return {x0, y0, x1, y1, W:x1 - x0 + 1, H:y1 - y0 + 1, cx:n ? sx / n : N / 2, row};
}
// fill holes smaller than ~1% of the sprite so the center line doesn't loop around them
function closeHoles(m, N){
  const out = m.slice(), bg = new Uint8Array(N*N), st = [];
  for (let i = 0; i < N; i++) for (const j of [i, (N-1)*N + i, i*N, i*N + N - 1]) if (!m[j] && !bg[j]){ bg[j] = 1; st.push(j); }
  while (st.length){ const i = st.pop(), x = i % N; for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1]) if (j >= 0 && !m[j] && !bg[j]){ bg[j] = 1; st.push(j); } }
  const seen = new Uint8Array(N*N), area = m.reduce((s, v) => s + v, 0);
  for (let s = 0; s < N*N; s++){ if (m[s] || bg[s] || seen[s]) continue; const comp = [s], q = [s]; seen[s] = 1;
    while (q.length){ const i = q.pop(), x = i % N; for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1]) if (j >= 0 && !m[j] && !bg[j] && !seen[j]){ seen[j] = 1; q.push(j); comp.push(j); } }
    if (comp.length < area * 0.01) for (const i of comp) out[i] = 1; }
  return out;
}
// Humanoid: head = top end, feet = two lowest ends, hands = side ends, joints placed along the paths between them
// armHint: 'auto' (detect), 'side' (arms hang down the body: hands in pockets, arms at rest), 'out' (trust any side tip)
function fitHumanoid(m, N, facing, armHint = 'auto'){
  const I = maskInfo(m, N), {x0, y0, x1, y1, W, H, cx} = I, notes = [];
  const sk = prune(thin(closeHoles(m, N), N), N, Math.max(3, Math.round(H * 0.06)));
  const ends = skEnds(sk, N), near = (p, q, r) => Math.hypot(p[0] - q[0], p[1] - q[1]) < r;
  // how thick the body is at each pixel (distance to the silhouette edge): arms are thin, jackets and torsos are not
  const dt = edgeDistance(Int16Array.from(m, v => v ? 0 : -1), N, () => true);
  // neck: the narrowest row in the upper body; head: the mass above it (so a big hair tuft can't drag it sideways)
  let neckY = Math.round(y0 + H * 0.22), minW = 1e9;
  for (let y = Math.round(y0 + H * 0.12); y <= y0 + H * 0.4; y++){ const r = I.row(y); if (r.c && r.c < minW){ minW = r.c; neckY = y; } }
  let hs = 0, hn = 0; for (let y = y0; y < neckY; y++) for (let x = x0; x <= x1; x++) if (m[y*N + x]){ hs += x; hn++; }
  const headX = hn ? hs / hn : cx, head = [headX, y0 + (neckY - y0) * 0.04];
  const neck = [(I.row(neckY).mid + headX) / 2, neckY];
  // feet
  let feet = ends.filter(p => p[1] > y0 + H * 0.72).sort((p, q) => p[0] - q[0]);
  let footL = feet[0], footR = feet[feet.length - 1], legsFromSkel = true;
  if (feet.length < 2 || footR[0] - footL[0] < W * 0.12){
    legsFromSkel = false;
    const band = Math.max(1, Math.round(H * 0.05)), xs = [];
    for (let y = y1 - band; y <= y1; y++) for (let x = x0; x <= x1; x++) if (m[y*N + x]) xs.push(x);
    xs.sort((p, q) => p - q);
    let gap = 0, at = -1; for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k-1] > gap){ gap = xs[k] - xs[k-1]; at = k; }
    if (gap > 2 && at > 0){ const l = xs.slice(0, at), r = xs.slice(at); footL = [l.reduce((s, v) => s + v, 0) / l.length, y1]; footR = [r.reduce((s, v) => s + v, 0) / r.length, y1]; }
    else { footL = [cx - W * 0.12, y1]; footR = [cx + W * 0.12, y1]; notes.push('The legs are not separated at the bottom (a robe or merged legs?), so both leg bones share that area.'); }
  }
  // pelvis: the top of the gap between the legs
  let pelvis = null;
  if (legsFromSkel){ const p = skPath(sk, N, footL, footR); if (p) pelvis = p.reduce((b, q) => q[1] < b[1] ? q : b, p[0]); }
  if (!pelvis || pelvis[1] < y0 + H * 0.38 || pelvis[1] > y0 + H * 0.72) pelvis = [cx, y0 + H * 0.55];
  pelvis = [I.row(pelvis[1]).mid, pelvis[1]];
  const shY = neck[1] + H * 0.06, shRow = I.row(shY), half = Math.max(2, (shRow.b - shRow.a) / 2);
  const shoulder = side => [neck[0] + side * Math.min(half * 0.55, W * 0.2), shY];
  const shL = shoulder(-1), shR = shoulder(1);
  // hands: a side tip only counts if the way out to it is thin like an arm (a jacket corner is wide where it starts)
  const armOk = (sh, p) => {
    const len = Math.hypot(p[0] - sh[0], p[1] - sh[1]); if (len < H * 0.15 || len > H * 0.65) return false;
    if (armHint === 'out') return true;
    const path = skPath(sk, N, sh, p); if (!path || path.length < 4) return false;
    const outer = path.slice(Math.floor(path.length * 0.45)), mean = outer.reduce((s, q) => s + dt[q[1]*N + q[0]], 0) / outer.length;
    return mean <= Math.max(1.6, H * 0.085);    // measured: drawn arms run 0.05-0.07 of the height, jacket corners 0.12+
  };
  const mids = ends.filter(p => p[1] > y0 + H * 0.15 && p[1] < y0 + H * 0.82 && !near(p, head, 3));
  const pick = left => armHint === 'side' ? null : mids.filter(p => left ? p[0] < cx - W * 0.08 : p[0] > cx + W * 0.08)
    .sort((p, q) => left ? p[0] - q[0] : q[0] - p[0]).find(p => armOk(left ? shL : shR, p)) || null;
  // no separate hand: the arm hangs down the side of the body to about hip height (hands in pockets, arms at rest)
  const hanging = left => { const y = Math.min(pelvis[1] - H * 0.02, y0 + H * 0.55), r = I.row(y), inset = (r.b - r.a) * 0.12;
    return [left ? r.a + inset : r.b - inset, y]; };
  let handL = pick(true), handR = pick(false);
  const freeL = !!handL, freeR = !!handR;
  if (!handL) handL = hanging(true);
  if (!handR) handR = hanging(false);
  // weapon tip: a thin center-line end that sticks up past the shoulders, away from the head (a raised sword or staff)
  let weapon = null;
  // a tip whose center line runs back into the head without dropping below the neck belongs to the head
  // (a hair tuft, a horn, a hat); a held weapon is reached through the hand, below the neck
  const viaBody = p => { const path = skPath(sk, N, p, pelvis); return !path || path.some(q => q[1] > neck[1] + H * 0.05 && Math.abs(q[0] - neck[0]) > W * 0.12); };
  const tips = ends.filter(p => p[1] < neck[1] - H * 0.02 && Math.abs(p[0] - headX) > W * 0.18 && dt[p[1]*N + p[0]] <= H * 0.04 && viaBody(p));
  const tip = tips.sort((p, q) => Math.hypot(q[0] - cx, q[1] - neck[1]) - Math.hypot(p[0] - cx, p[1] - neck[1]))[0];
  if (tip){
    const side = tip[0] > cx ? 'r' : 'l', sh = side === 'r' ? shR : shL, other = side === 'r' ? handL : handR, oSh = side === 'r' ? shL : shR;
    // the hand sits along the arm at the other arm's length, measured along the center line toward the tip
    const armLen = Math.hypot(other[0] - oSh[0], other[1] - oSh[1]), path = skPath(sk, N, sh, tip);
    let hand = lerp2(sh, tip, Math.min(0.6, armLen / Math.max(1, Math.hypot(tip[0] - sh[0], tip[1] - sh[1]))));
    if (path){ let acc = 0; for (let k = 1; k < path.length; k++){ acc += Math.hypot(path[k][0] - path[k-1][0], path[k][1] - path[k-1][1]); if (acc >= armLen){ hand = path[k]; break; } } }
    if (side === 'r') handR = hand; else handL = hand;
    weapon = {from:hand, to:tip, side};
  } else if (freeL && freeR){
    // otherwise: one free hand reaching far beyond the other usually means it is holding something
    const lenL = Math.hypot(handL[0] - shL[0], handL[1] - shL[1]), lenR = Math.hypot(handR[0] - shR[0], handR[1] - shR[1]);
    if (lenR > lenL * 1.6){ const t2 = handR; handR = lerp2(shR, t2, lenL / lenR); weapon = {from:handR, to:t2, side:'r'}; }
    else if (lenL > lenR * 1.6){ const t2 = handL; handL = lerp2(shL, t2, lenR / lenL); weapon = {from:handL, to:t2, side:'l'}; }
  }
  // say which arms were placed by rule, not found (an arm holding a weapon counts as found)
  const hangL = !freeL && !(weapon && weapon.side === 'l'), hangR = !freeR && !(weapon && weapon.side === 'r');
  if ((hangL || hangR) && armHint === 'auto') notes.push(hangL && hangR ? 'No hands stick out of the silhouette, so both arms hang down the sides of the body. Pick Arms: out from body if that is wrong.' : 'One hand does not stick out of the silhouette, so that arm hangs down the side of the body.');
  const pa = (a, b) => skPath(sk, N, a, b);
  // free arms follow the center line; hanging arms run straight down the body
  const pathL = freeL ? pa(shL, handL) : null, pathR = freeR ? pa(shR, handR) : null;
  const elbowL = along(pathL, 0.5, shL, handL), wristL = along(pathL, 0.82, shL, handL);
  const elbowR = along(pathR, 0.5, shR, handR), wristR = along(pathR, 0.82, shR, handR);
  const hipL = [pelvis[0] - Math.min(W * 0.08, Math.abs(pelvis[0] - footL[0]) * 0.5), pelvis[1]], hipR = [pelvis[0] + Math.min(W * 0.08, Math.abs(footR[0] - pelvis[0]) * 0.5), pelvis[1]];
  const legL = pa(hipL, footL), legR = pa(hipR, footR);
  const kneeL = along(legL, 0.5, hipL, footL), ankleL = along(legL, 0.88, hipL, footL);
  const kneeR = along(legR, 0.5, hipR, footR), ankleR = along(legR, 0.88, hipR, footR);
  // toes point the way the sprite faces
  const toe = (ank, foot) => { const dir = facing === 'left' ? -1 : 1; let best = [foot[0], y1];
    for (let y = Math.round(y1 - H * 0.05); y <= y1; y++) for (let x = Math.round(foot[0] - W * 0.14); x <= foot[0] + W * 0.14; x++) if (x >= 0 && x < N && m[y*N + x] && (x - best[0]) * dir > 0) best = [x, y];
    return Math.hypot(best[0] - ank[0], best[1] - ank[1]) < 1.5 ? [ank[0] + dir * 2, y1] : best; };
  const J = {head, neck, pelvis, shL, shR, elbowL, wristL, handL, elbowR, wristR, handR, hipL, kneeL, ankleL, toeL:toe(ankleL, footL), hipR, kneeR, ankleR, toeR:toe(ankleR, footR), weapon};
  return {J, notes, sk};
}
function bonesFromHumanoid(J, N, facing){
  const nm = p => [(p[0] + 0.5) / N, (p[1] + 0.5) / N], out = [], id = {};
  const mk = (name, parent, h, t, connected, z) => { const [hx, hy] = nm(h), [tx, ty] = nm(t); const b = {id:nextId++, name, parent:parent ? id[parent] : null, connected:!!connected, hx, hy, tx, ty, z}; id[name] = b.id; out.push(b); return b; };
  // the limbs on the side the sprite faces are drawn in front of the body
  const front = facing === 'left' ? 'l' : 'r', zArm = s => s === front ? 6 : -2, zLeg = s => s === front ? 0 : -1;
  const spineMid = lerp2(J.pelvis, J.neck, 0.45);
  mk('hips', null, J.pelvis, spineMid, false, 1);
  mk('torso', 'hips', spineMid, J.neck, true, 2);
  mk('head', 'torso', J.neck, J.head, true, 4);
  for (const s of ['l', 'r']){
    const S2 = s === 'l' ? 'L' : 'R';
    mk('upper_arm_' + s, 'torso', J['sh' + S2], J['elbow' + S2], false, zArm(s));
    mk('lower_arm_' + s, 'upper_arm_' + s, J['elbow' + S2], J['wrist' + S2], true, zArm(s));
    mk('hand_' + s, 'lower_arm_' + s, J['wrist' + S2], J['hand' + S2], true, zArm(s));
    mk('upper_leg_' + s, 'hips', J['hip' + S2], J['knee' + S2], false, zLeg(s));
    mk('lower_leg_' + s, 'upper_leg_' + s, J['knee' + S2], J['ankle' + S2], true, zLeg(s));
    mk('foot_' + s, 'lower_leg_' + s, J['ankle' + S2], J['toe' + S2], true, zLeg(s));
  }
  if (J.weapon) mk('weapon', 'hand_' + J.weapon.side, J.weapon.from, J.weapon.to, false, zArm(J.weapon.side) + 1);
  return out;
}
// Creature / chain: the longest center-line path becomes a spine chain; long side branches become limbs
function fitChain(m, N){
  const I = maskInfo(m, N), notes = [];
  const sk = prune(thin(closeHoles(m, N), N), N, Math.max(3, Math.round(Math.max(I.W, I.H) * 0.05)));
  const ends = skEnds(sk, N), out = [];
  const nm = p => [(p[0] + 0.5) / N, (p[1] + 0.5) / N];
  const mk = (name, parent, h, t, connected, z) => { const [hx, hy] = nm(h), [tx, ty] = nm(t); const b = {id:nextId++, name, parent, connected, hx, hy, tx, ty, z}; out.push(b); return b; };
  // longest path: farthest end from any end, then farthest from that
  const far = from => { let best = null, bl = -1; for (const e of ends){ const p = skPath(sk, N, from, e); if (p && p.length > bl){ bl = p.length; best = p; } } return best; };
  let main = ends.length >= 2 ? far(far(ends[0])?.slice(-1)[0] || ends[0]) : null;
  if (!main || main.length < 6){ main = [[I.cx, I.y1], [I.cx, I.y0]]; notes.push('No clear center line; used a vertical chain.'); }
  if (main[0][1] < main[main.length - 1][1]) main.reverse();          // start at the end nearest the ground
  const segs = Math.max(2, Math.min(6, Math.round(main.length / (N * 0.12)))), chain = [];
  for (let k = 0; k < segs; k++){
    const h = along(main, k / segs, main[0], main[main.length - 1]), t = along(main, (k + 1) / segs, main[0], main[main.length - 1]);
    chain.push(mk('body_' + (k + 1), k ? chain[k - 1].id : null, h, t, k > 0, 2));
  }
  const onMain = new Set(main.map(p => p[1]*N + p[0]));
  let limb = 0;
  for (const e of ends){
    if (onMain.has(e[1]*N + e[0])) continue;
    // walk back from the end until the main line is reached
    const prev = new Map([[e[1]*N + e[0], -1]]), q = [e[1]*N + e[0]]; let hit = -1;
    for (let h = 0; h < q.length && hit < 0; h++){ for (const j of skNbrs(sk, N, q[h])) if (!prev.has(j)){ prev.set(j, q[h]); if (onMain.has(j)){ hit = j; break; } q.push(j); } }
    if (hit < 0) continue;
    const path = []; for (let i = hit; i !== -1; i = prev.get(i)) path.push([i % N, (i / N) | 0]);
    if (path.length < main.length * 0.15) continue;
    const ji = main.findIndex(p => p[1]*N + p[0] === hit), parent = chain[Math.min(segs - 1, Math.floor(ji / main.length * segs))];
    limb++;
    const mid = along(path, 0.5, path[0], path[path.length - 1]);
    const a1 = mk('limb_' + limb + '_a', parent.id, path[0], mid, false, 3);
    mk('limb_' + limb + '_b', a1.id, mid, path[path.length - 1], true, 3);
  }
  return {bones:out, notes, sk};
}
// layer masks: every pixel belongs to one bone. Nearest bone first, then whole same-color areas are kept together.
function assignLabels(a, bones){
  const base = buildBase(a, LR), N = LR, lab = new Int32Array(N*N);
  if (!bones.length) return lab;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const i = y*N + x; if (base[i] < 0) continue;
    const px = (x + 0.5) / N, py = (y + 0.5) / N; let best = 0, bd = 1e9;
    for (const b of bones){ const d = segDist(px, py, b); if (d < bd){ bd = d; best = b.id; } }
    lab[i] = best;
  }
  const seen = new Uint8Array(N*N), comps = [];
  for (let s = 0; s < N*N; s++){
    if (seen[s] || base[s] < 0) continue;
    const comp = [s], q = [s]; seen[s] = 1;
    while (q.length){ const i = q.pop(), x = i % N; for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1]) if (j >= 0 && !seen[j] && base[j] === base[s]){ seen[j] = 1; q.push(j); comp.push(j); } }
    comps.push(comp);
  }
  const CORE = new Set(bones.filter(b => ['hips', 'torso', 'head'].includes(b.name)).map(b => b.id));
  for (const comp of comps){
    if (comp.length < 6) continue;
    const cnt = new Map(); for (const i of comp) cnt.set(lab[i], (cnt.get(lab[i]) || 0) + 1);
    const [top, n] = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0];
    if (n / comp.length > 0.7){ for (const i of comp) lab[i] = top; continue; }
    // mostly limb (a bare arm's skin running into the shoulder): the body-labeled bits join the nearest limb
    const limbs = bones.filter(b => cnt.has(b.id) && !CORE.has(b.id));
    const limbShare = limbs.reduce((s, b) => s + cnt.get(b.id), 0) / comp.length;
    if (CORE.size && limbs.length && limbShare > 0.6) for (const i of comp){
      if (!CORE.has(lab[i])) continue;
      const px = (i % N + 0.5) / N, py = (((i / N) | 0) + 0.5) / N; let best = lab[i], bd = 1e9;
      for (const b of limbs){ const d = segDist(px, py, b); if (d < bd){ bd = d; best = b.id; } }
      lab[i] = best;
    }
  }
  // tiny bits (a sword guard, a buckle) belong to whatever part surrounds them
  for (const comp of comps){
    if (comp.length >= 6) continue;
    const inC = new Set(comp), cnt = new Map();
    for (const i of comp){ const x = i % N; for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1]) if (j >= 0 && !inC.has(j) && lab[j]) cnt.set(lab[j], (cnt.get(lab[j]) || 0) + 1); }
    const top = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]; if (top) for (const i of comp) lab[i] = top[0];
  }
  return lab;
}
// hair: on top of the head, the main non-skin color that touches the top edge
function detectHair(a, bones, lab){
  const head = bones.find(b => b.name === 'head'); if (!head) return null;
  const base = buildBase(a, LR), N = LR, headPx = [];
  for (let i = 0; i < N*N; i++) if (lab[i] === head.id) headPx.push(i);
  if (headPx.length < 12) return null;
  const topY = Math.min(...headPx.map(i => (i / N) | 0)), botY = Math.max(...headPx.map(i => (i / N) | 0));
  const cut = topY + (botY - topY) * 0.4, cnt = new Map();
  for (const i of headPx){ const v = base[i]; if (((i / N) | 0) <= cut && P.mat[v] !== 'skin' && v !== P.darkest) cnt.set(v, (cnt.get(v) || 0) + 1); }
  const top = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]; if (!top) return null;
  const fam = new Set([top[0], P.dark[top[0]], P.light[top[0]], P.dark[P.dark[top[0]]]]);
  const hair = headPx.filter(i => fam.has(base[i]));
  if (hair.length < headPx.length * 0.2) return null;
  // long hair runs down past the head: follow hair-colored pixels that touch it
  const set = new Set(hair), q = hair.slice();
  while (q.length){ const i = q.pop(), x = i % N; for (const j of [x > 0 ? i-1 : -1, x < N-1 ? i+1 : -1, i >= N ? i-N : -1, i < N*(N-1) ? i+N : -1]) if (j >= 0 && !set.has(j) && fam.has(base[j]) && lab[j] !== 0){ set.add(j); q.push(j); } }
  const mid = lerp2([head.hx, head.hy], [head.tx, head.ty], 0.5);
  const b = {id:nextId++, name:'hair', parent:head.id, connected:false, hx:mid[0], hy:mid[1], tx:head.tx, ty:head.ty - 0.02, z:(head.z || 0) + 1};
  for (const i of set) lab[i] = b.id;
  return b;
}
// layered mesh: each layer gets its own grid of quads, so parts separate cleanly instead of stretching
function buildLayeredMesh(a, grid){
  const rig = a.rig, g = Math.max(8, grid | 0), lab = rig.labels, verts = [], tris = [], triLayer = [], weights = [];
  const byId = new Map(rig.bones.map(b => [b.id, b]));
  for (const b of rig.bones){
    let cells = new Uint8Array(g * g), any = false;
    for (let y = 0; y < LR; y++) for (let x = 0; x < LR; x++) if (lab[y*LR + x] === b.id){ cells[Math.min(g-1, (y / LR * g) | 0) * g + Math.min(g-1, (x / LR * g) | 0)] = 1; any = true; }
    if (!any) continue;
    const nx = cells.slice();
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) if (!cells[j*g + i]) for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]){ const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < g && jj < g && cells[jj*g + ii]){ nx[j*g + i] = 1; break; } }
    cells = nx;
    const vid = new Map(), par = byId.get(b.parent), jr = 0.07;
    const v = (i, j) => { const k = j * (g + 1) + i; if (!vid.has(k)){
      vid.set(k, verts.length); const p = [i / g, j / g]; verts.push(p);
      // rigid inside the part; near the joint it blends toward the parent so the bend stays connected
      const w = {}; const d = Math.hypot(p[0] - b.hx, p[1] - b.hy);
      if (par && d < jr){ const wp = 0.5 * (1 - d / jr); w[par.id] = wp; w[b.id] = 1 - wp; } else w[b.id] = 1;
      weights.push(w); } return vid.get(k); };
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) if (cells[j*g + i]){
      const a0 = v(i, j), b0 = v(i + 1, j), c0 = v(i, j + 1), d0 = v(i + 1, j + 1);
      tris.push([a0, b0, d0], [a0, d0, c0]); triLayer.push(b.id, b.id);
    }
  }
  buildBase(a, 64);
  return {grid:g, verts, tris, weights, triLayer, layered:true, painted:false, srcKey:a.base[64] && a.base[64].key};
}
// per-size layer textures: each layer's own pixels, plus colors extended a little under the parts in front of
// it, so raising an arm shows torso instead of a hole
function layerTextures(a, N, shaded){
  const lab = a.rig.labels, lN = new Int32Array(N*N), bones = a.rig.bones, z = new Map(bones.map(b => [b.id, b.z || 0]));
  const s = LR / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const i = y*N + x; if (shaded[i] < 0) continue;
    const cnt = new Map();
    for (let yy = Math.floor(y * s); yy < Math.max(Math.floor(y * s) + 1, Math.floor((y + 1) * s)); yy++) for (let xx = Math.floor(x * s); xx < Math.max(Math.floor(x * s) + 1, Math.floor((x + 1) * s)); xx++){ const l = lab[yy*LR + xx]; if (l) cnt.set(l, (cnt.get(l) || 0) + 1); }
    let best = 0, bc = 0; for (const [l, c] of cnt) if (c > bc){ bc = c; best = l; } lN[i] = best;
  }
  // pixels with no label take their nearest labeled neighbor's
  for (let pass = 0, left = true; pass < N && left; pass++){ left = false; const src = lN.slice();
    for (let i = 0; i < N*N; i++){ if (shaded[i] < 0 || src[i]) continue; const x = i % N;
      const n = [x > 0 ? src[i-1] : 0, x < N-1 ? src[i+1] : 0, i >= N ? src[i-N] : 0, i < N*(N-1) ? src[i+N] : 0].find(v => v); if (n) lN[i] = n; else left = true; } }
  const out = new Map(), k = Math.max(1, Math.round(N * 0.05));
  for (const b of bones){
    const tex = new Int16Array(N*N).fill(-1); let any = false;
    for (let i = 0; i < N*N; i++) if (lN[i] === b.id){ tex[i] = shaded[i]; any = true; }
    if (!any) continue;
    const zb = z.get(b.id) || 0;
    for (let step = 0; step < k; step++){ const src = tex.slice();
      for (let i = 0; i < N*N; i++){ if (src[i] >= 0 || shaded[i] < 0 || (z.get(lN[i]) || 0) <= zb) continue; const x = i % N;
        const n = [x > 0 ? src[i-1] : -1, x < N-1 ? src[i+1] : -1, i >= N ? src[i-N] : -1, i < N*(N-1) ? src[i+N] : -1].filter(v => v >= 0);
        if (n.length) tex[i] = modeOf(n); } }
    out.set(b.id, tex);
  }
  out.labels = lN;   // which layer each pixel belongs to at this size
  return out;
}
// layer brush: assign every sprite pixel inside the brush to the selected bone's layer
function paintLabels(a, p, radius, boneId){
  const lab = a.rig.labels, base = buildBase(a, LR), r = radius * LR, cx = p[0] * LR, cy = p[1] * LR;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(LR - 1, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(LR - 1, cx + r); x++)
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && base[y*LR + x] >= 0) lab[y*LR + x] = boneId;
}
// one click: detect, replace bones, label layers, build the layered mesh
function autoRig(a, type, armHint = 'auto'){
  const base = buildBase(a, LR), m = new Uint8Array(LR*LR); let n = 0;
  for (let i = 0; i < LR*LR; i++) if (base[i] >= 0){ m[i] = 1; n++; }
  if (n < 40) return {ok:false, msg:'The sprite is too small or empty to rig'};
  pushUndo(a);
  let bones, notes;
  if (type === 'chain'){ const r = fitChain(m, LR); bones = r.bones; notes = r.notes; }
  else { const r = fitHumanoid(m, LR, a.facing, armHint); bones = bonesFromHumanoid(r.J, LR, a.facing); notes = r.notes; }
  const lab = assignLabels(a, bones);
  const hair = type === 'chain' ? null : detectHair(a, bones, lab);
  if (hair) bones.push(hair);
  a.rig.bones = bones; a.rig.labels = lab; a.rig.mesh = buildLayeredMesh(a, 24);
  const ids = new Set(bones.map(b => b.id));
  for (const an of a.anims) for (const id of Object.keys(an.keys)) if (!ids.has(+id)) delete an.keys[id];
  return {ok:true, bones:bones.length, hair:!!hair, weapon:bones.some(b => b.name === 'weapon'), notes};
}
// layers for a hand-made rig: label pixels by nearest bone, then build the layered mesh
function layersFromBones(a){
  if (!a.rig.bones.length) return false;
  pushUndo(a); a.rig.labels = assignLabels(a, a.rig.bones); a.rig.mesh = buildLayeredMesh(a, a.rig.mesh ? a.rig.mesh.grid : 24);
  return true;
}

/* ---------- preset animations: motion rules on standard bone names, baked per character ---------- */
// "rot" is degrees away from the rest pose (positive = clockwise on screen), flipped by "s" for facing.
// "aim" points a bone along a screen direction (0 = forward, 90 = down, 180 = back, 270 = up), so a pose like
// "arm straight up" looks the same on every character, whatever angle its arms were drawn at.
// Moves are in fractions of leg length (L) so every preset scales to the character it is applied to.
const wrapDeg = d => ((d + 540) % 360) - 180;
const boneByName = (bones, n) => bones.find(b => b.name === n);
function worldAngleOf(bones, pose, id){ const m = worldPose(bones, pose).W[id]; return Math.atan2(m[1], m[0]); }
function worldHeadOf(bones, pose, id){ return mApply(worldPose(bones, pose).W[id], 0, 0); }
// two-bone leg IK: put the ankle on `target`, knee pointing the way the character faces, foot at `footAng`
function solveLeg(bones, pose, side, target, s, footAng){
  const ul = boneByName(bones, 'upper_leg_' + side), ll = boneByName(bones, 'lower_leg_' + side), ft = boneByName(bones, 'foot_' + side);
  if (!ul || !ll) return;
  pose[ul.id] = {...pose[ul.id], rot:0}; pose[ll.id] = {...pose[ll.id], rot:0};
  const H = worldHeadOf(bones, pose, ul.id), L1 = boneLen(ul), L2 = boneLen(ll);
  const dx = target[0] - H[0], dy = target[1] - H[1];
  const d = Math.max(Math.abs(L1 - L2) * 1.02 + 1e-4, Math.min((L1 + L2) * 0.999, Math.hypot(dx, dy)));
  const ang = Math.atan2(dy, dx), al = Math.acos(Math.max(-1, Math.min(1, (L1*L1 + d*d - L2*L2) / (2 * L1 * d))));
  const knee = c => [H[0] + L1 * Math.cos(c), H[1] + L1 * Math.sin(c)];
  const c1 = s * knee(ang + al)[0] >= s * knee(ang - al)[0] ? ang + al : ang - al;
  const K = knee(c1), T = [H[0] + Math.cos(ang) * d, H[1] + Math.sin(ang) * d];
  pose[ul.id].rot = wrapDeg((c1 - worldAngleOf(bones, pose, ul.id)) * 180 / Math.PI);
  pose[ll.id].rot = wrapDeg((Math.atan2(T[1] - K[1], T[0] - K[0]) - worldAngleOf(bones, pose, ll.id)) * 180 / Math.PI);
  if (ft){ pose[ft.id] = {...pose[ft.id], rot:0}; pose[ft.id].rot = wrapDeg((footAng - worldAngleOf(bones, pose, ft.id)) * 180 / Math.PI); }
}
// smooth curve through [t, value] keys
function K(keys, t){
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]){ const [t0, v0] = keys[i-1], [t1, v1] = keys[i], u = (t - t0) / (t1 - t0 || 1); return v0 + (v1 - v0) * u * u * (3 - 2 * u); }
  return keys[keys.length - 1][1];
}
const TAU2 = Math.PI * 2;
// foot target for a cycle: stance = foot on the ground sliding back at a constant speed (that IS the walk speed,
// so it never skids); swing = foot arcs forward through the air
function cycleFoot(c, side, p, stride, lift, stanceFrac){
  const A = c.ankle[side];
  if (p < stanceFrac){ const u = p / stanceFrac; return {target:[A[0] + c.s * stride * (0.5 - u), c.ground], toe:0}; }
  const u = (p - stanceFrac) / (1 - stanceFrac), e = 0.5 - 0.5 * Math.cos(Math.PI * u);
  return {target:[A[0] + c.s * stride * (-0.5 + e), c.ground - lift * Math.sin(Math.PI * u)], toe:(u < 0.5 ? 14 : -10) * c.s};
}
const planted = c => ({l:{target:c.ankle.l, toe:0}, r:{target:c.ankle.r, toe:0}});
const PRESET_ANIMS = {
  idle:{label:'Idle', frames:8, fps:6, loop:true, gen:(c, t) => {
    const br = 0.5 - 0.5 * Math.cos(TAU2 * t);
    return {bones:{hips:{y:c.px(0.014 * c.L) * br}, torso:{sy:1 + 0.025 * br, sx:1 - 0.01 * br}, head:{rot:2 * c.s * Math.sin(TAU2 * t)},
      ['upper_arm_' + c.front]:{rot:-3 * c.s * br}, ['upper_arm_' + c.back]:{rot:3 * c.s * br}}, legs:planted(c)};
  }},
  walk:{label:'Walk', frames:8, fps:10, loop:true, gen:(c, t) => {
    const bones = {hips:{y:c.px(0.03 * c.L) * Math.cos(2 * TAU2 * t)}, torso:{rot:3 * c.s}, head:{rot:-2 * c.s}}, legs = {};
    for (const side of ['l', 'r']){
      const p = (t + (side === c.front ? 0 : 0.5)) % 1;
      legs[side] = cycleFoot(c, side, p, 0.42 * c.L, 0.12 * c.L, 0.5);
      // each arm swings against its own leg
      bones['upper_arm_' + side] = {rot:26 * c.s * Math.cos(TAU2 * p)}; bones['lower_arm_' + side] = {rot:-12 * c.s};
    }
    return {bones, legs};
  }},
  run:{label:'Run', frames:6, fps:12, loop:true, gen:(c, t) => {
    const bones = {hips:{y:c.px(0.05 * c.L) * Math.cos(2 * TAU2 * t) - c.px(0.03 * c.L)}, torso:{rot:11 * c.s}, head:{rot:-6 * c.s}}, legs = {};
    for (const side of ['l', 'r']){
      const p = (t + (side === c.front ? 0 : 0.5)) % 1;
      legs[side] = cycleFoot(c, side, p, 0.72 * c.L, 0.26 * c.L, 0.38);
      bones['upper_arm_' + side] = {rot:44 * c.s * Math.cos(TAU2 * p)}; bones['lower_arm_' + side] = {rot:-75 * c.s};
    }
    return {bones, legs};
  }},
  attack:{label:'Attack', frames:8, fps:12, loop:false, gen:(c, t) => {
    const w = c.wside, o = w === 'l' ? 'r' : 'l', s = c.s;
    // wind-up behind the head, then over the top into a forward strike, follow through, recover
    return {bones:{
      ['upper_arm_' + w]:{aim:K([[0, c.rest('upper_arm_' + w)], [0.3, 228], [0.5, 380], [0.65, 395], [1, c.rest('upper_arm_' + w) + 360]], t)},
      ['lower_arm_' + w]:{rot:s * K([[0, 0], [0.3, 45], [0.5, 0], [0.65, -8], [1, 0]], t)},
      ['upper_arm_' + o]:{aim:K([[0, c.rest('upper_arm_' + o)], [0.3, 40], [0.5, 140], [1, c.rest('upper_arm_' + o)]], t)},
      torso:{rot:s * K([[0, 0], [0.3, -10], [0.5, 12], [0.65, 10], [1, 0]], t)},
      head:{rot:s * K([[0, 0], [0.3, 5], [0.5, -5], [1, 0]], t)},
      hips:{x:s * c.px(K([[0, 0], [0.3, -0.04 * c.L], [0.5, 0.09 * c.L], [0.7, 0.08 * c.L], [1, 0]], t) * 1), y:c.px(K([[0, 0], [0.5, 0.04 * c.L], [1, 0]], t))}
    }, legs:planted(c)};
  }},
  cast:{label:'Cast spell', frames:10, fps:10, loop:false, gen:(c, t) => {
    const s = c.s, arm = (n, lift) => K([[0, c.rest(n)], [0.25, c.rest(n) + 25], [0.5, -40 * lift], [0.7, -40 * lift], [0.82, -5], [1, c.rest(n)]], t);
    return {bones:{
      ['upper_arm_' + c.front]:{aim:arm('upper_arm_' + c.front, 1)}, ['upper_arm_' + c.back]:{aim:arm('upper_arm_' + c.back, 0.7)},
      ['lower_arm_' + c.front]:{rot:s * K([[0, 0], [0.25, -40], [0.5, 10], [1, 0]], t)}, ['lower_arm_' + c.back]:{rot:s * K([[0, 0], [0.25, -40], [0.5, 10], [1, 0]], t)},
      torso:{rot:s * K([[0, 0], [0.25, 6], [0.5, -8], [0.8, 4], [1, 0]], t)}, head:{rot:s * K([[0, 0], [0.5, -10], [1, 0]], t)},
      hips:{y:c.px(K([[0, 0], [0.25, 0.035 * c.L], [0.5, -0.01 * c.L], [1, 0]], t))}
    }, legs:planted(c)};
  }},
  jump:{label:'Jump', frames:9, fps:12, loop:false, gen:(c, t) => {
    const s = c.s, hy = K([[0, 0], [0.2, 0.08 * c.L], [0.35, -0.12 * c.L], [0.55, -0.34 * c.L], [0.75, -0.1 * c.L], [0.86, 0.07 * c.L], [1, 0]], t);
    const air = t > 0.3 && t < 0.8, tuck = air ? 0.14 * c.L * Math.sin(Math.PI * (t - 0.3) / 0.5) : 0;
    const legs = {};
    for (const side of ['l', 'r']){ const A = c.ankle[side]; legs[side] = air ? {target:[A[0] + s * 0.02 * c.L, A[1] + hy - tuck], toe:-10 * s} : {target:A, toe:0}; }
    const arm = n => K([[0, c.rest(n)], [0.2, c.rest(n) + 35], [0.4, -60], [0.6, -45], [0.86, c.rest(n) + 20], [1, c.rest(n)]], t);
    return {bones:{hips:{y:c.px(hy)}, torso:{rot:s * K([[0, 0], [0.2, 9], [0.4, -4], [0.86, 6], [1, 0]], t)},
      ['upper_arm_' + c.front]:{aim:arm('upper_arm_' + c.front)}, ['upper_arm_' + c.back]:{aim:arm('upper_arm_' + c.back)}, head:{rot:s * K([[0, 0], [0.2, 6], [0.45, -6], [1, 0]], t)}}, legs};
  }},
  hit:{label:'Hit', frames:5, fps:12, loop:false, gen:(c, t) => {
    const s = c.s;
    return {bones:{torso:{rot:s * K([[0, 0], [0.2, -16], [0.5, -10], [1, 0]], t)}, head:{rot:s * K([[0, 0], [0.2, -14], [1, 0]], t)},
      hips:{x:s * c.px(K([[0, 0], [0.2, -0.06 * c.L], [1, 0]], t))},
      ['upper_arm_' + c.front]:{rot:s * K([[0, 0], [0.2, -40], [1, 0]], t)}, ['upper_arm_' + c.back]:{rot:s * K([[0, 0], [0.2, 30], [1, 0]], t)}}, legs:planted(c)};
  }},
  death:{label:'Death', frames:10, fps:10, loop:false, gen:(c, t) => {
    const s = c.s, fall = Math.max(0, (t - 0.4) / 0.6), drop = (c.ground - c.pelvis[1]) * 0.78;
    return {bones:{
      hips:{rot:s * K([[0, 0], [0.4, -4], [1, -88]], t), y:c.px(K([[0, 0], [0.4, 0.07 * c.L], [1, drop]], t)), x:-s * c.px(K([[0, 0], [1, 0.12 * c.L]], t))},
      torso:{rot:s * K([[0, 0], [0.3, -12], [0.6, -6], [1, 0]], t)}, head:{rot:s * K([[0, 0], [0.4, -10], [1, 8]], t)},
      ['upper_arm_' + c.front]:{aim:K([[0, c.rest('upper_arm_' + c.front)], [0.4, c.rest('upper_arm_' + c.front) - 25], [1, 190]], t)}, ['upper_arm_' + c.back]:{aim:K([[0, c.rest('upper_arm_' + c.back)], [0.4, c.rest('upper_arm_' + c.back) + 10], [1, 165]], t)}
    // feet stay planted while the knees buckle, then the legs go limp as the body falls
    }, legs:fall > 0 ? null : planted(c), legBlend:fall, limp:{upper:-12 * s, lower:28 * s}};
  }},
  victory:{label:'Victory', frames:8, fps:8, loop:true, gen:(c, t) => {
    const s = c.s, w = c.wside, o = w === 'l' ? 'r' : 'l', pump = Math.sin(TAU2 * t);
    return {bones:{['upper_arm_' + w]:{aim:-88 + 6 * pump}, ['lower_arm_' + w]:{rot:-6 * s},
      ['upper_arm_' + o]:{aim:25 + 15 * pump}, ['lower_arm_' + o]:{rot:-85 * s},
      hips:{y:-c.px(0.035 * c.L) * (0.5 - 0.5 * Math.cos(TAU2 * t))}, head:{rot:-6 * s}, torso:{rot:-3 * s}}, legs:planted(c)};
  }}
};
const PRESET_ORDER = ['idle', 'walk', 'run', 'attack', 'cast', 'jump', 'hit', 'death', 'victory'];
// measurements a preset needs from this character's skeleton
function presetContext(a){
  const bones = a.rig.bones, by = n => boneByName(bones, n);
  const need = ['hips', 'upper_leg_l', 'lower_leg_l', 'upper_leg_r', 'lower_leg_r'];
  if (need.some(n => !by(n))) return null;
  const s = a.facing === 'left' ? -1 : 1, front = s > 0 ? 'r' : 'l', back = front === 'r' ? 'l' : 'r';
  const ank = side => [by('lower_leg_' + side).tx, by('lower_leg_' + side).ty];
  const L = (boneLen(by('upper_leg_l')) + boneLen(by('lower_leg_l')) + boneLen(by('upper_leg_r')) + boneLen(by('lower_leg_r'))) / 2;
  const weapon = by('weapon'), wside = weapon ? (bones.find(b => b.id === weapon.parent)?.name.endsWith('_l') ? 'l' : 'r') : front;
  const ankle = {l:ank('l'), r:ank('r')};
  const rest = n => { const b = by(n); if (!b) return 90; const d = boneAngle(b) * 180 / Math.PI; return ((s > 0 ? d : 180 - d) + 360) % 360; };
  return {s, front, back, L, ankle, ground:Math.max(ankle.l[1], ankle.r[1]), pelvis:[by('hips').hx, by('hips').hy], wside, rest, px:v => v * 32};
}
// turn a preset into keys on every frame (legs need IK each frame, so in-between frames are not guessed)
function bakePreset(a, an, id){
  const pre = PRESET_ANIMS[id], c = presetContext(a); if (!pre || !c) return false;
  const bones = a.rig.bones, F = an.frames = pre.frames; an.fps = pre.fps; an.loop = pre.loop; an.preset = id; an.keys = {};
  const hips = boneByName(bones, 'hips'), tOf = f => pre.loop ? f / F : f / Math.max(1, F - 1);
  const basePose = (spec, drop) => {
    const pose = {}, aims = []; for (const b of bones) pose[b.id] = {...REST};
    for (const [name, ch] of Object.entries(spec.bones)){ const b = boneByName(bones, name); if (!b) continue;
      const {aim, ...rest} = ch; Object.assign(pose[b.id], rest); if (aim != null) aims.push([b, aim]); }
    pose[hips.id].y = (pose[hips.id].y || 0) + c.px(drop);
    const order = boneOrder(bones).map(b => b.id); aims.sort((p, q) => order.indexOf(p[0].id) - order.indexOf(q[0].id));
    for (const [b, aim] of aims){
      const world = (c.s > 0 ? aim : 180 - aim) * Math.PI / 180;
      pose[b.id].rot = 0; pose[b.id].rot = wrapDeg((world - worldAngleOf(bones, pose, b.id)) * 180 / Math.PI);
    }
    return pose;
  };
  // auto-rigged legs are straight at rest, so a stride can't reach the ground without bending. Find how far the
  // hips must sit lower (once, for the whole animation, so the bob stays smooth) for every planted foot to touch down.
  let drop = 0;
  for (let f = 0; f < F; f++){
    const spec = pre.gen(c, tOf(f)); if (!spec.legs) continue;
    const pose = basePose(spec, 0);
    for (const side of ['l', 'r']){
      const L = spec.legs[side], ul = boneByName(bones, 'upper_leg_' + side), ll = boneByName(bones, 'lower_leg_' + side); if (!L || !ul || !ll) continue;
      const H = worldHeadOf(bones, pose, ul.id), reach = (boneLen(ul) + boneLen(ll)) * 0.97;
      const dx = L.target[0] - H[0], dy = L.target[1] - H[1];
      if (Math.hypot(dx, dy) > reach && Math.abs(dx) < reach) drop = Math.max(drop, dy - Math.sqrt(reach * reach - dx * dx));
    }
  }
  let lastIK = null;
  for (let f = 0; f < F; f++){
    const spec = pre.gen(c, tOf(f)), pose = basePose(spec, drop);
    if (spec.legs){
      for (const side of ['l', 'r']){ const L = spec.legs[side]; if (!L) continue;
        const ft = boneByName(bones, 'foot_' + side); solveLeg(bones, pose, side, L.target, c.s, (ft ? boneAngle(ft) : 0) + (L.toe || 0) * Math.PI / 180); }
      lastIK = {}; for (const side of ['l', 'r']) for (const part of ['upper_leg_', 'lower_leg_', 'foot_']){ const b = boneByName(bones, part + side); if (b) lastIK[b.id] = pose[b.id].rot; }
    } else if (lastIK){
      // ease from the last planted pose into limp legs
      const u = spec.legBlend ?? 1;
      for (const side of ['l', 'r']){ const up = boneByName(bones, 'upper_leg_' + side), lo = boneByName(bones, 'lower_leg_' + side);
        if (up) pose[up.id].rot = lastIK[up.id] + (spec.limp.upper - lastIK[up.id]) * u;
        if (lo) pose[lo.id].rot = lastIK[lo.id] + (spec.limp.lower - lastIK[lo.id]) * u; }
    }
    for (const b of bones) setKey(an, b.id, f, pose[b.id], 'linear');
  }
  return true;
}
// copy an animation to another sketch: presets are re-baked for that body; hand-keyed ones are matched by bone name
function retargetAnim(src, an, dst){
  const copy = newAnim(an.name); copy.frames = an.frames; copy.fps = an.fps; copy.loop = an.loop;
  if (an.preset && bakePreset(dst, copy, an.preset)) return {anim:copy, how:'rebuilt for this body'};
  const scale = (() => { const c1 = presetContext(src), c2 = presetContext(dst); return c1 && c2 ? c2.L / c1.L : 1; })();
  let matched = 0;
  for (const [bid, keys] of Object.entries(an.keys)){
    const sb = src.rig.bones.find(b => b.id === +bid), db = sb && boneByName(dst.rig.bones, sb.name); if (!db) continue;
    copy.keys[db.id] = keys.map(k => ({...k, x:k.x * scale, y:k.y * scale})); matched++;
  }
  return matched ? {anim:copy, how:`${matched} bones matched by name`} : null;
}


export {
  SIZES, STYLES, DEFAULTS, S, resetSettings, assets, getNextId, setNextId, setUndoHook, pushUndo, newAnim, 
  newAsset, lin, oklab, hex, unhex, labToRgb, lch, fromLch, hueTo, MATERIALS, guessMaterial, MAT_RULES, P, 
  setPalette, nearest, lutNearest, medianCut, bayer, B2, B4, B8, preKey, adjFn, preprocess, flattenPaper, 
  autoPalette, marginPx, profileOf, baseKey, buildBase, frameRect, redrawBase, modeOf, limitColors, 
  simplifyPass, despeckle, downsampleBase, edgeDistance, formShade, finalize, toImage, variantPalettes, mMul, 
  mInv, mApply, mTRS, IDENT, boneAngle, boneLen, restMat, REST, CHANNELS, boneOrder, descendants, worldPose, 
  posedEnds, EASES, channelsAt, pick, poseAt, setKey, buildMesh, segDist, autoWeights, normW, paintWeights, 
  skinVerts, triOrder, renderSkinned, ensureMesh, rigFrames, LR, N8, thin, skDeg, skNbrs, crossings, prune, 
  isEnd, skEnds, skPath, lerp2, along, maskInfo, closeHoles, fitHumanoid, bonesFromHumanoid, fitChain, 
  assignLabels, detectHair, buildLayeredMesh, layerTextures, paintLabels, autoRig, layersFromBones, wrapDeg, 
  boneByName, worldAngleOf, worldHeadOf, solveLeg, K, TAU2, cycleFoot, planted, PRESET_ANIMS, PRESET_ORDER, 
  presetContext, bakePreset, retargetAnim
};
