import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AppManifest } from "@forge/formats";

export type AppHealth = "ready" | "missingExecutable";

export interface InstalledApp {
  manifest: AppManifest;
  folder: string;
  executablePath: string;
  iconPath: string | null;
  health: AppHealth;
}

export interface ScanResult {
  apps: InstalledApp[];
  problems: { path: string; errors: string[] }[];
}

export interface Settings {
  appFolders: string[];
  closeOnLaunch: boolean;
  checkUpdatesOnStart: boolean;
  logRetentionDays: number;
}

export interface ProjectsFolder {
  path: string;
  source: "env" | "setting" | "default";
  defaultPath: string;
  inOnedrive: boolean;
  leftInDefault: number;
}

export type Level = "info" | "warn" | "error";

export interface LogEntry {
  time: number;
  level: Level;
  source: string;
  message: string;
}

export const api = {
  listApps: () => invoke<ScanResult>("list_apps"),
  recentApps: () => invoke<Record<string, number>>("recent_apps"),
  launchApp: (id: string, args?: string[]) => invoke<number>("launch_app", { id, args }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  readLogs: (limit?: number) => invoke<LogEntry[]>("read_logs", { limit }),
  hubPaths: () => invoke<Record<"data" | "defaultApps" | "launchKeys", string>>("hub_paths"),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),
  projectsFolder: () => invoke<ProjectsFolder>("projects_folder"),
  setProjectsFolder: (path: string | null) => invoke<ProjectsFolder>("set_projects_folder", { path }),
};

export function iconUrl(app: InstalledApp): string | undefined {
  return app.iconPath ? convertFileSrc(app.iconPath) : undefined;
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
