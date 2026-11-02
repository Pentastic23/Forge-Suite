// Types for the conversion engine (core.js). The engine is plain JavaScript carried over from
// Sprite Foundry; these describe the parts the app uses.
export type Idx = Int16Array;
export type RGB = [number, number, number];
export interface Bone { id: number; name: string; parent: number | null; connected: boolean; hx: number; hy: number; tx: number; ty: number; z?: number }
export interface Key { f: number; rot: number; x: number; y: number; sx: number; sy: number; ease: string }
export interface Anim { id: number; name: string; frames: number; fps: number; loop: boolean; keys: Record<number, Key[]>; preset?: string }
export interface Mesh { grid: number; verts: [number, number][]; tris: number[][]; weights: Record<number, number>[]; painted?: boolean; layered?: boolean }
export interface Rig { bones: Bone[]; mesh: Mesh | null; labels?: Int32Array; snap?: boolean }
export interface Asset {
  id: number; name: string; sample?: boolean; src: ImageData;
  edits: Record<number, Map<number, string | null>>;
  fedits: Record<number, Record<number, Record<number, Map<number, string | null>>>>;
  erasePts: { x: number; y: number }[]; colorPts?: { x: number; y: number; hex: string }[];
  facing: "left" | "right"; rig: Rig; anims: Anim[]; curAnim: number; aiPrompt?: string;
  /** The AI-colored version, when one was made, and whether it is used instead of the sketch. */
  aiSrc?: ImageData | null; useAI?: boolean; aiVer?: number;
  pre?: { unpainted?: number; filledPaper?: boolean; d: Uint8ClampedArray; w: number; h: number };
}
export type Profile = { lines: "redraw" | "keep"; inner: boolean; colors: number; simplify: number; shade: string; olPos: "in" | "out" };
export type Settings = Record<string, any> & {
  profiles: Record<number, Profile>;
  exportSizes: Record<number, boolean>;
  exportFormats: Record<string, boolean>;
};

export const SIZES: number[];
export const STYLES: Record<string, { label: string } & Record<string, number | string>>;
export const DEFAULTS: Settings;
export const S: Settings;
export const P: { rgb: RGB[]; lab: number[][]; dark: number[]; light: number[]; mat: string[]; darkest: number; lightest: number; baseCount: number; ver: number };
export const assets: Asset[];
export const MATERIALS: Record<string, string>;
export const LR: number;
export function resetSettings(next?: Partial<Settings>): void;
export function newAsset(name: string, src: ImageData): Asset;
export function newAnim(name: string): Anim;
export function hex(c: RGB | number[]): string;
export function unhex(h: string): RGB;
export function oklab(r: number, g: number, b: number): [number, number, number];
export function preKey(a: Asset): string;
export function setPalette(list: RGB[]): void;
export function nearest(r: number, g: number, b: number): number;
export function medianCut(px: RGB[], n: number): RGB[];
export function buildBase(a: Asset, N: number): Idx;
export function finalize(base: Idx, N: number, steps?: string): Idx;
export function toImage(idx: Idx, N: number, pal?: RGB[]): ImageData;
export function variantPalettes(): RGB[][];
export function rigFrames(base: Idx, N: number, an: Anim, a: Asset): Idx[];
export function profileOf(N: number): Profile;
export function autoRig(a: Asset, type: string, armHint?: string): { ok: boolean; msg?: string; bones?: number; notes?: string[] };
export function bakePreset(a: Asset, an: Anim, id: string): boolean;
export function setNextId(n: number): void;
export function getNextId(): number;
export const PRESET_ANIMS: Record<string, { label: string }>;
export const PRESET_ORDER: string[];
