import { convertFileSrc, invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { suiteCommand } from "@forge/ui";

/** Calls a command of this app (through its plugin when inside Forge Suite mobile). */
const invoke = <T>(cmd: string, args?: InvokeArgs) => tauriInvoke<T>(suiteCommand(cmd), args);

export interface ProjectInfo { id: string; name: string; createdAt: number }
export interface CurrentProject { path: string; info: ProjectInfo }
export interface ProjectFile { path: string; name: string; modified: number }
export interface Folder { id: string; path: string; addedAt: number; lastScan: number | null; assets: number; exists: boolean }

export interface AssetSummary {
  id: string;
  folderId: string;
  name: string;
  relPath: string;
  path: string;
  ext: string;
  fileType: string;
  category: string;
  status: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hash: string;
  missing: boolean;
  refs: number | null;
  mtime: number;
  tags: string[];
}

export interface Version { size: number; hash: string; width: number | null; height: number | null; mtime: number; recordedAt: number }
export interface HistoryEvent { at: number; action: string; detail: string }

export interface Asset extends AssetSummary {
  author: string;
  notes: string;
  license: string;
  source: string;
  categorySet: boolean;
  addedAt: number;
  updatedAt: number;
  autoTags: string[];
  versions: Version[];
  history: HistoryEvent[];
  duplicates: string[];
}

export interface AssetQuery {
  text?: string;
  category?: string;
  status?: string;
  fileType?: string;
  tag?: string;
  folderId?: string;
  missing?: boolean;
  ids?: string[];
  sort?: "name" | "newest" | "largest" | "category" | "path";
  limit?: number;
  offset?: number;
}
export interface Page { assets: AssetSummary[]; total: number }
export interface Facets {
  total: number;
  missing: number;
  categories: Record<string, number>;
  statuses: Record<string, number>;
  fileTypes: Record<string, number>;
  tags: [string, number][];
}
export interface AssetPatch {
  status?: string;
  category?: string;
  author?: string;
  notes?: string;
  license?: string;
  source?: string;
  addTags?: string[];
  removeTags?: string[];
}
export interface ScanReport { folders: number; total: number; added: number; changed: number; moved: number; missing: number; returned: number; errors: string[] }

export type Severity = "error" | "warning" | "info";
export interface Finding { check: string; severity: Severity; title: string; detail: string; assetIds: string[] }
export interface CheckSummary {
  assets: number;
  bytes: number;
  textureMemory: number;
  duplicateBytes: number;
  byCategory: Record<string, { count: number; bytes: number }>;
  usageKnown: boolean;
  unused: number;
}
export interface CheckReport { summary: CheckSummary; findings: Finding[] }
export type NamingRule = "none" | "snakeCase" | "kebabCase" | "pascalCase" | "camelCase";
export interface CheckSettings {
  naming: NamingRule;
  maxImagePx: number;
  maxImageMb: number;
  maxSfxMb: number;
  maxMusicMb: number;
  maxModelMb: number;
  powerOfTwo: boolean;
}
export interface UsageReport { filesRead: number; used: number; unused: number }

export interface Slot { name: string; assetId?: string | null }
export interface Requirement { id: string; sourceId?: string | null; group: string; name: string; slots: Slot[]; notes: string; createdAt: number; updatedAt: number }
export type SlotState = "missing" | "broken" | "wip" | "done";
export interface SlotView { name: string; state: SlotState; asset: AssetSummary | null; suggestions: AssetSummary[] }
export interface RequirementView { id: string; sourceId: string | null; group: string; name: string; notes: string; slots: SlotView[]; done: number; total: number }
export interface Readiness { requirements: RequirementView[]; groups: Record<string, [number, number]>; done: number; total: number }

export interface RenameSpec { pattern: string; case: NamingRule; find: string; replace: string; start: number; pad: number; lowerExt: boolean }
export interface RenamePlanned { id: string; from: string; to: string; problem: string | null }

export type ExportTarget = "folder" | "unity" | "godot" | "unreal";
export interface ExportSpec {
  target: ExportTarget;
  dest: string;
  scope: "selection" | "approved" | "all";
  ids: string[];
  layout: "category" | "source" | "flat";
  naming: NamingRule;
  scale: number;
  pixelArt: boolean;
  pixelsPerUnit: number;
  prefixes: boolean;
  overwrite: boolean;
  manifest: boolean;
}
export interface ExportPlanned { id: string; from: string; to: string; scaled: boolean }
export interface ExportReport { dest: string; assets: number; copied: number; unchanged: number; keptExisting: number; scaled: number; metaFiles: number; errors: string[] }

export const api = {
  launchStatus: () => invoke<string | null>("launch_status"),
  projectsList: () => invoke<ProjectFile[]>("projects_list"),
  projectsFolder: () => invoke<string>("projects_folder"),
  projectCreate: (name: string) => invoke<CurrentProject>("project_create", { name }),
  projectOpen: (path: string) => invoke<CurrentProject>("project_open", { path }),
  /** Opens the Emberfall example project, making it the first time. */
  projectExample: () => invoke<CurrentProject>("project_example"),
  projectClose: () => invoke<void>("project_close"),
  projectCurrent: () => invoke<CurrentProject | null>("project_current"),
  projectRename: (name: string) => invoke<ProjectInfo>("project_rename", { name }),
  setting: <T>(key: string) => invoke<T | null>("setting_get", { key }),
  setSetting: (key: string, value: unknown) => invoke<void>("setting_set", { key, value }),
  activity: (limit: number) => invoke<[string | null, HistoryEvent][]>("activity", { limit }),

  folders: () => invoke<Folder[]>("folders_list"),
  addFolder: (path: string) => invoke<Folder>("folder_add", { path }),
  removeFolder: (id: string) => invoke<void>("folder_remove", { id }),
  scan: () => invoke<ScanReport>("library_scan"),

  list: (query: AssetQuery) => invoke<Page>("assets_list", { query }),
  facets: () => invoke<Facets>("assets_facets"),
  get: (id: string) => invoke<Asset>("asset_get", { id }),
  update: (ids: string[], patch: AssetPatch) => invoke<number>("assets_update", { ids, patch }),
  forget: (ids: string[]) => invoke<number>("assets_forget", { ids }),
  categories: () => invoke<[string[], string[]]>("categories"),

  checks: () => invoke<CheckReport>("checks_run"),
  usageScan: (dir: string) => invoke<UsageReport>("usage_scan", { dir }),

  readiness: () => invoke<Readiness>("readiness"),
  saveRequirement: (requirement: Requirement) => invoke<Requirement>("requirement_save", { requirement }),
  deleteRequirement: (id: string) => invoke<void>("requirement_delete", { id }),
  link: (id: string, slot: string, assetId: string | null) => invoke<Requirement>("requirement_link", { id, slot, assetId }),
  slotTemplates: () => invoke<Record<string, string[]>>("slot_templates"),
  codexImport: (path: string) => invoke<[number, number]>("codex_import", { path }),

  renamePlan: (ids: string[], spec: RenameSpec) => invoke<RenamePlanned[]>("rename_plan", { ids, spec }),
  renameApply: (ids: string[], spec: RenameSpec) => invoke<number>("rename_apply", { ids, spec }),
  renameUndo: () => invoke<number>("rename_undo"),

  exportPreview: (spec: ExportSpec) => invoke<{ total: number; files: ExportPlanned[] }>("export_preview", { spec }),
  exportRun: (spec: ExportSpec) => invoke<ExportReport>("export_run", { spec }),
  exportExchange: (path: string) => invoke<number>("export_exchange", { path }),
};

export const STATUSES = ["Placeholder", "WIP", "Review", "Approved", "Final"];
export const CATEGORIES = ["Sprite", "Animation", "Tileset", "Icon", "UI", "Texture", "VFX", "SFX", "Music", "Model", "Shader", "Font", "Video", "Data", "Other"];

const PREVIEW_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico"]);
const PREVIEW_AUDIO = new Set(["wav", "ogg", "mp3", "flac", "m4a", "opus"]);
const PREVIEW_VIDEO = new Set(["mp4", "webm", "ogv"]);

export function previewKind(a: { ext: string; missing: boolean }): "image" | "audio" | "video" | null {
  if (a.missing) return null;
  const e = a.ext.toLowerCase();
  return PREVIEW_IMAGE.has(e) ? "image" : PREVIEW_AUDIO.has(e) ? "audio" : PREVIEW_VIDEO.has(e) ? "video" : null;
}

export function fileUrl(path: string): string {
  try { return convertFileSrc(path); } catch { return path; }
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

export function duration(ms: number): string {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

export function dims(a: { width: number | null; height: number | null }): string {
  return a.width && a.height ? `${a.width}×${a.height}` : "";
}
