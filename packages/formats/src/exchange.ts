/**
 * Exchange files (.forgecodex, .forgebalance, .forgeasset) are zip files with
 * a manifest.json at the root. They are how Forge apps pass work to each other
 * without depending on each other.
 */
export const EXCHANGE_FORMAT_VERSION = 1;

export type ExchangeKind = "codex" | "balance" | "asset";

export const EXCHANGE_EXTENSIONS: Record<ExchangeKind, string> = {
  codex: ".forgecodex",
  balance: ".forgebalance",
  asset: ".forgeasset",
};

export interface ExchangeManifest {
  formatVersion: number;
  kind: ExchangeKind;
  /** App id that wrote the file, e.g. "forge-core". */
  sourceApp: string;
  sourceAppVersion: string;
  /** ISO 8601 time the file was written. */
  createdAt: string;
  /** Project the data came from, so imports can be matched up later. */
  project: { id: string; name: string };
  /** Entity ids included, shared across apps (Forge Core ids are the source of truth). */
  entityIds: string[];
}

export function exchangeKindForFile(fileName: string): ExchangeKind | undefined {
  const lower = fileName.toLowerCase();
  return (Object.keys(EXCHANGE_EXTENSIONS) as ExchangeKind[]).find((k) => lower.endsWith(EXCHANGE_EXTENSIONS[k]));
}
