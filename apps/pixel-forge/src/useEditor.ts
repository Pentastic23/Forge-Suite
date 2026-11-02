import { useSyncExternalStore } from "react";
import { getVersion, subscribe } from "./engine/editor";

/** Re-renders the component whenever the editor state changes. */
export function useEditor(): number {
  return useSyncExternalStore(subscribe, getVersion);
}
