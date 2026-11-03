// The studio's editing state and actions, carried over from Sprite Foundry's page script.
// Everything that touched the page directly now reads and writes `ed`, and React redraws on `emit()`.
/* eslint-disable */
import {
  SIZES, STYLES, S, P, assets, MATERIALS, LR, REST, IDENT,
  newAnim, newAsset, hex, unhex, nearest, setPalette, autoPalette, preKey, preprocess, frameRect,
  buildBase, finalize, toImage, rigFrames, boneOrder, descendants, worldPose, posedEnds, poseAt, channelsAt, setKey,
  boneLen, segDist, mApply, mInv, skinVerts, buildMesh, autoWeights, normW, paintWeights, ensureMesh, buildLayeredMesh,
  paintLabels, autoRig, layersFromBones, PRESET_ANIMS, PRESET_ORDER, presetContext, bakePreset, retargetAnim,
  setUndoHook, getNextId, setNextId, medianCut,
} from './core.js';

export const snake = s => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);

export const ed = {
  curId: null, viewN: 32, tool: 'pen', showGrid: true, selSw: 0,
  editTarget: null,          // null = the still sprite, or {anim, f}: the current timeline frame
  selBone: null, curFrame: 0, tlPlaying: false, poseClip: null,
  brush: {size: 1, shape: 'square', mirror: false, dither: false, rectFill: false, shadeMode: 'darken'},
  rigBrush: {r: 0.08, strength: 0.35, mode: 'add'},
  onion: false, colorMode: false, eraseMode: false, areaColor: '#c0504a',
  showMesh: false, showLayers: false, showBones: false,
  viewPx: 512,               // on-screen width of the sprite view, for hit testing
  version: 0,
};

// ---------------------------------------------------------------- change notification
const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const getVersion = () => ed.version;
let queued = false;
export function emit(){
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; ed.version++; for (const f of listeners) f(); });
}
let toastFn = m => console.info(m);
export const setToast = f => { toastFn = f; };
const toast = m => toastFn(m);
// sketches and settings that changed since the last save
export const dirty = {assets: new Set(), settings: false};
const touch = a => { if (a) dirty.assets.add(a.id); };
const touchSettings = () => { dirty.settings = true; };

export const cur = () => assets.find(a => a.id === ed.curId) || null;
export const curAnimOf = a => a ? (a.anims.find(x => x.id === a.curAnim) || a.anims[0]) : null;
export const BONE_COLORS = ['#f2a541', '#5ec8e5', '#e56fb0', '#8fd36b', '#b392f0', '#f07264', '#e8d35a', '#6fd3c1'];
export const boneColor = (a, id) => BONE_COLORS[Math.max(0, a.rig.bones.findIndex(b => b.id === id)) % BONE_COLORS.length];

// ---------------------------------------------------------------- palette and frame computation
let lastAutoKey = '';
export const resetAutoPalette = () => { lastAutoKey = ''; };
export function refreshPalette(){
  if (S.paletteMode === 'auto'){
    const k = assets.map(a => a.id + ':' + preKey(a)).join(',') + '|' + S.autoCount;
    if (k !== lastAutoKey){ lastAutoKey = k; if (assets.length) setPalette(autoPalette()); }
  } else lastAutoKey = '';
  if (ed.selSw >= P.rgb.length) ed.selSw = 0;
}
let lastDisp = null, animCache = new Map();
// what the main view shows: the still sprite, or the current timeline frame (with its onion skin)
export function display(){
  refreshPalette();
  const a = cur(); if (!a) return null;
  const N = ed.viewN, base = buildBase(a, N), fin = finalize(base, N), an = curAnimOf(a);
  animCache.clear(); if (an) animCache.set(an.id, rigFrames(base, N, an, a));
  let disp = fin, onion = null, frames = an ? animCache.get(an.id) : null;
  if (ed.editTarget){
    const at = a.anims.find(z => z.id === ed.editTarget.anim), frs = animCache.get(ed.editTarget.anim);
    if (!at || !frs) ed.editTarget = null;
    else {
      ed.editTarget.f = Math.min(ed.editTarget.f, frs.length - 1); disp = frs[ed.editTarget.f];
      if (ed.onion && frs.length > 1) onion = frs[(ed.editTarget.f - 1 + frs.length) % frs.length];
    }
  }
  lastDisp = disp;
  return {a, N, disp, onion, still: fin, frames};
}
export function stats(disp){
  const a = cur(); if (!a || !disp) return null;
  const used = new Set(disp); used.delete(-1);
  let filled = 0; for (const v of disp) if (v >= 0) filled++;
  const tm = editMap(a, false);
  return {colors: used.size, palette: P.rgb.length, filled, touchUps: tm ? tm.size : 0, bones: a.rig.bones.length,
    unpainted: a.pre ? a.pre.unpainted || 0 : 0, filledPaper: !!(a.pre && a.pre.filledPaper), w: a.src.width, h: a.src.height};
}

// ---------------------------------------------------------------- drawing
export function drawIdx(cv, idx, N, zoom, grid, onion, pal){
  cv.width = N * zoom; cv.height = N * zoom;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = N;
  g.clearRect(0, 0, cv.width, cv.height);
  if (onion){ tmp.getContext('2d').putImageData(toImage(onion, N, pal), 0, 0); g.globalAlpha = 0.28; g.drawImage(tmp, 0, 0, N * zoom, N * zoom); g.globalAlpha = 1; }
  tmp.getContext('2d').putImageData(toImage(idx, N, pal), 0, 0);
  g.drawImage(tmp, 0, 0, N * zoom, N * zoom);
  if (grid && zoom >= 6){
    g.strokeStyle = '#ffffff'; g.globalAlpha = 0.1; g.lineWidth = 1; g.beginPath();
    for (let i = 1; i < N; i++){ g.moveTo(i*zoom + 0.5, 0); g.lineTo(i*zoom + 0.5, N*zoom); g.moveTo(0, i*zoom + 0.5); g.lineTo(N*zoom, i*zoom + 0.5); }
    g.stroke(); g.globalAlpha = 1;
  }
}
// the sketch itself (or its cleaned version), fitted into a square
// the sketch after background removal; it is made from the AI version when that is in use,
// which can be a different size from the sketch
export function cleanedImage(a){ const pre = preprocess(a); return new ImageData(pre.d, pre.w, pre.h); }
export function drawThumb(a, cv, size, cleaned){
  cv.width = size; cv.height = size; const g = cv.getContext('2d'); g.clearRect(0, 0, size, size);
  const im = cleaned ? cleanedImage(a) : a.src, w = im.width, h = im.height;
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  t.getContext('2d').putImageData(im, 0, 0);
  const s = Math.min(size / w, size / h), ox = (size - w * s) / 2, oy = (size - h * s) / 2; g.imageSmoothingEnabled = true;
  g.drawImage(t, ox, oy, w * s, h * s);
  cv._map = {s, ox, oy, w, h};
}
// the finished sprite at one size, for library cards and the size strip
export function spriteAt(a, N){ refreshPalette(); return finalize(buildBase(a, N), N); }

