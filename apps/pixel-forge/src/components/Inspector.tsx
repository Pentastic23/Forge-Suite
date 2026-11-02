import { useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Badge, Button } from "@forge/ui";
import * as E from "../engine/editor";
import type { Display } from "../engine/editor";
import { analyzeStyle, applyTheme, applyTrained, isTheme, snapshotTheme, spritesFromImage, type Sprite, type StyleReport } from "../engine/style";
import { textB64 } from "../engine/pack";
import { profileOf, variantPalettes } from "../engine/core";
import { urlToImageData } from "../engine/doc";
import { api, baseName, errorText, IMAGE_EXT, mimeOf, plural, type Profile } from "../api";
import { meta } from "../project";
import type { Notify } from "../App";
import { useEditor } from "../useEditor";
import { Check, Color, Hint, Pick, Range, Section } from "./controls";
import { SpriteCanvas } from "./SpriteView";

export type Tab = "sketch" | "palette" | "convert" | "style" | "rig" | "train";
const TABS: [Tab, string][] = [["sketch", "Sketch"], ["palette", "Palette"], ["convert", "Convert"], ["style", "Style"], ["rig", "Rig"], ["train", "Train"]];

/** The properties column on the right of the studio. */
export function Inspector(props: { display: Display | null; notify: Notify; tab: Tab; onTab: (t: Tab) => void }) {
  useEditor();
  return (
    <div className="inspector">
      <div className="tabs" role="tablist" aria-label="Properties">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={props.tab === k} onClick={() => props.onTab(k)}>{l}</button>)}
      </div>
      <div className="inspector-body" role="tabpanel">
        {props.tab === "sketch" && <SketchPanel display={props.display} />}
        {props.tab === "palette" && <PalettePanel display={props.display} notify={props.notify} />}
        {props.tab === "convert" && <ConvertPanel />}
        {props.tab === "style" && <StylePanel notify={props.notify} />}
        {props.tab === "rig" && <RigPanel />}
        {props.tab === "train" && <TrainPanel notify={props.notify} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sketch
function SketchPanel(props: { display: Display | null }) {
  const a = E.cur();
  const thumb = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (a && thumb.current) E.drawThumb(a, thumb.current, 220, true); });
  if (!a || !props.display) return <Hint>Add a sketch from the Library, or drop image files on the window.</Hint>;
  const st = E.stats(props.display.disp);
  const m = meta.get(a.id);
  return (
    <>
      <Section title="Sketch">
        <input className="forge-input full" aria-label="Sketch name" key={a.id + a.name} defaultValue={a.name}
          onBlur={(e) => e.target.value !== a.name && E.renameSketch(a, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        {m && <div className="muted small" style={{ marginTop: 6 }}>{m.folder}{m.tags.length ? ` · ${m.tags.join(", ")}` : ""}</div>}
        <div className="thumb-box checker">
          <canvas ref={thumb} style={{ cursor: E.ed.eraseMode ? "crosshair" : undefined }} aria-label="Cleaned sketch"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); E.eraseAt(e.currentTarget, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }} />
        </div>
        <Hint>The sketch after background removal. This is what the pixel art is made from.</Hint>
      </Section>
      <Section title="Fix areas">
        <div className="row-wrap">
          <Button aria-pressed={E.ed.eraseMode} variant={E.ed.eraseMode ? "primary" : undefined} onClick={() => E.toggle("eraseMode")}>Remove an area</Button>
          <Button variant="ghost" onClick={() => E.clearErase()}>Restore</Button>
        </div>
        <Hint>Click a shadow or smudge on the sketch above to remove it.</Hint>
        <div className="row-wrap">
          <input type="color" className="swatch-input" aria-label="Area color" value={E.ed.areaColor} onChange={(e) => { E.ed.areaColor = e.target.value; E.emit(); }} />
          <Button aria-pressed={E.ed.colorMode} variant={E.ed.colorMode ? "primary" : undefined} onClick={() => E.toggle("colorMode")}>Color an area</Button>
          <Button variant="ghost" onClick={() => E.clearColors()}>Clear</Button>
        </div>
        <Hint>Pick a color, then click a part of the sprite (hair, jacket, skin). It is filled on the sketch, so every size picks it up.</Hint>
      </Section>
      {st && (
        <Section title="This sprite">
          <dl className="stats">
            <dt>Colors used</dt><dd>{st.colors} / {st.palette}</dd>
            <dt>Pixels filled</dt><dd>{st.filled.toLocaleString()}</dd>
            <dt>Touch-ups</dt><dd>{st.touchUps}</dd>
            <dt>Bones</dt><dd>{st.bones}</dd>
            {st.unpainted > 0.05 && <><dt>Bare paper</dt><dd>{Math.round(st.unpainted * 100)}% {st.filledPaper ? "filled" : "kept"}</dd></>}
            <dt>Sketch</dt><dd>{st.w}×{st.h}</dd>
          </dl>
          <Button variant="ghost" onClick={() => E.clearEdits()}>Clear touch-ups at {E.ed.viewN}×{E.ed.viewN}</Button>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- palette
function PalettePanel(props: { display: Display | null; notify: Notify }) {
  const sel = E.ed.selSw;
  const olc = E.outlineIndex();
  const sw = (i: number) => {
    const c = E.hex(E.P.rgb[i]);
    const gen = E.isGenerated(i);
    return (
      <button key={i} className={`sw${i === sel ? " on" : ""}${i === olc && E.S.outline === "outer" ? " ol" : ""}`} style={{ background: c }}
        title={`${c}${i === olc ? " (outline)" : ""}${gen ? " · generated shade" : " · " + (E.MATERIALS[E.materialOf(i)] ?? "")}`}
        aria-label={`${gen ? "Shade" : "Color"} ${c}`} aria-pressed={i === sel} onClick={() => E.selectSwatch(i)} />
    );
  };
  const base = E.P.rgb.slice(0, E.P.baseCount).map((_, i) => sw(i));
  const shades = E.P.rgb.slice(E.P.baseCount).map((_, i) => sw(i + E.P.baseCount));
  const importPal = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Palette", extensions: ["hex", "gpl", "txt", "pal", ...IMAGE_EXT] }] });
    if (typeof path !== "string") return;
    try {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (IMAGE_EXT.includes(ext)) {
        const im = await urlToImageData(`data:${mimeOf(path)};base64,${await api.readImage(path)}`, 512);
        E.importPalette(E.paletteFromImage(im), baseName(path));
      } else E.importPalette(E.parsePaletteText(await api.readText(path)), baseName(path));
    } catch (e) { props.notify(errorText(e), true); }
  };
  const pals = props.display && E.S.variantCount > 0 ? [E.P.rgb, ...variantPalettes()] : [];
  return (
    <>
      <Section title="Palette">
        <Pick k="paletteMode" label="Colors from" options={[["auto", "My sketches (auto)"], ["custom", "My palette (fixed)"]]} />
        {E.S.paletteMode === "auto" && <Range k="autoCount" label="Color count" min={3} max={32} />}
        <div className="lbl">Base colors</div>
        <div className="swatches">{base}</div>
        {shades.length > 0 && <><div className="lbl">Shades made from them</div><div className="swatches">{shades}</div></>}
        <div className="row-wrap">
          <input type="color" className="swatch-input" aria-label="Selected color" value={E.hex(E.P.rgb[sel] ?? [0, 0, 0])} onChange={(e) => E.setSwatchColor(e.target.value)} />
          <Button onClick={() => E.addSwatch(E.hex(E.P.rgb[sel] ?? [128, 128, 128]))}>Add</Button>
          <Button onClick={() => E.removeSwatch()}>Remove</Button>
          <Button onClick={() => E.useAsOutline()}>Use as outline</Button>
        </div>
        <div className="ctl">
          <label htmlFor="swMat">Material</label>
          <select id="swMat" className="forge-input" value={E.materialOf(sel)} disabled={E.isGenerated(sel) || sel === E.P.darkest} onChange={(e) => E.setSwatchMaterial(e.target.value)}>
            {Object.entries(E.MATERIALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Check k="lockPalette" label="Only these colors" text="no generated shades" />
        <div className="row-wrap">
          <Button onClick={() => void importPal()}>Import palette…</Button>
          <Button variant="ghost" onClick={() => E.keepPalette()}>Keep current colors</Button>
        </div>
        <Hint>Import a .hex, .gpl or .txt list, or a palette image. Editing a color switches the palette to fixed.</Hint>
      </Section>
      <Section title="Color variants">
        <Range k="variantCount" label="Variants" min={0} max={8} />
        <Range k="variantSpread" label="Hue spread" min={15} max={180} unit="°" />
        <Check k="exportVariants" label="Export" text="include variants in the pack" />
        <Hint>Recolors by rotating hues. Skin tones and outlines stay put, so variants read as the same character in new gear.</Hint>
        {pals.length > 0 && props.display && (
          <div className="variants">
            {pals.map((pal, k) => (
              <figure key={k} className="checker"><SpriteCanvas idx={props.display!.still} N={props.display!.N} box={72} pal={pal} label={k ? `Variant ${k}` : "Original"} /><figcaption>{k ? `variant ${k}` : "original"}</figcaption></figure>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- conversion
const BG_HINTS: Record<string, string> = {
  outlined: "Best for paper sketches: trace your art with a bold, closed dark outline. Everything outside it (paper, shadows, lighting) is dropped, and everything inside is kept, white paint included.",
  paper: "Removes bright, colorless paper after evening out the lighting. Use when your art has no closed outline.",
  edges: "For digital art on one flat background color.",
  gaps: "Like \"from edges\", and also clears background showing through closed gaps.",
  key: "Removes every pixel close to the corner color, inside or out.",
  none: "Keeps every pixel.",
};
function ConvertPanel() {
  const S = E.S;
  const paperish = S.bg === "outlined" || S.bg === "paper";
  return (
    <>
      <Section title="Background">
        <Pick k="bg" label="Background" options={[["outlined", "Inside my outline (paper sketches)"], ["paper", "Photo of paper (auto)"], ["edges", "Flat color, from edges"], ["gaps", "Flat color, edges + closed gaps"], ["key", "Flat color, all matching"], ["none", "Keep"]]} />
        <Hint>{BG_HINTS[S.bg] ?? ""}</Hint>
        {S.bg === "outlined" && <Range k="inkGap" label="Close gaps" min={0} max={12} />}
        {paperish && <Check k="flatten" label="Paper lighting" text="even out shadows and tint" />}
        {paperish && <Pick k="uncolored" label="Uncolored areas" options={[["auto", "Fill when it is line art"], ["fill", "Always fill"], ["keep", "Keep the paper white"]]} />}
        {paperish && <Color k="fillHex" label="Fill color" note="Recolor areas later with the Fill tool" />}
        <Range k="bgTol" label="Tolerance" min={0} max={140} />
        <Range k="eraseTol" label="Area removal" min={5} max={120} />
      </Section>
      <Section title="Framing and pixels">
        <Pick k="fit" label="Framing" options={[["bottom", "Trim, sit on bottom"], ["center", "Trim, center"], ["height", "Match profile height"], ["full", "Use whole image"]]} />
        {S.fit === "height" && <Range k="charHeight" label="Character height" min={30} max={100} unit="%" />}
        <Range k="marginPct" label="Margin" min={0} max={25} unit="%" />
        <Pick k="method" label="Pixel method" options={[["dominant", "Dominant color (crisp)"], ["average", "Average color (soft)"]]} />
        <Range k="lineBoost" label="Line weight" min={0} max={6} step={0.25} />
        <Range k="coverage" label="Fill cutoff" min={5} max={90} unit="%" />
        <Range k="lineDark" label="Line darkness" min={5} max={50} />
        <Check k="despeckle" label="Clean strays" text="remove lone pixels" />
      </Section>
      <Section title="Each size">
        <ProfileTable />
        <Hint><b>Redraw</b> rebuilds the sprite from flat shapes with a clean outline instead of shrinking your lines. <b>Inner</b> keeps strong inside lines (face, limbs). <b>Colors</b> caps the palette at that size (0 = all). <b>Simplify</b> removes busy texture.</Hint>
      </Section>
      <Section title="Adjust">
        <Range k="bright" label="Brightness" min={-60} max={60} />
        <Range k="contrast" label="Contrast" min={-60} max={60} />
        <Range k="sat" label="Saturation" min={-100} max={100} />
        <Pick k="dither" label="Dithering" options={[["none", "None"], ["b2", "Ordered 2×2"], ["b4", "Ordered 4×4"]]} />
        {S.dither !== "none" && <Range k="ditherAmt" label="Dither amount" min={0} max={100} />}
        {S.method !== "average" && S.dither !== "none" && <Hint>Dithering applies with the Average method.</Hint>}
      </Section>
    </>
  );
}
function ProfileTable() {
  return (
    <div className="prof">
      <span className="h">Size</span><span className="h">Lines</span><span className="h" title="Keep strong inner lines">Inner</span><span className="h">Colors</span><span className="h">Simplify</span><span className="h">Shading</span><span className="h">Outline</span>
      {E.SIZES.map((N) => {
        const pr = profileOf(N);
        const set = (patch: Record<string, unknown>) => E.setProfile(N, patch);
        return [
          <b key={`b${N}`}>{N}</b>,
          <select key={`l${N}`} aria-label={`${N} px line art`} value={pr.lines} onChange={(e) => set({ lines: e.target.value })}><option value="redraw">Redraw</option><option value="keep">Keep</option></select>,
          <input key={`i${N}`} type="checkbox" aria-label={`${N} px keep inner lines`} checked={pr.inner} onChange={(e) => set({ inner: e.target.checked })} />,
          <input key={`c${N}`} type="number" min={0} max={64} aria-label={`${N} px color limit`} value={pr.colors} onChange={(e) => set({ colors: Math.max(0, +e.target.value || 0) })} />,
          <select key={`s${N}`} aria-label={`${N} px simplify`} value={pr.simplify} onChange={(e) => set({ simplify: +e.target.value })}>{[0, 1, 2, 3].map((v) => <option key={v}>{v}</option>)}</select>,
          <select key={`h${N}`} aria-label={`${N} px shading`} value={pr.shade} onChange={(e) => set({ shade: e.target.value })}><option value="global">Style</option><option value="cel">Cel</option><option value="rim">Edge</option><option value="none">Off</option></select>,
          <select key={`o${N}`} aria-label={`${N} px outline placement`} value={pr.olPos} onChange={(e) => set({ olPos: e.target.value })}><option value="out">Outside</option><option value="in">Inside</option></select>,
        ];
      })}
    </div>
  );
}

// ---------------------------------------------------------------- style and profiles
function StylePanel(props: { notify: Notify }) {
  const { notify } = props;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState("");
  const load = () => api.profiles().then(setProfiles).catch((e) => notify(errorText(e), true));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async () => {
    const n = E.snake(name) || `style_${profiles.length + 1}`;
    try { await api.saveProfile(n, snapshotTheme(n)); setName(n); setChosen(n); await load(); notify(`Saved profile ${n}`); } catch (e) { notify(errorText(e), true); }
  };
  const loadProfile = (n: string) => {
    setChosen(n);
    const p = profiles.find((x) => x.name === n);
    if (p && applyTheme(p.data)) { setName(n); notify(`Loaded profile ${n}`); }
  };
  const del = async () => {
    if (!chosen) return notify("Pick a saved profile first");
    try { await api.deleteProfile(chosen); setChosen(""); await load(); notify("Profile deleted"); } catch (e) { notify(errorText(e), true); }
  };
  const exportJson = async () => {
    const n = E.snake(name) || "my_style";
    const path = await save({ defaultPath: `${n}.json`, filters: [{ name: "Style profile", extensions: ["json"] }] });
    if (!path) return;
    try { await api.exportFile(path, textB64(JSON.stringify(snapshotTheme(n), null, 2))); notify(`Saved ${baseName(path)}`); } catch (e) { notify(errorText(e), true); }
  };
  const importJson = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Style profile", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const t: unknown = JSON.parse(await api.readText(path));
      if (!isTheme(t)) return notify("That file is not a style profile", true);
      applyTheme(t);
      const n = E.snake(t.name || baseName(path));
      await api.saveProfile(n, t); setName(n); setChosen(n); await load(); notify(`Imported profile ${n}`);
    } catch (e) { notify(errorText(e), true); }
  };

  const styles: [string, string][] = [...Object.entries(E.STYLES).map(([k, v]) => [k, v.label] as [string, string]), ["custom", "Custom (edited)"]];
  return (
    <>
      <Section title="Style">
        <div className="ctl">
          <label htmlFor="stylePreset">Style preset</label>
          <select id="stylePreset" className="forge-input" value={E.STYLES[E.S.style] ? E.S.style : "custom"} onChange={(e) => e.target.value !== "custom" && E.applyStyle(e.target.value)}>
            {styles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <Hint>Presets set shading rules, shade ramps and outlines. Every value below stays editable.</Hint>
        <Pick k="outline" label="Outline" options={[["outer", "Solid outline"], ["selective", "Selective (tinted)"], ["none", "None"]]} />
        <Pick k="outlineWidth" label="Thickness" numeric options={[[1, "1 px"], [2, "2 px (48 px and up)"]]} />
        <Check k="outline8" label="Corners" text="fill outline diagonals" />
        <Pick k="shade" label="Auto shading" options={[["form", "Volume (light direction)"], ["cel", "Cel (hard shadow)"], ["soft", "Edge shadow + highlight"], ["rim", "Edge shadow only"], ["deep", "Deep edge shadow"], ["none", "None"]]} />
        <Pick k="shadeBands" label="Shadow steps" numeric options={[[1, "1 (shadow)"], [2, "2 (shadow + deep)"]]} />
        <Pick k="light" label="Light from" options={[["tl", "Top left"], ["t", "Top"], ["tr", "Top right"]]} />
      </Section>
      <Section title="Shade ramps">
        <Range k="rampStep" label="Step size" min={5} max={20} />
        <Range k="rampHue" label="Hue shift" min={0} max={40} unit="°" />
        <Range k="shadowHue" label="Shadow hue" min={0} max={359} />
        <Range k="lightHue" label="Light hue" min={0} max={359} />
        <Check k="pixelPerfect" label="Lines" text="pixel-perfect outlines, no bumps" />
        <Check k="cleanShading" label="Shading" text="merge specks into clean clusters" />
        <Hint>Shadows step toward the shadow hue and highlights toward the light hue, the way pixel artists build ramps. Set a color's material under Palette to change how it shades.</Hint>
      </Section>
      <Section title="Style profiles">
        <Hint>A profile keeps the palette, outline, shading, light, pixel density and character height. Convert every sketch with one profile and the whole game matches.</Hint>
        <div className="ctl">
          <label htmlFor="profSel">Load profile</label>
          <select id="profSel" className="forge-input" value={chosen} onChange={(e) => loadProfile(e.target.value)}>
            <option value="">{profiles.length ? "Pick a profile" : "No saved profiles"}</option>
            {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div className="row-wrap">
          <input className="forge-input" style={{ flex: 1 }} placeholder="Profile name, e.g. forest_tier" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => void saveProfile()}>Save</Button>
        </div>
        <div className="row-wrap">
          <Button onClick={() => void exportJson()}>Export .json…</Button>
          <Button onClick={() => void importJson()}>Import .json…</Button>
          <Button variant="ghost" onClick={() => void del()} disabled={!chosen}>Delete</Button>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- rig
function RigPanel() {
  const a = E.cur();
  const [type, setType] = useState("humanoid");
  const [arms, setArms] = useState("auto");
  if (!a) return <Hint>Add a sketch to rig it.</Hint>;
  const bones = a.rig.bones;
  const b = bones.find((q) => q.id === E.ed.selBone);
  const blocked = b ? new Set([b.id, ...E.descendants(bones, b.id)]) : new Set<number>();
  const m = a.rig.mesh;
  return (
    <>
      <Section title="Auto-rig">
        <div className="row-wrap">
          <select className="forge-input" aria-label="Rig type" value={type} onChange={(e) => setType(e.target.value)}><option value="humanoid">Humanoid</option><option value="chain">Creature / chain</option></select>
          <select className="forge-input" aria-label="Arm pose" value={arms} onChange={(e) => setArms(e.target.value)} disabled={type !== "humanoid"}><option value="auto">Arms: detect</option><option value="side">Arms: at the sides</option><option value="out">Arms: out from body</option></select>
        </div>
        <div className="row-wrap">
          <Button variant="primary" onClick={() => E.autoRigCur(type, arms)}>Auto-rig</Button>
          <Button onClick={() => E.makeLayers()} title="Split the sprite into one layer per bone">Layers from bones</Button>
        </div>
        <Hint>Finds the head, hands, feet and joints from the silhouette, builds the skeleton and splits the sprite into layers, so parts move cleanly.</Hint>
        <div className="ctl">
          <label htmlFor="facing">Facing</label>
          <select id="facing" className="forge-input" value={a.facing} onChange={(e) => E.setFacing(e.target.value as "left" | "right")}><option value="right">Faces right</option><option value="left">Faces left</option></select>
        </div>
      </Section>
      <Section title={`Bones (${bones.length})`}>
        {!bones.length && <Hint>No bones yet. Pick the Bones tool, then drag on the sprite from a joint outward (hip to shoulder, shoulder to hand), or use Auto-rig.</Hint>}
        <div className="bone-list">
          {E.boneOrder(bones).map((q) => (
            <button key={q.id} className={`bone${q.id === E.ed.selBone ? " on" : ""}`} style={{ paddingLeft: 8 + E.boneDepth(bones, q) * 14 }} onClick={() => E.selectBone(q.id)}>
              <span className="dot" style={{ background: E.boneColor(a, q.id) }} />{q.name}
            </button>
          ))}
        </div>
        {b && (
          <div className="bone-props">
            <div className="ctl"><label htmlFor="bName">Name</label><input id="bName" className="forge-input" key={b.id + b.name} defaultValue={b.name} onBlur={(e) => e.target.value !== b.name && E.renameBone(e.target.value)} /></div>
            <div className="ctl"><label htmlFor="bParent">Parent</label>
              <select id="bParent" className="forge-input" value={b.parent ?? ""} onChange={(e) => E.setBoneParent(e.target.value === "" ? null : +e.target.value)}>
                <option value="">None (root)</option>
                {bones.filter((q) => !blocked.has(q.id)).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </div>
            <div className="ctl"><label htmlFor="bZ">Draw order</label><input id="bZ" className="forge-input" type="number" key={`${b.id}z${b.z}`} defaultValue={b.z ?? 0} onBlur={(e) => E.setBoneZ(+e.target.value)} /></div>
            <Button variant="ghost" onClick={() => E.deleteBone()}>Delete bone</Button>
          </div>
        )}
      </Section>
      <Section title="Mesh and display">
        <p className="muted small">{!bones.length ? "The mesh is made when you add your first bone." : m ? `${plural(m.verts.length, "vertex", "vertices")}, ${plural(m.tris.length, "triangle")} · weights ${m.painted ? "painted" : "automatic"}` : "The mesh will be built from the sprite."}</p>
        <div className="row-wrap">
          <Button disabled={!bones.length} onClick={() => E.rebuildMesh(m?.grid ?? 20)}>Rebuild mesh</Button>
          <Button disabled={!bones.length} onClick={() => E.resetWeights()}>Automatic weights</Button>
        </div>
        <label className="check"><input type="checkbox" checked={E.ed.showBones} onChange={() => E.toggle("showBones")} /> Show bones with every tool</label>
        <label className="check"><input type="checkbox" checked={E.ed.showMesh} onChange={() => E.toggle("showMesh")} /> Show mesh</label>
        <label className="check"><input type="checkbox" checked={E.ed.showLayers} onChange={() => E.toggle("showLayers")} /> Show layers</label>
        <label className="check"><input type="checkbox" checked={a.rig.snap !== false} onChange={(e) => E.setSnap(e.target.checked)} /> Snap moving parts to whole pixels</label>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- style training
function TrainPanel(props: { notify: Notify }) {
  const { notify } = props;
  const [cell, setCell] = useState(0);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<StyleReport>();
  const run = async () => {
    const picked = await open({ multiple: true, filters: [{ name: "Sprites", extensions: ["png", "gif", "webp", "bmp"] }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (!paths.length) return;
    setBusy(true);
    const sprites: Sprite[] = [];
    for (const p of paths) {
      try { sprites.push(...spritesFromImage(await urlToImageData(`data:${mimeOf(p)};base64,${await api.readImage(p)}`, 4096), cell)); }
      catch (e) { notify(`${baseName(p)}: ${errorText(e)}`, true); }
      if (sprites.length >= 400) break;
    }
    setBusy(false);
    if (!sprites.length) return notify("No sprites found. Check the sheet cell size", true);
    setReport(analyzeStyle(sprites.slice(0, 400)));
  };
  const LIGHT: Record<string, string> = { tl: "top left", t: "top", tr: "top right" };
  const OL: Record<string, string> = { outer: "solid", selective: "selective (tinted)", none: "none" };
  return (
    <>
      <Section title="Style Training">
        <Hint>Pick 20 to 100 finished sprites from your game. Their palette, outlines, shading and proportions become the rules for every new conversion. It only measures them: nothing else is learned, and nothing leaves your computer.</Hint>
        <div className="ctl">
          <label htmlFor="trainCell">Sheet cell size</label>
          <input id="trainCell" className="forge-input" type="number" min={0} max={512} value={cell} onChange={(e) => setCell(Math.max(0, +e.target.value || 0))} />
        </div>
        <Hint>Leave 0 for one sprite per file. For sprite sheets, enter the cell size (for example 32).</Hint>
        <Button variant="primary" disabled={busy} onClick={() => void run()}>{busy ? "Measuring…" : "Pick sprites…"}</Button>
      </Section>
      {report && (
        <Section title={`Learned from ${plural(report.count, "sprite")}`}>
          <div className="swatches">{report.palette.map((c) => <span key={c} className="sw static" style={{ background: c }} title={c} />)}</div>
          <dl className="stats">
            <dt>Colors</dt><dd>{report.palette.length}</dd>
            <dt>Outline</dt><dd>{OL[report.outline]}{report.outline === "outer" ? ` ${report.ink}` : ""}</dd>
            <dt>Thickness</dt><dd>{report.outlineWidth} px</dd>
            <dt>Shading</dt><dd>{report.shade === "cel" ? "cel (hard)" : "volume"}</dd>
            <dt>Shades per ramp</dt><dd>{report.rampLength}</dd>
            <dt>Step size</dt><dd>{report.rampStep ?? "n/a"}</dd>
            <dt>Hue shift</dt><dd>{report.rampHue == null ? "n/a" : `${report.rampHue}°`}</dd>
            <dt>Shadow hue</dt><dd>{report.shadowHue ?? "n/a"}</dd>
            <dt>Light from</dt><dd>{LIGHT[report.light]}</dd>
            <dt>Typical size</dt><dd>{report.size} px</dd>
            <dt>Character height</dt><dd>{report.charHeight}%</dd>
            <dt>Height ÷ width</dt><dd>{report.aspect}</dd>
          </dl>
          {report.notes.map((n) => <p key={n} className="hint"><Badge tone="warn">Note</Badge> {n}</p>)}
          <Button variant="primary" onClick={() => { const N = applyTrained(report); E.setView(N); notify("Style applied. Save it as a profile under Style to keep it"); }}>Apply to project</Button>
        </Section>
      )}
    </>
  );
}
