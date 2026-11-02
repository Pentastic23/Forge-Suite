export interface Sprite { w: number; h: number; d: Uint8ClampedArray }
export interface StyleReport {
  count: number; palette: string[]; ink: string; outline: "outer" | "selective" | "none"; outlineWidth: number;
  rampStep: number | null; rampHue: number | null; shadowHue: number | null; lightHue: number | null;
  shadeBands: number; shade: "cel" | "form"; light: "tl" | "t" | "tr"; rampLength: number; charHeight: number; aspect: number; size: number; notes: string[];
}
export interface Theme { app: string; version: number; name: string; palette: string[]; settings: Record<string, unknown> }
export interface SavedSettings { settings: Record<string, unknown>; palette: string[] | null }
export function spritesFromImage(im: ImageData, cell: number): Sprite[];
export function analyzeStyle(sprites: Sprite[]): StyleReport;
export function nearestSize(n: number): number;
export function applyTrained(r: StyleReport): number;
export function snapshotTheme(name: string): Theme;
export function isTheme(t: unknown): t is Theme;
export function applyTheme(t: unknown): boolean;
export function settingsSnapshot(): SavedSettings;
export function loadSettings(saved: SavedSettings | null | undefined): void;