// ---------------------------------------------------------------- sketches
export function addSketch(name, src){
  const a = newAsset(snake(name) || 'sprite', src);
  assets.push(a); ed.curId = a.id; ed.selBone = null; ed.curFrame = 0; ed.editTarget = null;
  emit(); return a;
}
export function selectSketch(id){
  if (ed.curId === id) return;
  ed.curId = id; ed.selBone = null; ed.curFrame = 0; ed.editTarget = null; ed.tlPlaying = false; emit();
}
export function removeSketch(id){
  const i = assets.findIndex(a => a.id === id); if (i < 0) return;
  assets.splice(i, 1); dirty.assets.delete(id);
  if (ed.curId === id) ed.curId = assets[0] ? assets[0].id : null;
  emit();
}
export function stepSketch(d){
  if (assets.length < 2) return; const i = assets.findIndex(a => a.id === ed.curId);
  selectSketch(assets[(i + d + assets.length) % assets.length].id);
}
export function renameSketch(a, name){ a.name = snake(name) || a.name; touch(a); emit(); }

// ---------------------------------------------------------------- view, tools, frames
export function setView(N){ ed.viewN = N; emit(); }
export const TOOLS = {pen: 'Pencil', erase: 'Eraser', fill: 'Fill', line: 'Line', rect: 'Box', shade: 'Shade', pick: 'Picker'};
export const TOOL_TIPS = {pen: 'Paint with the selected palette color', erase: 'Erase pixels', fill: 'Fill a connected area of one color', line: 'Drag to draw a straight line',
  rect: 'Drag to draw a box', shade: 'Darken or lighten pixels along your palette ramp', pick: 'Pick a color from the sprite',
  bone: 'Drag on the sprite to add bones; drag joints to adjust', weight: 'Paint how strongly the selected bone moves each area',
  layer: 'Paint which body part each pixel belongs to', pose: 'Drag bones to pose them on the current frame'};
export const RIG_TOOLS = ['bone', 'weight', 'layer', 'pose'];
export function setTool(k){
  ed.tool = k;
  // bones and weights are edited on the rest pose; posing happens on a timeline frame
  if (k === 'bone' || k === 'weight' || k === 'layer'){ ed.editTarget = null; ed.tlPlaying = false; if (k === 'weight'){ const a = cur(); if (a) ensureMesh(a); } }
  if (k === 'pose' && !ed.editTarget) goFrame(ed.curFrame);
  emit();
}
export function goFrame(f){
  const a = cur(), an = curAnimOf(a); if (!an) return;
  ed.curFrame = ((f % an.frames) + an.frames) % an.frames;
  ed.editTarget = {anim: an.id, f: ed.curFrame};
  emit();
}
export function backToSprite(){ ed.editTarget = null; ed.tlPlaying = false; if (ed.tool === 'pose') ed.tool = 'pen'; emit(); }
export function toggle(key){ ed[key] = !ed[key]; if (key === 'colorMode' && ed.colorMode) ed.eraseMode = false; if (key === 'eraseMode' && ed.eraseMode) ed.colorMode = false; emit(); }
export function setBrush(patch){ Object.assign(ed.brush, patch); emit(); }
export function setRigBrush(patch){ Object.assign(ed.rigBrush, patch); emit(); }
export function selectBone(id){ ed.selBone = id; emit(); }
export function selectSwatch(i){ ed.selSw = i; emit(); }

// ---------------------------------------------------------------- undo
// each entry is one sketch's whole edit state (touch-ups, frame edits, rig, animations, removed areas)
const undoStack = [], redoStack = [];
const snapshotAsset = a => ({id: a.id, st: structuredClone({edits: a.edits, fedits: a.fedits, rig: a.rig, anims: a.anims, curAnim: a.curAnim, erasePts: a.erasePts, colorPts: a.colorPts || [], facing: a.facing})});
export function pushUndo(a){ undoStack.push(snapshotAsset(a)); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; touch(a); }
setUndoHook(pushUndo);
const bumpAll = a => { for (const N of SIZES) a.ev[N] = (a.ev[N] || 0) + 1; };
function restoreEdits(from, to){
  const s = from.pop(); if (!s) return toast('Nothing to ' + (from === undoStack ? 'undo' : 'redo'));
  const a = assets.find(q => q.id === s.id); if (!a) return;
  to.push(snapshotAsset(a));
  Object.assign(a, structuredClone(s.st)); bumpAll(a); touch(a);
  ed.curId = a.id; emit();
}
export const undo = () => restoreEdits(undoStack, redoStack), redo = () => restoreEdits(redoStack, undoStack);
export const clearHistory = () => { undoStack.length = 0; redoStack.length = 0; };

// the edit map that paint goes into: the still sprite (feeds every animation) or one animation frame
export function editMap(a, create){
  const N = ed.viewN, et = ed.editTarget;
  if (!et){ if (!a.edits[N] && create) a.edits[N] = new Map(); return a.edits[N]; }
  const A = a.fedits[et.anim] || (create ? (a.fedits[et.anim] = {}) : null); if (!A) return null;
  const B = A[N] || (create ? (A[N] = {}) : null); if (!B) return null;
  return B[et.f] || (create ? (B[et.f] = new Map()) : null);
}
export function clearEdits(){
  const a = cur(); if (!a) return; pushUndo(a); const N = ed.viewN;
  if (ed.editTarget){ const B = a.fedits[ed.editTarget.anim] && a.fedits[ed.editTarget.anim][N]; if (B) delete B[ed.editTarget.f]; toast('Cleared paint on this frame'); }
  else { delete a.edits[N]; a.ev[N] = (a.ev[N] || 0) + 1; toast('Touch-ups cleared for ' + N + '×' + N); }
  emit();
}

