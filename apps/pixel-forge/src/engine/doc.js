// How a sketch is kept in the .pixelforge project: the sketch image as a PNG, and everything
// made on top of it (touch-ups, removed and colored areas, rig, animations) as JSON.
/* eslint-disable */
import { assets, newAsset, setKey, setNextId, getNextId, LR } from './core.js';

export const DOC_VERSION = 1;

// Maps of pixel index -> hex (or null for erased) become [index, hex] lists
const mapOut = m => m instanceof Map ? [...m.entries()] : [];
const mapIn = l => new Map(Array.isArray(l) ? l.filter(e => Array.isArray(e) && Number.isInteger(e[0])).map(([i, h]) => [i, typeof h === 'string' ? h : null]) : []);

// layer labels are LR×LR bone ids with long runs of the same value
export function rleOut(arr){
  const out = []; let i = 0;
  while (i < arr.length){ const v = arr[i]; let n = 1; while (i + n < arr.length && arr[i + n] === v) n++; out.push(v, n); i += n; }
  return out;
}
export function rleIn(list, size){
  const out = new Int32Array(size); let p = 0;
  for (let k = 0; k + 1 < list.length && p < size; k += 2){ const v = list[k] | 0, n = Math.min(list[k + 1] | 0, size - p); out.fill(v, p, p + n); p += n; }
  return out;
}

export function assetToDoc(a){
  const fedits = {};
  for (const [anim, bySize] of Object.entries(a.fedits || {})){
    fedits[anim] = {};
    for (const [N, byFrame] of Object.entries(bySize || {})){ fedits[anim][N] = {}; for (const [f, m] of Object.entries(byFrame || {})) fedits[anim][N][f] = mapOut(m); }
  }
  const edits = {}; for (const [N, m] of Object.entries(a.edits || {})) edits[N] = mapOut(m);
  const rig = {bones: a.rig.bones, snap: a.rig.snap !== false, labels: a.rig.labels ? rleOut(a.rig.labels) : null, mesh: a.rig.mesh || null};
  return {version: DOC_VERSION, edits, fedits, erasePts: a.erasePts || [], colorPts: a.colorPts || [], facing: a.facing || 'right',
    rig, anims: a.anims, curAnim: a.curAnim, aiPrompt: a.aiPrompt || '', sample: !!a.sample};
}

// rebuilds an editable sketch from what the project stored; ids stay the database's
export function docToAsset(id, name, src, doc){
  const a = newAsset(name, src); a.id = id;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.anims)) return a;
  a.edits = {}; for (const [N, l] of Object.entries(doc.edits || {})) a.edits[N] = mapIn(l);
  a.fedits = {};
  for (const [anim, bySize] of Object.entries(doc.fedits || {})){
    a.fedits[anim] = {};
    for (const [N, byFrame] of Object.entries(bySize || {})){ a.fedits[anim][N] = {}; for (const [f, l] of Object.entries(byFrame || {})) a.fedits[anim][N][f] = mapIn(l); }
  }
  a.erasePts = Array.isArray(doc.erasePts) ? doc.erasePts : [];
  a.colorPts = Array.isArray(doc.colorPts) ? doc.colorPts : [];
  a.facing = doc.facing === 'left' ? 'left' : 'right';
  const r = doc.rig || {};
  a.rig = {bones: Array.isArray(r.bones) ? r.bones : [], mesh: r.mesh || null, snap: r.snap !== false};
  if (Array.isArray(r.labels)) a.rig.labels = rleIn(r.labels, LR * LR);
  if (doc.anims.length) a.anims = doc.anims;
  a.curAnim = a.anims.some(x => x.id === doc.curAnim) ? doc.curAnim : a.anims[0].id;
  a.aiPrompt = doc.aiPrompt || '';
  a.sample = !!doc.sample;
  // new bones and animations must not reuse ids from what was loaded
  let max = 0;
  for (const b of a.rig.bones) max = Math.max(max, b.id | 0);
  for (const an of a.anims) max = Math.max(max, an.id | 0);
  setNextId(max + 1);
  return a;
}

