// Builds the export pack: every frame is rendered once, then each engine gets its own folder.
// Carried over from Sprite Foundry; the files are handed to the app to write as a folder or a zip.
/* eslint-disable */
import { SIZES, S, P, assets, buildBase, finalize, toImage, rigFrames, variantPalettes, hex, boneAngle, boneLen, boneOrder, wrapDeg, layerTextures } from './core.js';
import { snake } from './editor.js';
import { snapshotTheme } from './style.js';

// collects files by path; canvases become PNGs, text becomes UTF-8
export class Pack {
  constructor(){ this.files = new Map(); }
  file(path, data){ this.files.set(path, data); }
  get size(){ return this.files.size; }
  toFiles(){ return [...this.files].map(([path, data]) => ({path, data: typeof data === 'string' ? textB64(data) : data.toDataURL('image/png').split(',')[1]})); }
}
export function textB64(s){
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// the original saved PNG blobs; a canvas is kept as is and encoded when the pack is written
const canvasBlob = cv => cv;
function idxCanvas(idx, N){ const c = document.createElement('canvas'); c.width = N; c.height = N; c.getContext('2d').putImageData(toImage(idx, N), 0, 0); return c; }
function uniqueNames(list){ const used = new Set(['default']); return list.map(a => { let n = snake(a.name) || a.type, k = n, i = 2; while (used.has(k)) k = n + '_' + i++; used.add(k); return k; }); }
function tres(path, N, rows){
  const subs = [], animStr = [];
  rows.forEach((r, ri) => {
    const fr = [];
    for (let f = 0; f < r.frames; f++){
      const id = `AtlasTexture_r${ri}f${f}`;
      subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("1_sheet")\nregion = Rect2(${f*N}, ${ri*N}, ${N}, ${N})\n`);
      fr.push(`{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`);
    }
    animStr.push(`{\n"frames": [${fr.join(', ')}],\n"loop": ${r.loop},\n"name": &"${r.name}",\n"speed": ${Number(r.fps).toFixed(1)}\n}`);
  });
  return `[gd_resource type="SpriteFrames" load_steps=${subs.length + 2} format=3]\n\n[ext_resource type="Texture2D" path="${path}" id="1_sheet"]\n\n${subs.join('\n')}\n[resource]\nanimations = [${animStr.join(', ')}]\n`;
}
/* ---------- export: every frame is rendered once, then each engine gets its own folder in the pack ---------- */
export const EXPORT_FORMATS = {
  godot:'Godot 4 (SpriteFrames .tres)', unity:'Unity (sliced sheets + animation clips)', gamemaker:'GameMaker (strip images)',
  spine:'Spine (skeleton JSON + atlas)', sequence:'PNG sequences', sheetjson:'Sprite sheet + JSON (Phaser, Defold…)'
};
// stable ids for files that reference each other (Unity guids / fileIDs): the same names give the same ids,
// so re-exporting over an existing import keeps scene references working
function hashHex(str, len = 32){
  let out = '';
  for (let r = 0; out.length < len; r++){ let h = 0x811c9dc5 ^ (r * 0x9e3779b1); for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } out += h.toString(16).padStart(8, '0'); }
  return out.slice(0, len);
}
const fileIdOf = str => (BigInt('0x' + hashHex(str, 15)) % 8000000000000000000n + 1000000000000000000n).toString();
const pad3 = n => String(n).padStart(3, '0');
function frameCanvas(idx, N){ const c = document.createElement('canvas'); c.width = N; c.height = N; c.getContext('2d').putImageData(toImage(idx, N), 0, 0); return c; }
function stripCanvas(frames, N){ const c = document.createElement('canvas'); c.width = N * frames.length; c.height = N; const g = c.getContext('2d'); frames.forEach((f, i) => g.putImageData(toImage(f, N), i * N, 0)); return c; }

// Unity: one sliced texture per sketch and size (Point filter, no compression, pivot at the feet),
// plus an AnimationClip per animation that swaps SpriteRenderer.m_Sprite
function unityFiles(zip, an, N, rows, sheetBlob, sheetH){
  const dir = `unity/${an}/`, tex = `${an}_${N}`, guid = hashHex('unity-tex:' + an + ':' + N), sprites = [];
  rows.forEach((r, ri) => r.data.forEach((_, fi) => sprites.push({name:`${tex}_${r.name}_${fi}`, x:fi * N, y:sheetH - (ri + 1) * N, id:fileIdOf(`${tex}:${r.name}:${fi}`)})));
  const spriteYaml = sprites.map(s => `    - serializedVersion: 2
      name: ${s.name}
      rect:
        serializedVersion: 2
        x: ${s.x}
        y: ${s.y}
        width: ${N}
        height: ${N}
      alignment: 7
      pivot: {x: 0.5, y: 0}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline: []
      physicsShape: []
      tessellationDetail: 0
      bones: []
      spriteID: ${hashHex('sprite:' + s.name)}
      internalID: ${s.id}
      vertices: []
      indices:
      edges: []
      weights: []`).join('\n');
  zip.file(dir + tex + '.png', sheetBlob);
  zip.file(dir + tex + '.png.meta', `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
  isReadable: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 0
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 2
  spriteExtrude: 1
  spriteMeshType: 0
  alignment: 7
  spritePivot: {x: 0.5, y: 0}
  spritePixelsToUnits: ${N}
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  textureType: 8
  textureShape: 1
  platformSettings:
  - serializedVersion: 3
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 0
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
  spriteSheet:
    serializedVersion: 2
    sprites:
${spriteYaml}
    outline: []
    physicsShape: []
    bones: []
    spriteID:
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    nameFileIdTable:
${sprites.map(s => `      ${s.name}: ${s.id}`).join('\n')}
  spritePackingTag:
  pSDRemoveMatte: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`);
  for (const r of rows){
    if (r.name === 'default') continue;
    const ids = r.data.map((_, fi) => fileIdOf(`${tex}:${r.name}:${fi}`)), clip = `${tex}_${r.name}`, dt = 1 / r.fps;
    // the last key repeats the final sprite at the end time, so the final frame gets its full duration
    const keys = [...ids.map((id, fi) => [fi * dt, id]), [r.data.length * dt, ids[ids.length - 1]]];
    zip.file(dir + 'clips/' + clip + '.anim', `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${clip}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
  - curve:
${keys.map(([t, id]) => `    - time: ${+t.toFixed(5)}
      value: {fileID: ${id}, guid: ${guid}, type: 3}`).join('\n')}
    attribute: m_Sprite
    path:
    classID: 212
    script: {fileID: 0}
  m_SampleRate: ${r.fps}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings:
    - serializedVersion: 2
      path: 0
      attribute: 0
      script: {fileID: 0}
      typeID: 212
      customType: 23
      isPPtrCurve: 1
    pptrCurveMapping:
${ids.map(id => `    - {fileID: ${id}, guid: ${guid}, type: 3}`).join('\n')}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${+(r.data.length * dt).toFixed(5)}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: ${r.loop ? 1 : 0}
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`);
    zip.file(dir + 'clips/' + clip + '.anim.meta', `fileFormatVersion: 2
guid: ${hashHex('unity-clip:' + clip)}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 7400000
  userData:
  assetBundleName:
  assetBundleVariant:
`);
  }
}
// Spine: a real skeletal export. Bones and hierarchy, one image per layer packed into an atlas, keys as timelines.
// Spine uses y-up and counter-clockwise angles with the origin at the sprite's bottom center.
async function spineFiles(zip, a, an, S){
  const bones = a.rig.bones;
  if (!bones.length || !a.rig.labels) return `${an}: skipped (needs Auto-rig or Layers from bones, so each part has its own image)`;
  const base = buildBase(a, S), still = finalize(base, S), shaded = finalize(base, S, 'shade'), tex = layerTextures(a, S, shaded), lN = tex.labels;
  const X = px => px - S / 2, Y = py => S - py;
  const world = b => ({x:X(b.hx * S), y:Y(b.hy * S), ang:-boneAngle(b) * 180 / Math.PI});
  const toLocal = (p, dx, dy) => { const r = -p.ang * Math.PI / 180; return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)]; };
  const r2 = v => Math.round(v * 100) / 100;
  // part images: the layer's own (and hidden, filled-in) pixels, plus the outline pixels that wrap it
  const parts = [];
  for (const b of bones){
    const t = tex.get(b.id); if (!t) continue;
    const img = t.slice();
    for (let i = 0; i < S*S; i++){
      if (still[i] < 0 || shaded[i] >= 0) continue;
      const x = i % S; if ([x > 0 ? i-1 : -1, x < S-1 ? i+1 : -1, i >= S ? i-S : -1, i < S*(S-1) ? i+S : -1].some(j => j >= 0 && lN[j] === b.id)) img[i] = still[i];
    }
    let x0 = S, y0 = S, x1 = -1, y1 = -1;
    for (let i = 0; i < S*S; i++) if (img[i] >= 0){ const x = i % S, y = (i / S) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, c = document.createElement('canvas'); c.width = w; c.height = h;
    const full = frameCanvas(img, S); c.getContext('2d').drawImage(full, x0, y0, w, h, 0, 0, w, h);
    parts.push({b, x0, y0, w, h, canvas:c});
  }
  // shelf-pack the parts into one atlas page
  const pageW = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(...parts.map(p => p.w + 2), 64) * 2)));
  let x = 1, y = 1, shelf = 0;
  for (const p of parts.slice().sort((q, r) => r.h - q.h)){ if (x + p.w + 1 > pageW){ x = 1; y += shelf + 2; shelf = 0; } p.ax = x; p.ay = y; x += p.w + 2; shelf = Math.max(shelf, p.h); }
  const pageH = y + shelf + 1, page = document.createElement('canvas'); page.width = pageW; page.height = pageH;
  for (const p of parts) page.getContext('2d').drawImage(p.canvas, p.ax, p.ay);
  const rootName = bones.some(b => b.name === 'origin') ? 'sf_origin' : 'origin';
  const order = boneOrder(bones), byId = new Map(bones.map(b => [b.id, b]));
  const jb = [{name:rootName}];
  for (const b of order){
    const wb = world(b), par = byId.get(b.parent);
    const o = {name:b.name, parent:par ? par.name : rootName, length:r2(boneLen(b) * S)};
    if (par){ const wp = world(par), [lx, ly] = toLocal(wp, wb.x - wp.x, wb.y - wp.y); Object.assign(o, {x:r2(lx), y:r2(ly), rotation:r2(wrapDeg(wb.ang - wp.ang))}); }
    else Object.assign(o, {x:r2(wb.x), y:r2(wb.y), rotation:r2(wb.ang)});
    jb.push(o);
  }
  const slots = parts.slice().sort((p, q) => (p.b.z || 0) - (q.b.z || 0)).map(p => ({name:p.b.name, bone:p.b.name, attachment:p.b.name}));
  const attachments = {};
  for (const p of parts){
    const wb = world(p.b), cx = X(p.x0 + p.w / 2), cy = Y(p.y0 + p.h / 2), [lx, ly] = toLocal(wb, cx - wb.x, cy - wb.y);
    attachments[p.b.name] = {[p.b.name]:{x:r2(lx), y:r2(ly), rotation:r2(-wb.ang), width:p.w, height:p.h}};
  }
  const animations = {};
  for (const m of a.anims){
    const tl = {};
    for (const b of bones){
      const keys = m.keys[b.id]; if (!keys || !keys.length) continue;
      const list = m.loop ? [...keys, {...keys[0], f:m.frames}] : keys;          // loops end where they began
      const ck = k => k.ease === 'step' ? {curve:'stepped'} : {};
      const t = k => +(k.f / m.fps).toFixed(4);
      tl[b.name] = {
        rotate:list.map(k => ({time:t(k), value:r2(-k.rot), ...ck(k)})),
        translate:list.map(k => ({time:t(k), x:r2(k.x * S / 32), y:r2(-k.y * S / 32), ...ck(k)})),
        scale:list.map(k => ({time:t(k), x:r2(k.sx), y:r2(k.sy), ...ck(k)}))
      };
    }
    animations[snake(m.name) || 'anim'] = {bones:tl};
  }
  const skel = {skeleton:{hash:hashHex('spine:' + an, 12), spine:'4.1.00', x:-S / 2, y:0, width:S, height:S, images:'./images/', audio:''},
    bones:jb, slots, skins:[{name:'default', attachments}], animations};
  const dir = `spine/${an}/`;
  zip.file(dir + an + '.json', JSON.stringify(skel, null, 1));
  zip.file(dir + an + '.png', await canvasBlob(page));
  zip.file(dir + an + '.atlas', `${an}.png\nsize:${pageW},${pageH}\nfilter:Nearest,Nearest\npma:false\n` + parts.map(p => `${p.b.name}\nbounds:${p.ax},${p.ay},${p.w},${p.h}`).join('\n') + '\n');
  for (const p of parts) zip.file(dir + 'images/' + p.b.name + '.png', await canvasBlob(p.canvas));
  return `${an}: ${jb.length - 1} bones, ${parts.length} parts, ${Object.keys(animations).length} animations at ${S}px`;
}
// the whole pack; returned (not saved) so it can be checked before download
export async function buildPack(opts = {}){
  const sizes = SIZES.filter(N => S.exportSizes[N]), F = S.exportFormats || {godot:true};
  const list = opts.sketches || assets, zip = new Pack(), root = S.godotPath.replace(/\/+$/, ''), used = new Set(), spineNotes = [], allNames = new Set();
  for (const a of list){
    let an = a.name, i = 2; while (used.has(an)) an = a.name + '_' + i++; used.add(an);
    const names = uniqueNames(a.anims); names.forEach(n => allNames.add(n));
    for (const N of sizes){
      const base = buildBase(a, N), still = finalize(base, N);
      const rows = [{name:'default', frames:1, fps:5, loop:true, data:[still]}, ...a.anims.map((m, k) => ({name:names[k], frames:m.frames, fps:m.fps, loop:m.loop, data:rigFrames(base, N, m, a)}))];
      const cols = Math.max(...rows.map(r => r.data.length));
      const sheet = document.createElement('canvas'); sheet.width = cols * N; sheet.height = rows.length * N;
      const g = sheet.getContext('2d'); rows.forEach((r, ri) => r.data.forEach((f, fi) => g.putImageData(toImage(f, N), fi * N, ri * N)));
      const sheetBlob = await canvasBlob(sheet), stillBlob = await canvasBlob(idxCanvas(still, N));
      if (F.godot){
        const dir = `godot/${an}/`, sheetName = `${an}_${N}_sheet.png`;
        zip.file(dir + `${an}_${N}.png`, stillBlob); zip.file(dir + sheetName, sheetBlob);
        zip.file(dir + `${an}_${N}_frames.tres`, tres(`${root}/${an}/${sheetName}`, N, rows.map(r => ({...r, frames:r.data.length}))));
        // color variants share the layout, so the same .tres works with the variant sheet swapped in
        if (S.exportVariants) for (const [k, pal] of variantPalettes().entries()){
          const vs = document.createElement('canvas'); vs.width = sheet.width; vs.height = sheet.height; const vg = vs.getContext('2d');
          rows.forEach((r, ri) => r.data.forEach((f, fi) => vg.putImageData(toImage(f, N, pal), fi * N, ri * N)));
          const one = document.createElement('canvas'); one.width = N; one.height = N; one.getContext('2d').putImageData(toImage(still, N, pal), 0, 0);
          zip.file(dir + `variants/${an}_${N}_v${k + 1}.png`, await canvasBlob(one));
          zip.file(dir + `variants/${an}_${N}_sheet_v${k + 1}.png`, await canvasBlob(vs));
        }
      }
      if (F.unity) unityFiles(zip, an, N, rows, sheetBlob, sheet.height);
      if (F.gamemaker) for (const r of rows) zip.file(`gamemaker/${an}/${an}_${N}_${r.name}_strip${r.data.length}.png`, await canvasBlob(stripCanvas(r.data, N)));
      if (F.sequence) for (const r of rows) for (const [fi, f] of r.data.entries()) zip.file(`png_sequences/${an}/${N}/${r.name}/${r.name}_${pad3(fi)}.png`, await canvasBlob(frameCanvas(f, N)));
      if (F.sheetjson){
        const frames = {}, animations = {}, tags = []; let n = 0;
        rows.forEach((r, ri) => { animations[r.name] = []; tags.push({name:r.name, from:n, to:n + r.data.length - 1, direction:'forward', fps:r.fps, loop:r.loop});
          r.data.forEach((_, fi) => { const key = `${an}_${r.name}_${fi}`; animations[r.name].push(key); n++;
            frames[key] = {frame:{x:fi * N, y:ri * N, w:N, h:N}, rotated:false, trimmed:false, spriteSourceSize:{x:0, y:0, w:N, h:N}, sourceSize:{w:N, h:N}, pivot:{x:0.5, y:1}, duration:Math.round(1000 / r.fps)}; }); });
        zip.file(`sheets/${an}_${N}.png`, sheetBlob);
        zip.file(`sheets/${an}_${N}.json`, JSON.stringify({frames, animations, meta:{app:'Pixel Forge', version:'1.0', image:`${an}_${N}.png`, format:'RGBA8888', size:{w:sheet.width, h:sheet.height}, scale:'1', frameTags:tags}}, null, 1));
      }
    }
    if (F.spine) spineNotes.push(await spineFiles(zip, a, an, Math.max(...sizes)));
  }
  const pc = document.createElement('canvas'); pc.width = P.rgb.length; pc.height = 1; const pg = pc.getContext('2d');
  P.rgb.forEach((c, i) => { pg.fillStyle = hex(c); pg.fillRect(i, 0, 1, 1); });
  zip.file('palette/palette.png', await canvasBlob(pc));
  zip.file('palette/palette.hex', P.rgb.map(c => hex(c).slice(1)).join('\n') + '\n');
  zip.file('palette/palette.gpl', 'GIMP Palette\nName: pixel_forge\nColumns: 8\n#\n' + P.rgb.map(c => `${c.join(' ')}\t${hex(c)}`).join('\n') + '\n');
  zip.file('style_profile.json', JSON.stringify(snapshotTheme(snake(opts.profileName || '') || 'my_style'), null, 2));
  const anims = [...allNames].join(', ') || 'none';
  const readme = ['Pixel Forge pack', '', `Sizes: ${sizes.join(', ')} px. Animations: default (the still sprite), ${anims}.`,
    'Every sheet has one row per animation (default first) and one column per frame; each cell is size x size.', ''];
  if (F.godot) readme.push('GODOT 4 (godot/)', `  1. Copy the folders inside godot/ into ${root}/ in your project, so the .tres paths line up.`,
    '  2. Project Settings > Rendering > Textures: set Default Texture Filter to Nearest.',
    '  3. Add an AnimatedSprite2D and drag <name>_<size>_frames.tres onto Sprite Frames. Names, speeds and looping are set.', '');
  if (F.unity) readme.push('UNITY (unity/)', '  1. Copy the folders inside unity/ into your Assets folder (keep each .png.meta next to its .png).',
    '  2. Textures import as Sprite (Multiple), Point filter, no compression, already sliced; pivot at the feet; Pixels Per Unit = size.',
    '  3. clips/ holds an AnimationClip per animation. Drag one onto a GameObject with a SpriteRenderer to create its Animator.', '');
  if (F.gamemaker) readme.push('GAMEMAKER (gamemaker/)', '  Create a sprite, click Import, and pick a *_stripN.png file: GameMaker splits it into N frames by the name.',
    '  Or drag the strip files into the Asset Browser. Then set the sprite speed to the FPS listed in sheets JSON or below.',
    ...list.flatMap(a => a.anims.map(m => `    ${a.name} ${m.name}: ${m.fps} fps${m.loop ? ', loops' : ''}`)), '');
  if (F.spine) readme.push('SPINE (spine/)', '  Each folder has <name>.json (Spine 4.1 skeleton), <name>.atlas + <name>.png (packed parts) and images/ (loose parts).',
    '  In Spine: Import Data, pick the .json. In a game, load the .json with the .atlas through your Spine runtime.',
    '  Bones, draw order and every key come across; easing is linear between keys, and per-frame paint fixes are not part of the skeleton.',
    ...spineNotes.map(n => '    ' + n), '');
  if (F.sequence) readme.push('PNG SEQUENCES (png_sequences/<name>/<size>/<animation>/)', '  One PNG per frame, numbered from 000.', '');
  if (F.sheetjson) readme.push('SPRITE SHEET + JSON (sheets/)', '  TexturePacker "JSON Hash" layout: frames with rects and durations, an animations list, and meta.frameTags',
    '  (from, to, fps, loop). Works with Phaser, Defold, PixiJS and most engines that read TexturePacker JSON.', '');
  zip.file('README.txt', readme.join('\n'));
  return {zip, spineNotes};
}

// one sprite at one size, as a canvas
export function spriteCanvas(a, N){ return idxCanvas(finalize(buildBase(a, N), N), N); }