// ---------------------------------------------------------------- brushes and paint tools
function brushOffsets(){
  const s = ed.brush.size, r0 = -Math.floor((s - 1) / 2), c = r0 + (s - 1) / 2, lim = (s / 2 - 0.25) ** 2, o = [];
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++){
    const ox = r0 + dx, oy = r0 + dy;
    if (ed.brush.shape === 'round' && s > 2 && (ox - c) ** 2 + (oy - c) ** 2 > lim) continue;
    o.push([ox, oy]);
  }
  return o;
}
function addPx(set, x, y, N){
  const put = (px, py) => { if (px < 0 || py < 0 || px >= N || py >= N) return; if (ed.brush.dither && (px + py) % 2) return; set.add(py*N + px); };
  put(x, y); if (ed.brush.mirror) put(N - 1 - x, y);
}
function stamp(set, x, y){ for (const [ox, oy] of brushOffsets()) addPx(set, x + ox, y + oy, ed.viewN); }
export function linePts(x0, y0, x1, y1){
  const pts = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
  for (;;){ pts.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2*e; if (e2 >= dy){ e += dy; x0 += sx; } if (e2 <= dx){ e += dx; y0 += sy; } }
  return pts;
}
function shapeSet(p0, p1){
  const set = new Set(), tool = ed.tool;
  if (tool === 'line') for (const [x, y] of linePts(p0[0], p0[1], p1[0], p1[1])) stamp(set, x, y);
  else if (tool === 'rect'){
    const xa = Math.min(p0[0], p1[0]), xb = Math.max(p0[0], p1[0]), ya = Math.min(p0[1], p1[1]), yb = Math.max(p0[1], p1[1]);
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++){
      const edge = x === xa || x === xb || y === ya || y === yb;
      if (ed.brush.rectFill) addPx(set, x, y, ed.viewN); else if (edge) stamp(set, x, y);
    }
  }
  return set;
}
function fillSet(x, y){
  const N = ed.viewN, d = lastDisp, set = new Set(), seeds = [[x, y]];
  if (ed.brush.mirror) seeds.push([N - 1 - x, y]);
  for (const [sx, sy] of seeds){
    const c = d[sy*N + sx], st = [sy*N + sx], seen = new Uint8Array(N*N); seen[st[0]] = 1;
    while (st.length){ const i = st.pop(), px = i % N, py = (i / N) | 0;
      if (!ed.brush.dither || (px + py) % 2 === 0) set.add(i);
      for (const [nx, ny] of [[px-1, py], [px+1, py], [px, py-1], [px, py+1]]){
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const j = ny*N + nx;
        if (!seen[j] && d[j] === c){ seen[j] = 1; st.push(j); } } }
  }
  return set;
}
function applySet(set){
  const a = cur(); if (!a || !set.size || !lastDisp) return;
  const map = editMap(a, true); let changed = false;
  for (const i of set){
    let v;
    if (ed.tool === 'erase') v = null;
    else if (ed.tool === 'shade'){
      if (stroke && stroke.done.has(i)) continue;
      const c = lastDisp[i]; if (c < 0) continue;
      v = hex(P.rgb[ed.brush.shadeMode === 'lighten' ? P.light[c] : P.dark[c]]);
    } else v = hex(P.rgb[ed.selSw]);
    if (stroke) stroke.done.add(i);
    if (map.get(i) === v) continue;
    map.set(i, v); changed = true;
  }
  if (changed){ if (!ed.editTarget) a.ev[ed.viewN] = (a.ev[ed.viewN] || 0) + 1; touch(a); emit(); }
}

