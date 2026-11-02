import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { suiteCommand } from "@forge/ui";

/** Calls a command of this app (through its plugin when inside Forge Suite mobile). */
const invoke = <T>(cmd: string, args?: InvokeArgs) => tauriInvoke<T>(suiteCommand(cmd), args);

export type ColumnKind = "number" | "text" | "formula";

export interface Column {
  key: string;
  name: string;
  kind: ColumnKind;
  formula?: string | null;
  decimals?: number | null;
}

export interface Row {
  id: string;
  sourceId?: string | null;
  name: string;
  values: Record<string, number | string | null>;
}

export interface Sheet {
  id: string;
  name: string;
  sourceKind?: string | null;
  columns: Column[];
  rows: Row[];
  updatedAt: number;
}

export interface Computed {
  numbers: Record<string, Record<string, number>>;
  cellErrors: Record<string, Record<string, string>>;
  columnErrors: Record<string, string>;
}

export interface SheetInfo { id: string; name: string; rows: number; sourceKind?: string | null; updatedAt: number }
export interface ProjectInfo { id: string; name: string; createdAt: number }
export interface CurrentProject { path: string; info: ProjectInfo }
export interface ProjectFile { path: string; name: string; modified: number }
export interface SnapshotInfo { id: string; sheetId: string; name: string; createdAt: number }
export interface ImportSummary { sheet: Sheet; added: number; updated: number; newColumns: string[] }

export interface Change {
  rowId: string;
  rowName: string;
  column: string;
  columnName: string;
  before: string | null;
  after: string | null;
  percent: number | null;
  derived: boolean;
}
export interface Diff { changes: Change[]; added: string[]; removed: string[]; notes: string }

export type ArmorModel = "flat" | "percent";
export interface Fighter {
  name: string;
  health: number;
  damage: number;
  attackSpeed: number;
  armor: number;
  critChance: number;
  critMultiplier: number;
  hitChance: number;
}
export interface CombatRules { armorModel: ArmorModel; armorConstant: number; damageVariance: number; maxTime: number }
export interface DuelResult {
  runs: number;
  winsA: number;
  winsB: number;
  draws: number;
  timeouts: number;
  avgTime: number;
  timeP10: number;
  timeP50: number;
  timeP90: number;
  avgHealthLeftA: number;
  avgHealthLeftB: number;
}
export interface RoundRobinResult { names: string[]; winRate: number[][]; overall: number[]; runsPerPair: number }

export interface Income { name: string; min: number; max: number; chance: number }
export interface Spend { name: string; cost: number; every: number; repeat: boolean }
export interface EconomyConfig { players: number; steps: number; startBalance: number; incomes: Income[]; spends: Spend[] }
export interface SpendResult { name: string; reached: number; medianFirstStep: number | null; avgPurchases: number; missRate: number }
export interface EconomyResult {
  steps: number[];
  p10: number[];
  p50: number[];
  p90: number[];
  spends: SpendResult[];
  avgIncomePerStep: number;
  avgSpendPerStep: number;
  warnings: string[];
}
export interface Seeded<T> { seed: number; result: T }

export const MAX_RUNS = 100_000;

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

  sheets: () => invoke<SheetInfo[]>("sheet_list"),
  sheet: (id: string) => invoke<Sheet>("sheet_get", { id }),
  saveSheet: (sheet: Sheet) => invoke<Sheet>("sheet_save", { sheet }),
  deleteSheet: (id: string) => invoke<void>("sheet_delete", { id }),
  compute: (sheet: Sheet) => invoke<Computed>("sheet_compute", { sheet }),
  checkFormula: (formula: string) => invoke<string[]>("formula_check", { formula }),

  codexKinds: (path: string) => invoke<Record<string, number>>("codex_kinds", { path }),
  codexImport: (path: string, kind: string, sheetId?: string) => invoke<ImportSummary>("codex_import", { path, kind, sheetId: sheetId ?? null }),
  exportBalance: (path: string) => invoke<number>("export_balance", { path }),
  exportCsv: (sheetId: string, path: string) => invoke<number>("export_csv", { sheetId, path }),

  snapshot: (sheetId: string, name: string) => invoke<SnapshotInfo>("snapshot_create", { sheetId, name }),
  snapshots: (sheetId: string) => invoke<SnapshotInfo[]>("snapshot_list", { sheetId }),
  deleteSnapshot: (id: string) => invoke<void>("snapshot_delete", { id }),
  diff: (sheetId: string, before: string, after: string | null, title: string) => invoke<Diff>("patch_diff", { sheetId, before, after, title }),
  saveNotes: (path: string, text: string) => invoke<void>("notes_save", { path, text }),

  setting: <T>(key: string) => invoke<T | null>("setting_get", { key }),
  setSetting: (key: string, value: unknown) => invoke<void>("setting_set", { key, value }),

  duel: (a: Fighter, b: Fighter, rules: CombatRules, runs: number, seed?: number) =>
    invoke<Seeded<DuelResult>>("sim_duel", { a, b, rules, runs, seed: seed ?? null }),
  roundRobin: (fighters: Fighter[], rules: CombatRules, runs: number, seed?: number) =>
    invoke<Seeded<RoundRobinResult>>("sim_round_robin", { fighters, rules, runs, seed: seed ?? null }),
  economy: (config: EconomyConfig, seed?: number) => invoke<Seeded<EconomyResult>>("sim_economy", { config, seed: seed ?? null }),
};

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function blankSheet(name: string): Sheet {
  return {
    id: "",
    name,
    sourceKind: null,
    columns: [
      { key: "cost", name: "Cost", kind: "number" },
      { key: "health", name: "Health", kind: "number" },
      { key: "damage", name: "Damage", kind: "number" },
    ],
    rows: [],
    updatedAt: 0,
  };
}
