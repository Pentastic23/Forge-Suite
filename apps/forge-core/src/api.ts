import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { suiteCommand } from "@forge/ui";
import type { Kind } from "./modules";

/** Calls a command of this app (through its plugin when inside Forge Suite mobile). */
const invoke = <T>(cmd: string, args?: InvokeArgs) => tauriInvoke<T>(suiteCommand(cmd), args);

export interface Link { toId: string; relation: string }

export interface Entity {
  id: string;
  kind: Kind;
  name: string;
  entityType: string;
  status: string;
  author: string;
  summary: string;
  body: string;
  fields: Record<string, unknown>;
  tags: string[];
  links: Link[];
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface EntitySummary {
  id: string;
  kind: Kind;
  name: string;
  entityType: string;
  status: string;
  summary: string;
  tags: string[];
  fields: Record<string, unknown>;
  updatedAt: number;
}

export interface ProjectInfo { id: string; name: string; createdAt: number }
export interface CurrentProject { path: string; info: ProjectInfo }
export interface ProjectFile { path: string; name: string; modified: number }
export interface Backlink { fromId: string; fromName: string; fromKind: Kind; relation: string }
export interface VersionInfo { version: number; savedAt: number; name: string }
export interface ListQuery { kind?: string; text?: string; tag?: string; status?: string; entityType?: string; limit?: number }
export type ExportFormat = "json" | "csv" | "markdown" | "codex";

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
  list: (query: ListQuery) => invoke<EntitySummary[]>("entity_list", { query }),
  get: (id: string) => invoke<Entity>("entity_get", { id }),
  names: (ids: string[]) => invoke<Record<string, [string, Kind]>>("entity_names", { ids }),
  save: (entity: Entity) => invoke<Entity>("entity_save", { entity }),
  remove: (id: string) => invoke<void>("entity_delete", { id }),
  backlinks: (id: string) => invoke<Backlink[]>("entity_backlinks", { id }),
  versions: (id: string) => invoke<VersionInfo[]>("entity_versions", { id }),
  version: (id: string, version: number) => invoke<Entity>("entity_version", { id, version }),
  restore: (id: string, version: number) => invoke<Entity>("entity_restore", { id, version }),
  tags: () => invoke<[string, number][]>("project_tags"),
  counts: () => invoke<Record<string, number>>("project_counts"),
  exportTo: (format: ExportFormat, kinds: string[], path: string) => invoke<number>("project_export", { format, kinds, path }),
  importFrom: (path: string) => invoke<[number, number]>("project_import", { path }),
};

export function blankEntity(kind: Kind): Entity {
  return { id: "", kind, name: "", entityType: "", status: "Draft", author: "", summary: "", body: "", fields: {}, tags: [], links: [], createdAt: 0, updatedAt: 0, version: 0 };
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