// ---------------------------------------------------------------- pointer input on the sprite
// p = {nx, ny}: position in the view from 0 to 1; mods = {shift, alt, ctrl}
let stroke = null, hover = null, hoverN = null, rigDrag = null;
const pxOf = p => { const N = ed.viewN, x = Math.floor(p.nx * N), y = Math.floor(p.ny * N); return x < 0 || y < 0 || x >= N || y >= N ? null : [x, y]; };
const hitR = () => 10 / (ed.viewPx || 1);   // 10 screen px, in sprite units
function boneEnds(b, W){ if (W){ const e = posedEnds(W, b); return [e.head, e.tail]; } return [[b.hx, b.hy], [b.tx, b.ty]]; }
function hitBone(a, p, W){
  const h = hitR(); let best = null, bd = 1e9;
  for (const b of a.rig.bones){
    const [hd, tl] = boneEnds(b, W), bias = b.id === ed.selBone ? 0.6 : 1;
    const dt = Math.hypot(p[0] - tl[0], p[1] - tl[1]) * bias, dh = Math.hypot(p[0] - hd[0], p[1] - hd[1]) * bias;
    const ds = segDist(p[0], p[1], {hx: hd[0], hy: hd[1], tx: tl[0], ty: tl[1]}) * bias + h * 0.4;
    if (dt < h && dt < bd){ bd = dt; best = {bone: b, part: 'tail'}; }
    if (dh < h && dh < bd){ bd = dh; best = {bone: b, part: 'head'}; }
    if (ds < h && ds < bd){ bd = ds; best = {bone: b, part: 'body'}; }
  }
  return best;
}
function uniqueBoneName(a){
  const used = new Set(a.rig.bones.map(b => b.name));
  for (const n of ['root', 'body', 'head', 'arm', 'arm_2', 'hand', 'leg', 'leg_2', 'tail', 'tail_2', 'weapon']) if (!used.has(n)) return n;
  let i = 2; while (used.has('bone_' + i)) i++; return 'bone_' + i;
}
function rigChanged(a, bonesEdited){
  // bones moved or added: refresh automatic weights unless the person has painted them
  if (bonesEdited && a.rig.mesh && !a.rig.mesh.painted){ if (a.rig.labels) a.rig.mesh = buildLayeredMesh(a, a.rig.mesh.grid); else autoWeights(a.rig.mesh, a.rig.bones); }
  touch(a); emit();
}
function rigDown(mods, a, p){
  const tool = ed.tool;
  if (tool === 'bone'){
    const hit = hitBone(a, p, null); pushUndo(a);
    // drag from a bone's tip chains a new bone off it; Shift+drag the tip to move it instead
    const chain = hit && hit.part === 'tail' && !mods.shift;
    if (hit && !chain){ ed.selBone = hit.bone.id; rigDrag = {kind: 'b-' + hit.part, bone: hit.bone, start: p, orig: structuredClone(a.rig.bones)}; }
    else {
      const parent = chain ? hit.bone : a.rig.bones.find(b => b.id === ed.selBone);
      let head = p, connected = false;
      if (parent && (chain || Math.hypot(p[0] - parent.tx, p[1] - parent.ty) < hitR() * 1.8)){ head = [parent.tx, parent.ty]; connected = true; }
      const id = getNextId(); setNextId(id + 1);
      const b = {id, name: uniqueBoneName(a), parent: parent ? parent.id : null, connected, hx: head[0], hy: head[1], tx: head[0], ty: head[1], z: a.rig.bones.length};
      a.rig.bones.push(b); ed.selBone = b.id; rigDrag = {kind: 'new', bone: b};
    }
    return emit();
  }
  if (tool === 'layer'){
    if (mods.ctrl){ const hit = hitBone(a, p, null); if (hit){ ed.selBone = hit.bone.id; emit(); } return; }
    if (!a.rig.labels) return toast('Click Auto-rig or Layers from bones first');
    if (ed.selBone == null) return toast('Pick the layer (bone) to paint in the bone list');
    pushUndo(a); rigDrag = {kind: 'lpaint'}; paintLabels(a, p, ed.rigBrush.r, ed.selBone); return emit();
  }
  if (tool === 'weight'){
    if (mods.ctrl){ const hit = hitBone(a, p, null); if (hit){ ed.selBone = hit.bone.id; emit(); } return; }
    if (ed.selBone == null) return toast('Pick the bone to paint in the bone list (or Ctrl+click it)');
    const m = ensureMesh(a); if (!m) return; pushUndo(a);
    rigDrag = {kind: 'paint'}; paintWeights(m, a.rig.bones, ed.selBone, p[0], p[1], ed.rigBrush.r, ed.rigBrush.strength, ed.rigBrush.mode);
    return emit();
  }
  if (tool === 'pose'){
    if (!ed.editTarget) goFrame(ed.curFrame);
    const an = curAnimOf(a), pose = poseAt(a, an, ed.curFrame), {W} = worldPose(a.rig.bones, pose);
    const hit = hitBone(a, p, W);
    if (!hit){ ed.selBone = null; return emit(); }
    pushUndo(a); ed.selBone = hit.bone.id;
    const b = hit.bone, ends = posedEnds(W, b), PW = b.parent != null && W[b.parent] ? W[b.parent] : IDENT;
    const mode = mods.alt ? 'scale' : (mods.shift || hit.part === 'head') ? 'move' : 'rotate';
    rigDrag = {kind: 'pose-' + mode, bone: b, start: p, c0: {...pose[b.id]}, head: ends.head,
      a0: Math.atan2(p[1] - ends.head[1], p[0] - ends.head[0]), d0: Math.max(1e-4, Math.hypot(p[0] - ends.head[0], p[1] - ends.head[1])),
      PWinv: mInv([PW[0], PW[1], PW[2], PW[3], 0, 0]), lastA: 0};
    emit();
  }
}
function rigMove(mods, a, p){
  const d = rigDrag, bones = a.rig.bones;
  if (d.kind === 'new'){ d.bone.tx = p[0]; d.bone.ty = p[1]; }
  else if (d.kind === 'b-tail'){
    d.bone.tx = p[0]; d.bone.ty = p[1];
    for (const c of bones) if (c.parent === d.bone.id && c.connected){ c.hx = p[0]; c.hy = p[1]; }
  } else if (d.kind === 'b-head' || d.kind === 'b-body'){
    const b = d.bone, dx = p[0] - d.start[0], dy = p[1] - d.start[1];
    const par = bones.find(q => q.id === b.parent);
    if (b.connected && par){
      if (d.kind === 'b-head'){ par.tx = b.hx = p[0]; par.ty = b.hy = p[1]; for (const c of bones) if (c.parent === par.id && c.connected){ c.hx = p[0]; c.hy = p[1]; } }
    } else {
      // move this bone and everything hanging off it
      const ids = descendants(bones, b.id); ids.add(b.id);
      for (const q of bones) if (ids.has(q.id)){ const oq = d.orig.find(z => z.id === q.id); q.hx = oq.hx + dx; q.hy = oq.hy + dy; q.tx = oq.tx + dx; q.ty = oq.ty + dy; }
    }
  } else if (d.kind === 'lpaint'){ paintLabels(a, p, ed.rigBrush.r, ed.selBone);
  } else if (d.kind === 'paint'){
    paintWeights(a.rig.mesh, bones, ed.selBone, p[0], p[1], ed.rigBrush.r, ed.rigBrush.strength * 0.5, ed.rigBrush.mode);
  } else if (d.kind.startsWith('pose-')){
    const an = curAnimOf(a), c = {...d.c0};
    if (d.kind === 'pose-rotate'){
      let ang = Math.atan2(p[1] - d.head[1], p[0] - d.head[0]) - d.a0;
      while (ang - d.lastA > Math.PI) ang -= 2 * Math.PI; while (ang - d.lastA < -Math.PI) ang += 2 * Math.PI; d.lastA = ang;
      c.rot = d.c0.rot + ang * 180 / Math.PI;
    } else if (d.kind === 'pose-move'){
      const [lx, ly] = mApply(d.PWinv, p[0] - d.start[0], p[1] - d.start[1]);
      c.x = d.c0.x + lx * 32; c.y = d.c0.y + ly * 32;
    } else {
      const r = Math.hypot(p[0] - d.head[0], p[1] - d.head[1]) / d.d0;
      c.sx = Math.max(0.1, d.c0.sx * r); if (mods.shift) c.sy = Math.max(0.1, d.c0.sy * r);
    }
    setKey(an, d.bone.id, ed.curFrame, c);
  }
  emit();
}
function rigUp(a){
  const d = rigDrag; rigDrag = null;
  if (d.kind === 'new'){
    if (boneLen(d.bone) < 1.2 / 32){ a.rig.bones = a.rig.bones.filter(b => b !== d.bone); undoStack.pop(); ed.selBone = d.bone.parent; return emit(); }
    if (!a.rig.mesh) ensureMesh(a);
    toast(`Added ${d.bone.name}. Drag again from its end to chain the next bone`);
  }
  if (d.kind === 'lpaint'){ a.rig.mesh = buildLayeredMesh(a, a.rig.mesh ? a.rig.mesh.grid : 24); touch(a); return emit(); }
  if (d.kind === 'paint' && a.rig.mesh) a.rig.mesh.painted = true;
  if (d.kind.startsWith('b-') || d.kind === 'new') return rigChanged(a, true);
  touch(a); emit();
}
export function pointerDown(p, mods){
  const a = cur(); if (!a) return;
  if (ed.colorMode) return colorAt(a, p);
  if (RIG_TOOLS.includes(ed.tool)) return rigDown(mods, a, [p.nx, p.ny]);
  const px = pxOf(p); if (!px) return;
  if (ed.tool === 'pick'){ const v = lastDisp && lastDisp[px[1]*ed.viewN + px[0]]; if (v >= 0){ ed.selSw = v; emit(); } return; }
  pushUndo(a);
  if (ed.tool === 'fill') return applySet(fillSet(px[0], px[1]));
  stroke = {start: px, last: px, done: new Set()};
  if (ed.tool === 'pen' || ed.tool === 'erase' || ed.tool === 'shade'){ const s = new Set(); stamp(s, px[0], px[1]); applySet(s); }
  emit();
}
export function pointerMove(p, mods){
  const px = pxOf(p); hover = px; hoverN = [p.nx, p.ny];
  if (rigDrag) return rigMove(mods, cur(), hoverN);
  if (stroke && px){
    if (ed.tool === 'pen' || ed.tool === 'erase' || ed.tool === 'shade'){ const s = new Set(); for (const [x, y] of linePts(stroke.last[0], stroke.last[1], px[0], px[1])) stamp(s, x, y); applySet(s); }
    stroke.last = px;
  }
  overlayOnly();
}
export function pointerUp(){
  if (rigDrag) return rigUp(cur());
  if (stroke && (ed.tool === 'line' || ed.tool === 'rect')) applySet(shapeSet(stroke.start, stroke.last));
  stroke = null; overlayOnly();
}
export function pointerLeave(){ hover = null; hoverN = null; overlayOnly(); }
export const isDragging = () => !!(stroke || rigDrag);
// hover changes redraw only the overlay, not the sprite
const overlayListeners = new Set();
export const subscribeOverlay = fn => { overlayListeners.add(fn); return () => overlayListeners.delete(fn); };
const overlayOnly = () => { for (const f of overlayListeners) f(); };

