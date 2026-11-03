// 3D model tasks on Meshy. They take minutes, so they are watched here, outside
// any page, and saved in the project: leaving the page, or closing AI Forge, and
// coming back picks up where they were (Meshy keeps working either way).
import { useSyncExternalStore } from "react";
import { api, errorText, type MeshKind, type MeshRequest } from "./api";

export interface Job {
  taskId: string;
  kind: MeshKind;
  name: string;
  prompt: string;
  status: string;
  progress: number;
  error: string | null;
  /** The library item once it is downloaded. */
  assetId: number | null;
  startedAt: number;
}

const ACTIVE = ["PENDING", "IN_PROGRESS"];
export const isActive = (j: Job) => ACTIVE.includes(j.status) || (j.status === "SUCCEEDED" && j.assetId === null && !j.error);

let jobs: Job[] = [];
let loadedFor: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let onDone: ((j: Job) => void) | null = null;
let onError: ((msg: string) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useJobs(): Job[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => jobs);
}

/** Called by the 3D page so finished models can be announced and shown. */
export function watchJobs(done: (j: Job) => void, error: (msg: string) => void) {
  onDone = done;
  onError = error;
}

function cleanJob(v: unknown): Job | null {
  const j = v as Partial<Job>;
  if (!j || typeof j.taskId !== "string" || !["text", "refine", "image"].includes(j.kind as string)) return null;
  return {
    taskId: j.taskId, kind: j.kind as MeshKind, name: String(j.name ?? ""), prompt: String(j.prompt ?? ""), status: String(j.status ?? "PENDING"),
    progress: Number(j.progress) || 0, error: j.error ? String(j.error) : null, assetId: typeof j.assetId === "number" ? j.assetId : null, startedAt: Number(j.startedAt) || Date.now(),
  };
}

export async function loadJobs(projectPath: string) {
  if (loadedFor === projectPath) return;
  loadedFor = projectPath;
  const saved = await api.setting<unknown[]>("meshJobs").catch(() => null);
  jobs = Array.isArray(saved) ? saved.map(cleanJob).filter((j): j is Job => !!j) : [];
  emit();
  ensurePolling();
}

/** Forgets everything when another project opens. */
export function resetJobs() {
  jobs = [];
  loadedFor = null;
  if (timer) clearInterval(timer);
  timer = null;
  emit();
}

function persist() {
  // keep every unfinished task and the last few finished ones
  const keep = [...jobs.filter(isActive), ...jobs.filter((j) => !isActive(j)).slice(0, 12)];
  void api.setSetting("meshJobs", keep).catch(() => undefined);
}

function update(taskId: string, patch: Partial<Job>) {
  jobs = jobs.map((j) => (j.taskId === taskId ? { ...j, ...patch } : j));
  emit();
}

export async function startJob(req: MeshRequest, name: string): Promise<Job> {
  const taskId = await api.meshStart(req);
  const job: Job = { taskId, kind: req.kind, name, prompt: req.prompt, status: "PENDING", progress: 0, error: null, assetId: null, startedAt: Date.now() };
  jobs = [job, ...jobs];
  emit();
  persist();
  ensurePolling();
  return job;
}

export function dismissJob(taskId: string) {
  jobs = jobs.filter((j) => j.taskId !== taskId);
  emit();
  persist();
}

function ensurePolling() {
  if (timer || !jobs.some(isActive)) return;
  void tick();
  timer = setInterval(() => void tick(), 4000);
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const j of jobs.filter(isActive)) {
      try {
        if (j.status !== "SUCCEEDED") {
          const s = await api.meshStatus(j.kind, j.taskId);
          update(j.taskId, { status: s.status, progress: s.progress, error: s.error });
          if (s.status !== "SUCCEEDED") {
            if (s.error) { onError?.(s.error); persist(); }
            continue;
          }
        }
        const asset = await api.meshKeep(j.kind, j.taskId, j.name, j.prompt);
        update(j.taskId, { status: "SUCCEEDED", progress: 100, assetId: asset.id });
        persist();
        onDone?.(jobs.find((x) => x.taskId === j.taskId)!);
      } catch (e) {
        // a network hiccup: try again on the next tick, but say what happened once it keeps failing
        const msg = errorText(e);
        if (/API key|credits|isn't a Meshy task|isn't a GLB|https/.test(msg)) {
          update(j.taskId, { error: msg, status: "FAILED" });
          persist();
          onError?.(msg);
        }
      }
    }
  } finally {
    ticking = false;
    if (!jobs.some(isActive) && timer) { clearInterval(timer); timer = null; }
  }
}
