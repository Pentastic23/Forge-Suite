/**
 * forge-app.json: the file every Forge app ships next to its executable.
 * Forge Hub finds apps by scanning for these files; no app is hardcoded.
 */
export type ReleaseChannel = "stable" | "beta" | "experimental";

export interface AppManifest {
  /** Stable id, lowercase letters, digits and dashes, e.g. "balance-forge". */
  id: string;
  name: string;
  /** Semantic version, e.g. "0.1.0". */
  version: string;
  /** Executable file name, relative to the manifest's folder. */
  executable: string;
  description?: string;
  category?: string;
  /** Icon file, relative to the manifest's folder. */
  icon?: string;
  tags?: string[];
  /** File extensions this app can open, e.g. [".forgecodex"]. */
  opens?: string[];
  /** Where updates come from, e.g. a GitHub releases URL. */
  updateSource?: string;
  channel?: ReleaseChannel;
  /** Accent colour for this app's card, e.g. "#0197F5". */
  accent?: string;
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const CHANNELS: ReleaseChannel[] = ["stable", "beta", "experimental"];

export type ManifestResult =
  | { ok: true; manifest: AppManifest }
  | { ok: false; errors: string[] };

/** Checks a parsed forge-app.json and lists every problem found. */
export function validateManifest(value: unknown): ManifestResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["manifest must be a JSON object"] };
  }
  const m = value as Record<string, unknown>;
  const str = (k: string, required: boolean) => {
    const v = m[k];
    if (v === undefined) {
      if (required) errors.push(`"${k}" is required`);
      return;
    }
    if (typeof v !== "string" || v.trim() === "") errors.push(`"${k}" must be a non-empty string`);
  };
  str("id", true);
  str("name", true);
  str("version", true);
  str("executable", true);
  for (const k of ["description", "category", "icon", "updateSource", "accent"]) str(k, false);

  if (typeof m.id === "string" && !ID_RE.test(m.id)) errors.push(`"id" must use lowercase letters, digits and dashes`);
  if (typeof m.version === "string" && !SEMVER_RE.test(m.version)) errors.push(`"version" must look like 1.2.3`);
  if (typeof m.executable === "string" && (m.executable.includes("..") || /^([a-zA-Z]:|[\\/])/.test(m.executable))) {
    errors.push(`"executable" must be a file inside the app folder`);
  }
  for (const k of ["tags", "opens"]) {
    const v = m[k];
    if (v !== undefined && !(Array.isArray(v) && v.every((x) => typeof x === "string"))) {
      errors.push(`"${k}" must be a list of strings`);
    }
  }
  if (m.channel !== undefined && !CHANNELS.includes(m.channel as ReleaseChannel)) {
    errors.push(`"channel" must be one of ${CHANNELS.join(", ")}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as AppManifest };
}