export function drawOverlay(ov, zoom){
  const N = ed.viewN, a = cur(), z = zoom;
  ov.width = N * z; ov.height = N * z;
  const g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height); if (!a) return;
  const tool = ed.tool, S2 = N * z, rigTool = RIG_TOOLS.includes(tool), mesh = a.rig.mesh, bones = a.rig.bones, selBone = ed.selBone;
  let W = null, def = null;
  const an = curAnimOf(a), et = ed.editTarget, posed = et && an && et.anim === an.id && bones.length;
  if (posed){ const pose = poseAt(a, an, et.f); W = worldPose(bones, pose).W; if (mesh) def = skinVerts(mesh, bones, pose); }
  // mesh wireframe, and the selected bone's weights as a heat map
  if (mesh && (tool === 'weight' || ed.showMesh)){
    const V = def || mesh.verts;
    if (tool === 'weight' && selBone != null) for (const t of mesh.tris){
      const w = (t.reduce((s, vi) => s + (mesh.weights[vi][selBone] || 0), 0)) / 3;
      if (w < 0.01) continue;
      g.beginPath(); t.forEach((vi, i) => i ? g.lineTo(V[vi][0] * S2, V[vi][1] * S2) : g.moveTo(V[vi][0] * S2, V[vi][1] * S2)); g.closePath();
      g.fillStyle = `hsla(${Math.round((1 - w) * 230)},95%,52%,${0.25 + w * 0.4})`; g.fill();
    }
    g.beginPath();
    for (const t of mesh.tris){ g.moveTo(V[t[0]][0] * S2, V[t[0]][1] * S2); g.lineTo(V[t[1]][0] * S2, V[t[1]][1] * S2); g.lineTo(V[t[2]][0] * S2, V[t[2]][1] * S2); g.closePath(); }
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.22)'; g.stroke();
  }
  // layer masks, tinted by bone color (rest pose)
  if (a.rig.labels && (tool === 'layer' || (!posed && ed.showLayers))){
    const lab = a.rig.labels, col = new Map(bones.map(b => [b.id, boneColor(a, b.id)]));
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const l = lab[Math.floor((y + 0.5) / N * LR) * LR + Math.floor((x + 0.5) / N * LR)];
      if (!l || !col.has(l)) continue;
      g.fillStyle = col.get(l) + (l === selBone ? 'aa' : '66'); g.fillRect(x * z, y * z, z, z);
    }
  }
  const ring = () => { g.beginPath(); g.arc(hoverN[0] * S2, hoverN[1] * S2, ed.rigBrush.r * S2, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke(); };
  if (tool === 'layer' && hoverN) ring();
  // bones: tapered from the joint (head) to the tip (tail)
  if (bones.length && (rigTool || ed.showBones)){
    for (const b of boneOrder(bones)){
      const [hd, tl] = boneEnds(b, W), col = boneColor(a, b.id), sel = b.id === selBone;
      const hx = hd[0] * S2, hy = hd[1] * S2, tx = tl[0] * S2, ty = tl[1] * S2, L = Math.hypot(tx - hx, ty - hy) || 1;
      const ux = (tx - hx) / L, uy = (ty - hy) / L, wdt = Math.max(3, Math.min(10, L * 0.16));
      if (b.parent != null && !b.connected){ const par = bones.find(q => q.id === b.parent); if (par){ const [, ptl] = boneEnds(par, W);
        g.setLineDash([3, 3]); g.beginPath(); g.moveTo(ptl[0] * S2, ptl[1] * S2); g.lineTo(hx, hy); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.stroke(); g.setLineDash([]); } }
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + ux * L * 0.22 - uy * wdt, hy + uy * L * 0.22 + ux * wdt); g.lineTo(tx, ty); g.lineTo(hx + ux * L * 0.22 + uy * wdt, hy + uy * L * 0.22 - ux * wdt); g.closePath();
      g.fillStyle = col + (sel ? 'ee' : '99'); g.fill(); g.lineWidth = sel ? 2 : 1.2; g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.7)'; g.stroke();
      g.beginPath(); g.arc(hx, hy, sel ? 5 : 4, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.arc(tx, ty, 3, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.stroke();
      if (sel){ g.font = '600 12px ui-monospace, Consolas, monospace'; g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.8)'; g.lineWidth = 3; g.strokeText(b.name, tx + 6, ty - 6); g.fillText(b.name, tx + 6, ty - 6); }
    }
  }
  if (tool === 'weight' && hoverN) ring();
  // paint-tool cursor and line/box preview
  let set = null;
  if (stroke && (tool === 'line' || tool === 'rect')) set = shapeSet(stroke.start, stroke.last);
  else if (hover && ['pen', 'erase', 'shade', 'line', 'rect'].includes(tool) && !stroke && !ed.colorMode){ set = new Set(); stamp(set, hover[0], hover[1]); }
  else if (hover && (tool === 'fill' || tool === 'pick') && !ed.colorMode){ set = new Set([hover[1]*N + hover[0]]); }
  if (set){
    g.fillStyle = tool === 'erase' ? 'rgba(240,114,100,.45)' : (stroke ? hex(P.rgb[ed.selSw]) : 'rgba(255,255,255,.35)');
    for (const i of set) g.fillRect((i % N) * z, ((i / N) | 0) * z, z, z);
    if (!stroke){ g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1; for (const i of set) g.strokeRect((i % N) * z + 0.5, ((i / N) | 0) * z + 0.5, z - 1, z - 1); }
  }
}

// ---------------------------------------------------------------- sketch areas: remove a shadow, color a part
// thumbnail click: x, y from 0 to 1 over the canvas the sketch was drawn into with drawThumb
export function eraseAt(cv, cx, cy){
  const a = cur(), m = cv._map; if (!ed.eraseMode || !a || !m) return;
  const x = (cx * cv.width - m.ox) / (m.w * m.s), y = (cy * cv.height - m.oy) / (m.h * m.s);
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
  pushUndo(a); a.erasePts.push({x, y}); bumpAll(a); emit(); toast('Area removed. Click more areas, or press Remove an area again to stop');
}
function colorAt(a, p){
  const pre = preprocess(a), N = ed.viewN;
  const px = p.nx * N, py = p.ny * N;
  const {bb, scale, ox, oy} = frameRect(pre, N), sx = bb.x + (px - ox) * scale, sy = bb.y + (py - oy) * scale;
  if (sx < 0 || sy < 0 || sx >= pre.w || sy >= pre.h) return;
  pushUndo(a); a.colorPts = a.colorPts || []; a.colorPts.push({x: sx / pre.w, y: sy / pre.h, hex: ed.areaColor});
  bumpAll(a); if (S.paletteMode === 'auto') lastAutoKey = ''; emit(); toast('Colored. Click more areas, or press Color an area again to stop');
}
export function clearColors(){ const a = cur(); if (!a || !(a.colorPts || []).length) return toast('No colored areas on this sketch'); pushUndo(a); a.colorPts = []; bumpAll(a); emit(); toast('Area colors cleared'); }
export function clearErase(){ const a = cur(); if (!a || !a.erasePts.length) return toast('No removed areas on this sketch'); pushUndo(a); a.erasePts = []; bumpAll(a); emit(); toast('Removed areas restored'); }

