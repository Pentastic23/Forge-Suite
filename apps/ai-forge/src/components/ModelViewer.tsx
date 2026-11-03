import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { b64ToBytes } from "../api";

export interface ModelStats { meshes: number; triangles: number; materials: number }

/** Shows a GLB model you can turn and zoom. `glb` is base64. */
export function ModelViewer(props: { glb: string; onSnapshot?: (pngB64: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const snap = useRef<() => string>();
  const [error, setError] = useState("");
  const [stats, setStats] = useState<ModelStats>();
  const [wire, setWire] = useState(false);
  const wireRef = useRef<(on: boolean) => void>();

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setError("This PC's graphics can't show 3D here, but the model is fine to save and open elsewhere.");
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30284a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xa78bfa, 1.2);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    const resize = () => {
      const w = el.clientWidth || 400, h = el.clientHeight || 400;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const materials: THREE.Material[] = [];
    const bytes = b64ToBytes(props.glb);
    new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "", (gltf) => {
      const model = gltf.scene;
      let meshes = 0, triangles = 0;
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        const g = m.geometry;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!materials.includes(mat)) materials.push(mat);
      });
      setStats({ meshes, triangles: Math.round(triangles), materials: materials.length });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      scene.add(model);
      camera.near = size / 100;
      camera.far = size * 100;
      camera.position.set(size * 0.95, size * 0.65, size * 1.25);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    }, (e) => setError(`The model couldn't be read: ${e instanceof Error ? e.message : String(e)}`));

    wireRef.current = (on) => materials.forEach((m) => { (m as THREE.MeshStandardMaterial).wireframe = on; });
    snap.current = () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png").split(",")[1];
    };
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [props.glb]);

  return (
    <div className="model-viewer">
      <div ref={host} className="model-canvas" />
      {error && <p className="muted model-error">{error}</p>}
      <div className="model-bar">
        {stats && <span className="muted small">{stats.triangles.toLocaleString()} triangles · {stats.meshes} mesh{stats.meshes === 1 ? "" : "es"} · {stats.materials} material{stats.materials === 1 ? "" : "s"}</span>}
        <span className="spacer" />
        <button onClick={() => { setWire(!wire); wireRef.current?.(!wire); }}>{wire ? "Solid" : "Wireframe"}</button>
        {props.onSnapshot && <button onClick={() => snap.current && props.onSnapshot!(snap.current())}>Use this view as preview</button>}
      </div>
    </div>
  );
}
