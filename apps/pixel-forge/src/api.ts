import { invoke } from "@tauri-apps/api/core";
import type { OutFile } from "./engine/pack";

export interface ProjectInfo { id: string; name: string; createdAt: number }
export interface CurrentProject { path: string; info: ProjectInfo }
export interface ProjectFile { path: string; name: string; modified: number }
export interface Event { at: number; action: string; detail: string }
export interface Profile { name: string; data: unknown; updatedAt: number }

/** A sketch as the project stores it: the source image (base64 PNG) and the editing document. */
export interface SketchRow {
  id: number;
  name: string;
  png: string;
  doc: unknown;
  /** The AI-colored version (base64 PNG), when one was made. */
  aiPng?: string | null;
  folder: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}
export type AIQuality = "low" | "medium" | "high";
export interface AIColorRequest { png: string; prompt: string; size: string; quality: AIQuality; model: string }
export interface AIColorResult { png: string; mock: boolean }
export interface LibraryPatch { folder?: string; tags?: string[]; favorite?: boolean }

export const api = {
  launchStatus: () => invoke<string | null>("launch_status"),
  projectsList: () => invoke<ProjectFile[]>("projects_list"),
  projectsFolder: () => invoke<string>("projects_folder"),
  projectCreate: (name: string) => invoke<CurrentProject>("project_create", { name }),
  projectOpen: (path: string) => invoke<CurrentProject>("project_open", { path }),
  projectClose: () => invoke<void>("project_close"),
  projectCurrent: () => invoke<CurrentProject | null>("project_current"),
  projectRename: (name: string) => invoke<ProjectInfo>("project_rename", { name }),
  setting: <T>(key: string) => invoke<T | null>("setting_get", { key }),
  setSetting: (key: string, value: unknown) => invoke<void>("setting_set", { key, value }),
  activity: (limit: number) => invoke<Event[]>("activity", { limit }),

  sketches: () => invoke<SketchRow[]>("sketches_list"),
  addSketch: (sketch: { name: string; folder: string; png: string; doc: unknown }) => invoke<number>("sketch_add", { sketch }),
  saveSketch: (id: number, name: string, doc: unknown, png?: string) => invoke<void>("sketch_save", { id, name, doc, png: png ?? null }),
  deleteSketch: (id: number) => invoke<void>("sketch_delete", { id }),
  duplicateSketch: (id: number, name: string) => invoke<number>("sketch_duplicate", { id, name }),
  reorder: (ids: number[]) => invoke<void>("sketches_reorder", { ids }),
  updateLibrary: (ids: number[], patch: LibraryPatch) => invoke<number>("library_update", { ids, patch }),
  folders: () => invoke<string[]>("library_folders"),

  profiles: () => invoke<Profile[]>("profiles_list"),
  saveProfile: (name: string, data: unknown) => invoke<void>("profile_save", { name, data }),
  deleteProfile: (name: string) => invoke<void>("profile_delete", { name }),

  exportWrite: (path: string, files: OutFile[], summary: string) => invoke<number>("export_write", { path, files, summary }),
  exportFile: (path: string, data: string) => invoke<void>("export_file", { path, data }),
  readText: (path: string) => invoke<string>("read_text", { path }),
  readImage: (path: string) => invoke<string>("read_image", { path }),

  aiHasKey: () => invoke<boolean>("ai_has_key"),
  aiSetKey: (key: string) => invoke<void>("ai_set_key", { key }),
  aiClearKey: () => invoke<void>("ai_clear_key"),
  aiColor: (id: number, req: AIColorRequest) => invoke<AIColorResult>("ai_color", { id, req }),
  aiImageSet: (id: number, png: string | null) => invoke<void>("ai_image_set", { id, png }),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Image types the sketch importer reads. */
export const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
export const mimeOf = (path: string) => {
  const e = path.split(".").pop()?.toLowerCase() ?? "";
  return e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "svg" ? "image/svg+xml" : `image/${e}`;
};
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
