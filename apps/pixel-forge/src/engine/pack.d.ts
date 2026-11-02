import type { Asset } from "./core";
export interface OutFile { path: string; data: string }
export class Pack { file(path: string, data: HTMLCanvasElement | string): void; readonly size: number; toFiles(): OutFile[] }
export const EXPORT_FORMATS: Record<string, string>;
export function textB64(s: string): string;
export function buildPack(opts?: { sketches?: Asset[]; profileName?: string }): Promise<{ zip: Pack; spineNotes: string[] }>;
export function spriteCanvas(a: Asset, N: number): HTMLCanvasElement;
