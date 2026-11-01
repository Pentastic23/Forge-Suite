import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * State saved in the project file (like a simulation setup), so it is there
 * next time the project opens. `ready` is false until the saved value loads.
 */
export function usePersisted<T>(key: string, initial: () => T): [T, (v: T | ((old: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const loadedKey = useRef<string>();
  const init = useRef(initial);
  init.current = initial;

  useEffect(() => {
    let live = true;
    setReady(false);
    api.setting<T>(key).then(
      (v) => { if (!live) return; setValue(v ?? init.current()); loadedKey.current = key; setReady(true); },
      () => { if (!live) return; setValue(init.current()); loadedKey.current = key; setReady(true); },
    );
    return () => { live = false; };
  }, [key]);

  useEffect(() => {
    if (!ready || loadedKey.current !== key) return;
    const t = setTimeout(() => void api.setSetting(key, value).catch(() => undefined), 600);
    return () => clearTimeout(t);
  }, [key, value, ready]);

  return [value, setValue, ready];
}