// ---------------------------------------------------------------- AI coloring (optional; the app sends the request, see src/ai.ts)
// the instructions around the person's own words: keep the drawing, make it clean and colored, nothing extra
export function buildAIPrompt(user){
  const light = {tl:'top left', t:'top', tr:'top right'}[S.light] || 'top left';
  const pal = S.lockPalette ? ' Use only these colors: ' + P.rgb.slice(0, P.baseCount).map(hex).join(', ') + '.' : '';
  return 'Color and clean up this hand-drawn character sketch into a finished 2D game character illustration. ' +
    'Keep exactly the same pose, proportions, silhouette, framing and every drawn detail; do not add or remove any parts. ' +
    'Bold, clean, closed dark outlines. Flat colors with simple two-tone cel shading, light from the ' + light + '. ' +
    'Fully transparent background, no ground shadow, no text, no extra objects.' + pal +
    (user && user.trim() ? ' Colors and details: ' + user.trim().slice(0, 600) : '');
}
// the same intent for a local Stable Diffusion checkpoint, which reads tags better than sentences
export function buildLocalPrompt(user){
  const light = {tl:'top left', t:'top', tr:'top right'}[S.light] || 'top left';
  const words = user && user.trim() ? user.trim().slice(0, 600) + ', ' : '';
  return {
    positive: words + '2d game character, clean colored illustration, flat colors, simple cel shading, light from the ' + light +
      ', bold clean dark outlines, same pose, full body, plain white background',
    negative: 'photo, realistic, 3d render, blurry, noisy, sketch lines, paper texture, text, watermark, signature, extra limbs, ' +
      'extra characters, background scenery, ground shadow, frame, border',
  };
}
// the image size closest to the sketch's shape
export function aiSizeFor(a){ const r = a.src.width / a.src.height; return r < 0.8 ? '1024x1536' : r > 1.25 ? '1536x1024' : '1024x1024'; }
const aiChanged = a => { bumpAll(a); if (S.paletteMode === 'auto') lastAutoKey = ''; touch(a); emit(); };
// a new AI version (or null to drop it); a new one is used straight away
export function setAIImage(a, im){ a.aiSrc = im || null; a.useAI = !!im; a.aiVer = (a.aiVer || 0) + 1; aiChanged(a); }
export function chooseAI(use){ const a = cur(); if (!a || !a.aiSrc || a.useAI === use) return; a.useAI = use; aiChanged(a); }
export function setAIPrompt(text){ const a = cur(); if (!a) return; a.aiPrompt = String(text).slice(0, 600); touch(a); emit(); }

// ---------------------------------------------------------------- settings
export function setSetting(k, v){
  S[k] = v; touchSettings();
  if (k === 'paletteMode' && S.paletteMode === 'auto') lastAutoKey = '';
  if (['rampStep', 'rampHue', 'shadowHue', 'lightHue'].includes(k)){ markCustomStyle(); setPalette(basePal()); }
  if (k === 'lockPalette') setPalette(basePal());
  if (['shade', 'shadeBands', 'outline', 'sat', 'contrast'].includes(k)) markCustomStyle();
  emit();
}
export function setProfile(N, patch){ S.profiles[N] = {...profile(N), ...patch}; touchSettings(); emit(); }
const profile = N => Object.assign({lines: 'keep', inner: true, colors: 0, simplify: 0, shade: 'global', olPos: 'out'}, S.profiles && S.profiles[N]);
export function setExport(kind, key, on){ S[kind] = {...S[kind], [key]: on}; touchSettings(); emit(); }
// style presets: apply one, or mark the style as "custom" once its rules are hand-edited
export function applyStyle(key){
  const st = STYLES[key]; if (!st) return;
  const {label, ...rules} = st; void label;
  Object.assign(S, rules, {style: key}); setPalette(basePal()); touchSettings(); emit();
}
function markCustomStyle(){ if (S.style !== 'custom') S.style = 'custom'; }

