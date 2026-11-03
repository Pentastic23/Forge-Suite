import { Channel, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { suiteCommand } from "@forge/ui";

/** Calls a command of this app (through its plugin when inside Forge Suite mobile). */
const invoke = <T>(cmd: string, args?: InvokeArgs) => tauriInvoke<T>(suiteCommand(cmd), args);

export interface ProjectInfo { id: string; name: string; createdAt: number }
export interface CurrentProject { path: string; info: ProjectInfo }
export interface ProjectFile { path: string; name: string; modified: number }
export interface Event { at: number; action: string; detail: string }

export type Mode = "general" | "code" | "design" | "writing" | "art" | "model3d" | "review";
export interface Chat { id: number; title: string; mode: Mode; pinned: boolean; createdAt: number; updatedAt: number; messages: number }
export interface Message { id: number; role: "user" | "assistant"; content: string; model: string; createdAt: number }
export type Provider = "anthropic" | "openai" | "local";
export interface ChatRequest { provider: Provider; model: string; url: string; system: string; effort: string }
export interface Sent { question: Message | null; answer: Message; note: string | null; mock: boolean }

export interface KeyStatus { anthropic: boolean; openai: boolean; meshy: boolean }
export type Service = keyof KeyStatus;

export interface Asset {
  id: number; kind: "image" | "model"; name: string; prompt: string; source: string; mime: string; size: number;
  folder: string; tags: string[]; favorite: boolean; createdAt: number;
}
export interface AssetPatch { name?: string; folder?: string; tags?: string[]; favorite?: boolean }
export interface FileData { mime: string; data: string }

export interface OpenAIImageRequest { prompt: string; size: string; quality: string; model: string; transparent: boolean }
export interface ComfyImageRequest {
  url: string; prompt: string; negative: string; checkpoint: string; width: number; height: number;
  steps: number; cfg: number; seed: number; workflow: unknown | null;
}
export interface ComfyInfo { url: string; checkpoints: string[] }

export type MeshKind = "text" | "refine" | "image";
export interface MeshRequest { kind: MeshKind; prompt: string; previewId: string; image: string; artStyle: string; topology: string; polycount: number; pbr: boolean }
export interface MeshStatus { status: string; progress: number; error: string | null }

export interface CodexEntry { kind: string; name: string; summary: string }
export interface Codex { project: string; entries: CodexEntry[] }

export const api = {
  launchStatus: () => invoke<string | null>("launch_status"),
  projectsList: () => invoke<ProjectFile[]>("projects_list"),
  projectsFolder: () => invoke<string>("projects_folder"),
  projectCreate: (name: string) => invoke<CurrentProject>("project_create", { name }),
  projectOpen: (path: string) => invoke<CurrentProject>("project_open", { path }),
  projectExample: () => invoke<CurrentProject>("project_example"),
  projectClose: () => invoke<void>("project_close"),
  projectCurrent: () => invoke<CurrentProject | null>("project_current"),
  projectRename: (name: string) => invoke<ProjectInfo>("project_rename", { name }),
  setting: <T>(key: string) => invoke<T | null>("setting_get", { key }),
  setSetting: (key: string, value: unknown) => invoke<void>("setting_set", { key, value }),
  activity: (limit: number) => invoke<Event[]>("activity", { limit }),

  chats: () => invoke<Chat[]>("chats_list"),
  chatCreate: (title: string, mode: Mode) => invoke<Chat>("chat_create", { title, mode }),
  chatUpdate: (id: number, patch: { title?: string; mode?: Mode; pinned?: boolean }) =>
    invoke<Chat>("chat_update", { id, title: patch.title ?? null, mode: patch.mode ?? null, pinned: patch.pinned ?? null }),
  chatDelete: (id: number) => invoke<void>("chat_delete", { id }),
  messages: (id: number) => invoke<Message[]>("chat_messages", { id }),
  chatTruncate: (id: number, from: number) => invoke<number>("chat_truncate", { id, from }),
  /** Sends `text` (or, when empty, the chat as it is) and streams the answer to `onText`. */
  chatSend: (id: number, text: string, req: ChatRequest, onText: (t: string) => void) => {
    const ch = new Channel<string>();
    ch.onmessage = onText;
    return invoke<Sent>("chat_send", { id, text, req, onText: ch });
  },
  chatStop: () => invoke<void>("chat_stop"),
  askOnce: (text: string, req: ChatRequest) => invoke<string>("ask_once", { text, req }),
  localModels: (url: string) => invoke<string[]>("local_models", { url }),

  keys: () => invoke<KeyStatus>("keys_status"),
  keySet: (service: Service, key: string) => invoke<void>("key_set", { service, key }),
  keyClear: (service: Service) => invoke<void>("key_clear", { service }),

  imageOpenAI: (req: OpenAIImageRequest, name: string) => invoke<Asset>("image_openai", { req, name }),
  imageComfy: (req: ComfyImageRequest, name: string) => invoke<Asset>("image_comfy", { req, name }),
  comfyInfo: (url: string) => invoke<ComfyInfo>("comfy_info", { url }),
  comfyInterrupt: (url: string) => invoke<void>("comfy_interrupt", { url }),

  meshStart: (req: MeshRequest) => invoke<string>("mesh_start", { req }),
  meshStatus: (kind: MeshKind, id: string) => invoke<MeshStatus>("mesh_status", { kind, id }),
  meshKeep: (kind: MeshKind, id: string, name: string, prompt: string) => invoke<Asset>("mesh_keep", { kind, id, name, prompt }),

  assets: () => invoke<Asset[]>("assets_list"),
  assetData: (id: number) => invoke<FileData>("asset_data", { id }),
  assetThumb: (id: number) => invoke<FileData | null>("asset_thumb", { id }),
  assetSetThumb: (id: number, png: string) => invoke<void>("asset_set_thumb", { id, png }),
  assetsUpdate: (ids: number[], patch: AssetPatch) => invoke<number>("assets_update", { ids, patch }),
  assetDelete: (id: number) => invoke<void>("asset_delete", { id }),
  assetImport: (path: string) => invoke<Asset>("asset_import", { path }),

  exportAsset: (id: number, path: string) => invoke<void>("export_asset", { id, path }),
  exportText: (path: string, text: string) => invoke<void>("export_text", { path, text }),
  readImage: (path: string) => invoke<string>("read_image", { path }),
  codexImport: (path: string) => invoke<Codex>("codex_import", { path }),
  codexClear: () => invoke<void>("codex_clear"),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
export const dataUrl = (f: FileData) => `data:${f.mime};base64,${f.data}`;
export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