// ---------------------------------------------------------------- images
export function imageDataToCanvas(im){ const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(im, 0, 0); return c; }
export const canvasToPngB64 = c => c.toDataURL('image/png').split(',')[1];
export const imageToPngB64 = im => canvasToPngB64(imageDataToCanvas(im));
// decodes any image the webview can read, scaled down so its longest side is at most `max`
export function urlToImageData(url, max){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = s < 1; g.drawImage(img, 0, 0, w, h);
      res(g.getImageData(0, 0, w, h));
    };
    img.onerror = () => rej(new Error('That image could not be read'));
    img.src = url;
  });
}
export const pngB64ToImageData = (b64, max = 4096) => urlToImageData('data:image/png;base64,' + b64, max);
export async function fileToImageData(file, max){
  const url = URL.createObjectURL(file);
  try { return await urlToImageData(url, max); }
  catch { throw new Error('Could not read ' + file.name); }
  finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------- example sketch (drawn by code, so nothing comes from other art)
export function exampleSketch(){
  const W = 480, c = document.createElement('canvas'); c.width = W; c.height = W; const g = c.getContext('2d');
  g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, W, W);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2500; i++){ g.fillStyle = `rgba(120,110,90,${rnd() * 0.06})`; g.fillRect(rnd() * W, rnd() * W, 2, 2); }
  const wob = (pts, close) => { g.beginPath(); pts.forEach(([x, y], i) => { x += (rnd() - 0.5) * 4; y += (rnd() - 0.5) * 4; i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (close) g.closePath(); };
  const ell = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 40) => Array.from({length:n + 1}, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
  g.lineJoin = 'round'; g.lineCap = 'round';
  // stem
  wob([[185, 250], [178, 390], [205, 412], [275, 412], [302, 390], [295, 250]], true); g.fillStyle = '#ecd6ae'; g.fill();
  g.fillStyle = '#d3b582'; wob([[262, 255], [295, 250], [302, 390], [275, 412], [262, 410]], true); g.fill();
  wob([[185, 250], [178, 390], [205, 412], [275, 412], [302, 390], [295, 250]], true); g.strokeStyle = '#2b2420'; g.lineWidth = 9; g.stroke();
  // cap
  const cap = [...ell(240, 255, 160, 150, Math.PI, Math.PI * 2), [400, 262], [80, 262]];
  wob(cap, true); g.fillStyle = '#d4463a'; g.fill();
  g.fillStyle = '#a8302a'; wob([...ell(240, 255, 160, 150, Math.PI * 1.72, Math.PI * 2, 14), [400, 262], [300, 262]], true); g.fill();
  g.fillStyle = '#f9f1e4';
  [[175, 170, 26], [262, 140, 20], [320, 205, 22], [205, 228, 14], [130, 230, 13]].forEach(([x, y, r]) => { wob(ell(x, y, r, r * 0.85, 0, Math.PI * 2, 18), true); g.fill(); });
  wob(cap, true); g.strokeStyle = '#2b2420'; g.lineWidth = 10; g.stroke();
  // face
  g.fillStyle = '#2b2420';
  [[215, 315], [265, 315]].forEach(([x, y]) => { wob(ell(x, y, 10, 15, 0, Math.PI * 2, 14), true); g.fill(); });
  g.lineWidth = 6; wob(ell(240, 345, 14, 8, 0.2, Math.PI - 0.2, 10)); g.stroke();
  g.fillStyle = '#e7928a'; [[195, 340], [285, 340]].forEach(([x, y]) => { wob(ell(x, y, 11, 6, 0, Math.PI * 2, 12), true); g.fill(); });
  return g.getImageData(0, 0, W, W);
}
// the example comes rigged: a stem bone with the cap chained on top, and an idle where the cap sways and the stem breathes
export function exampleAsset(){
  const ex = newAsset('mushroom_buddy', exampleSketch()); ex.sample = true;
  const first = getNextId(), ids = [first, first + 1];
  setNextId(first + 2);
  const stem = {id: ids[0], name: 'stem', parent: null, connected: false, hx: 0.5, hy: 0.93, tx: 0.5, ty: 0.55, z: 0};
  const cap = {id: ids[1], name: 'cap', parent: stem.id, connected: true, hx: 0.5, hy: 0.55, tx: 0.5, ty: 0.12, z: 1};
  ex.rig.bones.push(stem, cap);
  const idle = ex.anims[0];
  setKey(idle, cap.id, 0, {rot: -7}); setKey(idle, cap.id, 4, {rot: 7});
  setKey(idle, stem.id, 0, {sy: 1}); setKey(idle, stem.id, 4, {sy: 0.94, sx: 1.04});
  return ex;
}
export { assets };