// ---------------------------------------------------------------- palette editing
export const basePal = () => P.rgb.slice(0, P.baseCount).map(c => c.slice());
function freeze(){ if (S.paletteMode !== 'custom') S.paletteMode = 'custom'; touchSettings(); }
const genGuard = () => { if (ed.selSw >= P.baseCount){ toast('That shade is made from a base color. Edit the base color, or change the shade ramp settings'); return true; } return false; };
export function setSwatchColor(h){ if (genGuard()) return; freeze(); const list = basePal(); list[ed.selSw] = unhex(h); setPalette(list); emit(); }
export function addSwatch(h){ freeze(); const list = basePal(); list.push(unhex(h)); setPalette(list); ed.selSw = P.baseCount - 1; emit(); }
export function removeSwatch(){ if (genGuard()) return; if (P.baseCount <= 2) return toast('Keep at least two colors'); freeze(); setPalette(basePal().filter((_, i) => i !== ed.selSw)); emit(); }
export function setSwatchMaterial(m){ if (genGuard()) return; S.materials = {...(S.materials || {}), [hex(P.rgb[ed.selSw])]: m}; const keep = ed.selSw; setPalette(basePal()); ed.selSw = keep; touchSettings(); emit(); }
export function useAsOutline(){ S.outlineHex = hex(P.rgb[ed.selSw]); if (S.outline === 'none') S.outline = 'outer'; touchSettings(); emit(); toast('Outline color set'); }
export function keepPalette(){ freeze(); emit(); toast('Palette fixed. New sketches will use these colors'); }
export function parsePaletteText(t){
  const out = [];
  for (const line of t.split(/\r?\n/)){
    if (/^\s*(#|GIMP|Name:|Columns:|;)/i.test(line) && !/^\s*#?[0-9a-f]{6}\s*$/i.test(line)) continue;
    const h = line.match(/#?([0-9a-f]{6})\b/i); if (h){ out.push(unhex(h[1])); continue; }
    const n = line.trim().split(/\s+/).map(Number); if (n.length >= 3 && n.slice(0, 3).every(v => v >= 0 && v <= 255 && Number.isInteger(v))) out.push(n.slice(0, 3));
  }
  return out;
}
export function paletteFromImage(im){
  const set = new Map();
  for (let i = 0; i < im.data.length; i += 4) if (im.data[i+3] >= 128){ const c = [im.data[i], im.data[i+1], im.data[i+2]]; set.set(hex(c), c); if (set.size > 256) break; }
  let cols = [...set.values()]; if (cols.length > 64) cols = medianCut(cols, 32);
  return cols;
}
export function importPalette(cols, from){
  if (cols.length < 2) return toast('No colors found in ' + from);
  S.paletteMode = 'custom'; setPalette(cols); ed.selSw = 0; touchSettings(); emit(); toast(`Imported ${P.rgb.length} colors`);
}
export const materialOf = i => P.mat[i] || 'cloth';
export const isGenerated = i => i >= P.baseCount;
export const outlineIndex = () => S.outlineHex ? nearest(...unhex(S.outlineHex)) : P.darkest;

// ---------------------------------------------------------------- rig: bones, mesh, auto-rig
export function autoRigCur(type, armHint){
  const a = cur(); if (!a) return;
  const r = autoRig(a, type, armHint); if (!r.ok) return toast(r.msg);
  ed.selBone = null; touch(a); setTool('bone');
  const extras = [r.hair && 'hair', r.weapon && 'a weapon'].filter(Boolean);
  toast(`Rigged: ${r.bones} bones${extras.length ? ', found ' + extras.join(' and ') : ''}. ${r.notes[0] || 'Check the joints in Bones mode and the layers in Layers mode'}`);
}
export function makeLayers(){ const a = cur(); if (!a || !layersFromBones(a)) return toast('Add bones first'); touch(a); setTool('layer'); toast('Layers made from your bones. Paint in Layers mode to fix any pixels'); }
const selB = a => a.rig.bones.find(q => q.id === ed.selBone);
export function renameBone(name){ const a = cur(), b = a && selB(a); if (!b) return; const n = snake(name) || b.name;
  if (a.rig.bones.some(q => q !== b && q.name === n)) return toast('Another bone has that name'); pushUndo(a); b.name = n; emit(); }
export function setBoneParent(pid){ const a = cur(), b = a && selB(a); if (!b) return; pushUndo(a); b.parent = pid; b.connected = false; rigChanged(a, false); }
export function setBoneZ(z){ const a = cur(), b = a && selB(a); if (!b) return; pushUndo(a); b.z = z || 0; emit(); }
export function deleteBone(){
  const a = cur(), b = a && selB(a); if (!b) return; pushUndo(a);
  for (const c of a.rig.bones) if (c.parent === b.id){ c.parent = b.parent; c.connected = false; }
  a.rig.bones = a.rig.bones.filter(q => q !== b);
  for (const an of a.anims) delete an.keys[b.id];
  if (a.rig.labels) for (let i = 0; i < a.rig.labels.length; i++) if (a.rig.labels[i] === b.id) a.rig.labels[i] = b.parent || 0;
  if (a.rig.mesh){ for (const w of a.rig.mesh.weights){ delete w[b.id]; normW(w); } if (!a.rig.bones.length) a.rig.mesh = null; }
  ed.selBone = null; rigChanged(a, true); toast(`Deleted ${b.name}`);
}
export function rebuildMesh(grid){ const a = cur(); if (!a || !a.rig.bones.length) return toast('Add a bone first'); pushUndo(a); a.rig.mesh = buildMesh(a, grid); autoWeights(a.rig.mesh, a.rig.bones); rigChanged(a, false); toast('Mesh rebuilt with automatic weights'); }
export function resetWeights(){ const a = cur(); const m = a && ensureMesh(a); if (!m) return toast('Add a bone first'); pushUndo(a); autoWeights(m, a.rig.bones); m.painted = false; rigChanged(a, false); toast('Weights reset to automatic'); }
export function setFacing(f){ const a = cur(); if (!a) return; pushUndo(a); a.facing = f; emit();
  if (a.anims.some(x => x.preset)) toast('Facing changed. Use Rebuild preset on preset animations to turn them around'); }
export function setSnap(on){ const a = cur(); if (!a) return; a.rig.snap = on; touch(a); emit(); }
export function boneDepth(bones, b){ let d = 0, p = b; while (p && p.parent != null && d < 20){ p = bones.find(q => q.id === p.parent); d++; } return d; }
export { boneOrder, descendants };

// ---------------------------------------------------------------- animations and keys
export function selectAnim(id){ const a = cur(); if (!a) return; a.curAnim = id; ed.curFrame = 0; if (ed.editTarget) goFrame(0); touch(a); emit(); }
export function renameAnim(name){ const a = cur(), an = curAnimOf(a); if (!an) return; const n = snake(name) || an.name;
  if (a.anims.some(x => x !== an && x.name === n)) return toast('Another animation has that name'); pushUndo(a); an.name = n; emit(); }
export function setAnimFrames(v){ const a = cur(), an = curAnimOf(a); if (!an) return; pushUndo(a); const F = Math.max(1, Math.min(48, v || 1));
  for (const id in an.keys) an.keys[id] = an.keys[id].filter(k => k.f < F); an.frames = F; if (ed.curFrame >= F) ed.curFrame = F - 1; if (ed.editTarget) ed.editTarget.f = ed.curFrame; emit(); }
export function setAnimFps(v){ const a = cur(), an = curAnimOf(a); if (!an) return; an.fps = Math.max(1, Math.min(60, v || 1)); touch(a); emit(); }
export function setAnimLoop(on){ const a = cur(), an = curAnimOf(a); if (!an) return; pushUndo(a); an.loop = on; emit(); }
export function newAnimation(){ const a = cur(); if (!a) return; pushUndo(a); const used = new Set(a.anims.map(x => x.name)); let n = 'anim', i = 2; while (used.has(n)) n = 'anim_' + i++;
  const an = newAnim(n); a.anims.push(an); a.curAnim = an.id; ed.curFrame = 0; if (ed.editTarget) goFrame(0); emit(); }
export function duplicateAnim(){ const a = cur(), an = curAnimOf(a); if (!an) return; pushUndo(a); const copy = structuredClone(an); copy.id = getNextId(); setNextId(copy.id + 1); copy.name = an.name + '_copy'; a.anims.push(copy); a.curAnim = copy.id; emit(); }
export function deleteAnim(){ const a = cur(); if (!a) return; if (a.anims.length < 2) return toast('A sketch keeps at least one animation'); pushUndo(a); const an = curAnimOf(a);
  a.anims = a.anims.filter(x => x !== an); delete a.fedits[an.id]; a.curAnim = a.anims[0].id; ed.curFrame = 0; if (ed.editTarget) goFrame(0); emit(); }
let playStart = 0, playFrom = 0;
export function togglePlay(){ ed.tlPlaying = !ed.tlPlaying; if (ed.tlPlaying && !ed.editTarget) goFrame(ed.curFrame); playStart = performance.now(); playFrom = ed.curFrame; emit(); }
// Play moves the playhead through the main view; call every animation frame
export function tick(ts){
  const a = cur(), an = curAnimOf(a); if (!ed.tlPlaying || !an || !ed.editTarget) return;
  const f = (playFrom + Math.floor((ts - playStart) * an.fps / 1000)) % an.frames;
  if (f !== ed.editTarget.f){ ed.editTarget.f = ed.curFrame = f; emit(); }
}
export function clickTimeline(f, boneId){
  if (boneId != null) ed.selBone = boneId;
  if (f == null) return emit();
  if (ed.tool !== 'pose' && !TOOLS[ed.tool]) ed.tool = 'pose';
  ed.tlPlaying = false; goFrame(f);
}
export function stepFrame(d){ ed.tlPlaying = false; goFrame(ed.curFrame + d); }
function keyBones(ids){
  const a = cur(), an = curAnimOf(a); if (!a || !an || !ids.length) return toast('Select a bone first');
  pushUndo(a);
  for (const id of ids) setKey(an, id, ed.curFrame, channelsAt(an.keys[id], ed.curFrame, an.frames, an.loop));
  if (!ed.editTarget) goFrame(ed.curFrame); emit();
}
export const keySelected = () => keyBones(ed.selBone != null ? [ed.selBone] : []);
export const keyAll = () => { const a = cur(); if (a) keyBones(a.rig.bones.map(b => b.id)); };
export function deleteKeys(){
  const a = cur(), an = curAnimOf(a); if (!an) return; const ids = ed.selBone != null ? [ed.selBone] : a.rig.bones.map(b => b.id); pushUndo(a);
  let n = 0; for (const id of ids){ const l = an.keys[id]; if (!l) continue; const before = l.length; an.keys[id] = l.filter(k => k.f !== ed.curFrame); n += before - an.keys[id].length; }
  toast(n ? `Deleted ${n} key${n > 1 ? 's' : ''}` : 'No key on this frame'); emit();
}
export function copyPose(){ const a = cur(), an = curAnimOf(a); if (!an) return; ed.poseClip = poseAt(a, an, ed.curFrame); toast('Pose copied'); }
export function pastePose(){ const a = cur(), an = curAnimOf(a); if (!an) return; if (!ed.poseClip) return toast('Copy a pose first'); pushUndo(a);
  for (const b of a.rig.bones) if (ed.poseClip[b.id]) setKey(an, b.id, ed.curFrame, ed.poseClip[b.id]); if (!ed.editTarget) goFrame(ed.curFrame); emit(); }
export function resetPose(){ const a = cur(), an = curAnimOf(a); if (!an) return; if (ed.selBone == null) return toast('Select a bone first'); pushUndo(a); setKey(an, ed.selBone, ed.curFrame, {...REST}); if (!ed.editTarget) goFrame(ed.curFrame); emit(); }
export function poseFields(){
  const a = cur(), an = curAnimOf(a), b = a && selB(a); if (!b || !an) return null;
  const c = channelsAt(an.keys[b.id], ed.curFrame, an.frames, an.loop), k = (an.keys[b.id] || []).find(q => q.f === ed.curFrame);
  return {bone: b.name, frame: ed.curFrame, keyed: !!k, ease: k ? k.ease : 'ease', ...c};
}
export function setPoseChannel(ch, v){
  const a = cur(), an = curAnimOf(a); if (!an || ed.selBone == null) return; pushUndo(a);
  const c = channelsAt(an.keys[ed.selBone], ed.curFrame, an.frames, an.loop); c[ch] = Number.isFinite(v) ? v : (ch[0] === 's' ? 1 : 0);
  setKey(an, ed.selBone, ed.curFrame, c); if (!ed.editTarget) goFrame(ed.curFrame); emit();
}
export function setEase(e){ const a = cur(), an = curAnimOf(a), k = an && (an.keys[ed.selBone] || []).find(q => q.f === ed.curFrame); if (!k) return; pushUndo(a); k.ease = e; emit(); }

// quick motions write editable keys for the selected bone
export const QUICK = {
  swing: {label: 'Attack swing', loop: false, keys: (F, s) => [[0, {rot: 0}, 'ease'], [Math.round(F*0.3), {rot: 60*s}, 'out'], [Math.round(F*0.5), {rot: -80*s}, 'linear'], [Math.round(F*0.72), {rot: -80*s}, 'ease'], [F - 1, {rot: 0}, 'ease']]},
  thrust: {label: 'Attack thrust', loop: false, keys: (F, s) => [[0, {x: 0}, 'ease'], [Math.round(F*0.3), {x: -2*s}, 'out'], [Math.round(F*0.5), {x: 5*s}, 'linear'], [Math.round(F*0.72), {x: 5*s}, 'ease'], [F - 1, {x: 0}, 'ease']]},
  wave: {label: 'Wave', loop: true, keys: (F, s) => [[0, {rot: -20*s}, 'ease'], [Math.round(F/2), {rot: 20*s}, 'ease']]},
  breathe: {label: 'Breathe', loop: true, keys: F => [[0, {sx: 1, sy: 1}, 'ease'], [Math.round(F/2), {sx: 0.98, sy: 1.06}, 'ease']]},
  bob: {label: 'Bob', loop: true, keys: F => [[0, {y: 0}, 'ease'], [Math.round(F/2), {y: -1}, 'ease']]},
  nod: {label: 'Nod', loop: true, keys: (F, s) => [[0, {rot: -6*s}, 'ease'], [Math.round(F/2), {rot: 6*s}, 'ease']]}
};
export function applyQuick(id){
  const a = cur(), an = curAnimOf(a); if (!an) return; if (ed.selBone == null) return toast('Select the bone to move first (an arm for swings, the root for breathe)');
  const q = QUICK[id], s = a.facing === 'left' ? -1 : 1; pushUndo(a);
  an.keys[ed.selBone] = [];
  for (const [f, vals, ease] of q.keys(an.frames, s)) setKey(an, ed.selBone, Math.max(0, Math.min(an.frames - 1, f)), {...REST, ...vals}, ease);
  an.loop = q.loop; if (!ed.editTarget) goFrame(0); emit(); toast(`${q.label} keys added to ${selB(a).name}. Drag the bone or edit keys to adjust`);
}
export {PRESET_ANIMS, PRESET_ORDER};
const needHumanoid = () => toast('Presets need a Humanoid rig. Pick Humanoid and click Auto-rig first');
// bake into the animation with that name (so re-adding replaces it), or create it
function addPreset(a, id){
  let an = a.anims.find(x => x.name === id);
  if (!an){ an = newAnim(id); a.anims.push(an); }
  if (!bakePreset(a, an, id)) return null;
  delete a.fedits[an.id]; return an;
}
export function addPresetAnim(id){
  const a = cur(); if (!a) return; if (!presetContext(a)) return needHumanoid();
  pushUndo(a); const an = addPreset(a, id); if (!an) return;
  a.curAnim = an.id; ed.tlPlaying = false; goFrame(0); toast(`Added ${PRESET_ANIMS[an.preset].label}. Every key is editable`);
}
export function addAllPresets(){
  const a = cur(); if (!a) return; if (!presetContext(a)) return needHumanoid();
  pushUndo(a); let first = null;
  for (const id of PRESET_ORDER){ const an = addPreset(a, id); first = first || an; }
  if (!first) return;
  a.curAnim = first.id; ed.tlPlaying = false; goFrame(0); toast('Added all 9 animations: idle, walk, run, attack, cast, jump, hit, death, victory');
}
export function rebuildPreset(){
  const a = cur(), an = curAnimOf(a); if (!an || !an.preset) return; if (!presetContext(a)) return needHumanoid();
  pushUndo(a); bakePreset(a, an, an.preset); delete a.fedits[an.id]; goFrame(Math.min(ed.curFrame, an.frames - 1)); toast('Rebuilt from the preset for this body and facing');
}
export function copyAnimTo(dstId){
  const a = cur(), an = curAnimOf(a), dst = assets.find(x => x.id === dstId);
  if (!an || !dst) return toast('Add another sketch to copy to');
  if (!dst.rig.bones.length) return toast(`Rig “${dst.name}” first (Auto-rig), so the animation has bones to drive`);
  const r = retargetAnim(a, an, dst); if (!r) return toast(`No bones in “${dst.name}” share names with this rig`);
  pushUndo(dst);
  const old = dst.anims.findIndex(x => x.name === an.name);
  if (old >= 0){ r.anim.id = dst.anims[old].id; dst.anims[old] = r.anim; } else dst.anims.push(r.anim);
  emit(); toast(`Copied “${an.name}” to ${dst.name}: ${r.how}`);
}

export {MATERIALS, SIZES, STYLES, S, P, assets, hex};
