/** The Forge apps inside Forge Suite mobile. Each has a page named `<id>.html`. */
export interface SuiteApp {
  id: string;
  name: string;
  description: string;
  /** The width the app was laid out for on desktop; narrower screens are scaled to fit it. */
  width: number;
  accent: string;
}

export const APPS: SuiteApp[] = [
  { id: "forge-core", name: "Forge Core", description: "Game Development Codex: lore, quests, zones, mobs, items and skills.", width: 980, accent: "var(--forge-accent-core)" },
  { id: "balance-forge", name: "Balance Forge", description: "Stat sheets, analysis and simulations for game balance.", width: 1000, accent: "var(--forge-accent-balance)" },
  { id: "asset-forge", name: "Asset Forge", description: "Asset library, checks, production tracking and engine export.", width: 1060, accent: "var(--forge-accent-asset)" },
  { id: "pixel-forge", name: "Pixel Forge", description: "Sketches to game-ready pixel art, rigging and animation.", width: 1100, accent: "var(--forge-accent-pixel)" },
  { id: "ai-forge", name: "AI Forge", description: "AI assistant for game dev: code, design, art from a prompt and 3D models.", width: 1060, accent: "var(--forge-accent-ai)" },
];
