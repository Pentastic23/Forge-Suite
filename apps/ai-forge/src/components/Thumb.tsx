import { useEffect, useState } from "react";
import { api, dataUrl, type Asset } from "../api";

const cache = new Map<number, string | null>();

/** A library item's preview picture, loaded once and kept for the session. */
export function useThumb(id: number | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(id === undefined ? undefined : cache.get(id));
  useEffect(() => {
    if (id === undefined) return;
    if (cache.has(id)) { setUrl(cache.get(id)); return; }
    let live = true;
    api.assetThumb(id).then((f) => {
      const u = f ? dataUrl(f) : null;
      cache.set(id, u);
      if (live) setUrl(u);
    }).catch(() => live && setUrl(null));
    return () => { live = false; };
  }, [id]);
  return url;
}

export function forgetThumb(id: number) {
  cache.delete(id);
}

export function Thumb(props: { asset: Asset; size?: number }) {
  const url = useThumb(props.asset.id);
  const s = props.size ?? 160;
  return (
    <div className="thumb checker" style={{ width: s, height: s }}>
      {url ? <img src={url} alt="" /> : <span className="muted small">{url === null ? (props.asset.kind === "model" ? "3D" : "No preview") : "…"}</span>}
      {props.asset.kind === "model" && <span className="thumb-badge">3D</span>}
    </div>
  );
}
