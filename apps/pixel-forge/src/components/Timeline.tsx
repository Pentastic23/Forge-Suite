import { useEffect, useRef, useState } from "react";
import { Button } from "@forge/ui";
import * as E from "../engine/editor";
import type { Display } from "../engine/editor";
import { useEditor } from "../useEditor";

const EASES: [string, string][] = [["ease", "Smooth"], ["linear", "Linear"], ["in", "Ease in"], ["out", "Ease out"], ["step", "Hold (step)"]];

/** The bottom panel: animations, the key grid (one row per bone, one column per frame), and posing. */
export function Timeline(props: { display: Display | null }) {
  useEditor();
  const a = E.cur();
  const an = E.curAnimOf(a);
  const [preset, setPreset] = useState(E.PRESET_ORDER[0]);
  const [quick, setQuick] = useState("swing");
  const [copyTo, setCopyTo] = useState<number>();
  if (!a || !an) return <div className="timeline empty"><span className="muted">Add a sketch to animate it.</span></div>;

  const bones = E.boneOrder(a.rig.bones);
  const F = an.frames;
  const on = !!E.ed.editTarget;
  const cf = E.ed.curFrame;
  const pose = E.poseFields();
  const others = E.assets.filter((x) => x !== a);

  return (
    <div className="timeline">
      <div className="tl-bar">
        <select className="forge-input" aria-label="Animation" value={an.id} onChange={(e) => E.selectAnim(+e.target.value)}>
          {a.anims.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input className="forge-input name" aria-label="Animation name" key={`n${an.id}${an.name}`} defaultValue={an.name} onBlur={(e) => e.target.value !== an.name && E.renameAnim(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        <label className="opt">Frames <input className="forge-input num" type="number" min={1} max={48} key={`f${an.id}${F}`} defaultValue={F} onBlur={(e) => +e.target.value !== F && E.setAnimFrames(+e.target.value)} /></label>
        <label className="opt">FPS <input className="forge-input num" type="number" min={1} max={60} key={`p${an.id}${an.fps}`} defaultValue={an.fps} onBlur={(e) => +e.target.value !== an.fps && E.setAnimFps(+e.target.value)} /></label>
        <label className="opt"><input type="checkbox" checked={an.loop} onChange={(e) => E.setAnimLoop(e.target.checked)} /> Loop</label>
        <Button onClick={() => E.togglePlay()} variant={E.ed.tlPlaying ? "primary" : undefined} title="Play / pause (Space)">{E.ed.tlPlaying ? "Pause" : "Play"}</Button>
        <Button onClick={() => E.stepFrame(-1)} title="Previous frame (,)" aria-label="Previous frame">‹</Button>
        <Button onClick={() => E.stepFrame(1)} title="Next frame (.)" aria-label="Next frame">›</Button>
        {on && <label className="opt"><input type="checkbox" checked={E.ed.onion} onChange={() => E.toggle("onion")} /> Onion skin</label>}
        <span className="spacer" />
        <Button variant="ghost" onClick={() => E.newAnimation()}>New</Button>
        <Button variant="ghost" onClick={() => E.duplicateAnim()}>Duplicate</Button>
        <Button variant="ghost" onClick={() => E.deleteAnim()} disabled={a.anims.length < 2}>Delete</Button>
      </div>

      <div className="tl-body">
        <div className="tl-grid-wrap">
          <div className="tl-grid" style={{ gridTemplateColumns: `minmax(96px,140px) repeat(${F}, minmax(20px,1fr))` }}>
            <div className="tl-h" />
            {Array.from({ length: F }, (_, f) => (
              <button key={f} className={`tl-h tl-f${on && f === cf ? " now" : ""}`} onClick={() => E.clickTimeline(f)} aria-label={`Frame ${f + 1}`}>{f + 1}</button>
            ))}
            {!bones.length && <>
              <div className="tl-name muted">add bones to key them</div>
              {Array.from({ length: F }, (_, f) => <div key={f} className={`tl-c${on && f === cf ? " now" : ""}`} onClick={() => E.clickTimeline(f)} />)}
            </>}
            {bones.map((b) => {
              const keys = an.keys[b.id] ?? [];
              const sel = b.id === E.ed.selBone;
              return [
                <button key={`n${b.id}`} className={`tl-name${sel ? " on" : ""}`} style={{ paddingLeft: 6 + E.boneDepth(a.rig.bones, b) * 10 }} onClick={() => E.clickTimeline(null, b.id)}>
                  <span className="dot" style={{ background: E.boneColor(a, b.id) }} />{b.name}
                </button>,
                ...Array.from({ length: F }, (_, f) => {
                  const k = keys.find((q) => q.f === f);
                  return (
                    <div key={`${b.id}-${f}`} className={`tl-c${on && f === cf ? " now" : ""}${sel ? " sel" : ""}`} onClick={() => E.clickTimeline(f, b.id)}>
                      {k && <span className={`key${k.ease === "step" ? " step" : ""}`} title={`Key · ${k.ease}`} />}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>

        <div className="tl-side">
          <Preview display={props.display} fps={an.fps} loop={an.loop} />
          <div className="tl-actions">
            <Button onClick={() => E.keySelected()} title="Key the selected bone on this frame (K)">Key bone</Button>
            <Button onClick={() => E.keyAll()}>Key all</Button>
            <Button onClick={() => E.deleteKeys()} title="Delete keys on this frame (Shift+K)">Delete key</Button>
            <Button onClick={() => E.copyPose()}>Copy pose</Button>
            <Button onClick={() => E.pastePose()}>Paste pose</Button>
            <Button onClick={() => E.resetPose()}>Reset bone</Button>
          </div>
        </div>

        <div className="tl-side wide">
          {pose ? (
            <div className="pose">
              <div className="small"><b>{pose.bone}</b> at frame {pose.frame + 1}{pose.keyed ? " (key)" : ""}</div>
              <div className="pose-fields">
                {([["rot", "Rotate °", 1], ["x", "Move x", 0.25], ["y", "Move y", 0.25], ["sx", "Scale x", 0.05], ["sy", "Scale y", 0.05]] as const).map(([ch, label, step]) => (
                  <label key={ch}>{label}<input className="forge-input num" type="number" step={step} key={`${ch}${pose.frame}${pose.bone}${pose[ch]}`} defaultValue={+pose[ch].toFixed(2)}
                    onBlur={(e) => +e.target.value !== +pose[ch].toFixed(2) && E.setPoseChannel(ch, +e.target.value)} /></label>
                ))}
                <label>Ease to next<select className="forge-input" value={pose.ease} disabled={!pose.keyed} onChange={(e) => E.setEase(e.target.value)}>{EASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              </div>
            </div>
          ) : <p className="hint">Select a bone to see and type its pose on this frame.</p>}
          <div className="row-wrap">
            <select className="forge-input" aria-label="Preset animation" value={preset} onChange={(e) => setPreset(e.target.value)}>
              {E.PRESET_ORDER.map((k) => <option key={k} value={k}>{E.PRESET_ANIMS[k].label}</option>)}
            </select>
            <Button onClick={() => E.addPresetAnim(preset)}>Add preset</Button>
            <Button onClick={() => E.addAllPresets()} title="idle, walk, run, attack, cast, jump, hit, death and victory">Add all 9</Button>
            {(an as { preset?: string }).preset && <Button variant="ghost" onClick={() => E.rebuildPreset()}>Rebuild preset</Button>}
          </div>
          <div className="row-wrap">
            <select className="forge-input" aria-label="Quick motion" value={quick} onChange={(e) => setQuick(e.target.value)}>
              {Object.entries(E.QUICK).map(([k, q]) => <option key={k} value={k}>{q.label}</option>)}
            </select>
            <Button onClick={() => E.applyQuick(quick)} title="Writes editable keys for the selected bone">Add to bone</Button>
          </div>
          <div className="row-wrap">
            <select className="forge-input" aria-label="Copy to sketch" disabled={!others.length} value={copyTo ?? others[0]?.id ?? ""} onChange={(e) => setCopyTo(+e.target.value)}>
              {others.length ? others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>) : <option value="">No other sketches</option>}
            </select>
            <Button disabled={!others.length} onClick={() => E.copyAnimTo(copyTo ?? others[0].id)} title="Copies this animation to a sketch whose bones share names">Copy to sketch</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Loops the current animation in a small box, at its own speed. */
function Preview(props: { display: Display | null; fps: number; loop: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frames = props.display?.frames;
  const N = props.display?.N ?? 32;
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !frames?.length) return;
    const z = Math.max(1, Math.floor(112 / N));
    const imgs = frames.map((f) => { const c = document.createElement("canvas"); E.drawIdx(c, f, N, z, false); return c; });
    cv.width = N * z; cv.height = N * z;
    const g = cv.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    let raf = 0, last = -1;
    const n = imgs.length, hold = Math.max(2, (props.fps / 2) | 0);
    const loop = (ts: number) => {
      const step = Math.floor((ts * props.fps) / 1000);
      const f = props.loop ? step % n : Math.min(n - 1, step % (n + hold));
      if (f !== last) { last = f; g.clearRect(0, 0, cv.width, cv.height); g.drawImage(imgs[f], 0, 0); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, N, props.fps, props.loop]);
  return <div className="preview-box checker"><canvas ref={ref} className="pixel" aria-label="Animation preview" /></div>;
}
