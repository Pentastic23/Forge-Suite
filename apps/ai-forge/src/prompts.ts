// What the assistant is told before each chat: what kind of help this chat is for,
// and what it should know about the game (the project brief and, when imported,
// the Forge Core codex). Kept here so the person can read exactly what is sent.
import type { Codex, Mode } from "./api";

export interface ModeInfo { key: Mode; label: string; hint: string; starters: string[] }

export const MODES: ModeInfo[] = [
  { key: "general", label: "General", hint: "Anything about making your game.", starters: ["What should I build first for a vertical slice?", "Help me plan this week's work"] },
  { key: "code", label: "Code", hint: "Gameplay code, engine questions and bugs.", starters: ["Write a player controller with coyote time and jump buffering", "Why does my character jitter on slopes?", "Explain this error:"] },
  { key: "design", label: "Game design", hint: "Mechanics, levels, bosses, progression and balance ideas.", starters: ["Give me three boss ideas that teach a new mechanic", "How long should the first level take?", "Design a crafting loop that doesn't feel like a chore"] },
  { key: "writing", label: "Story & lore", hint: "Lore, quests, dialogue, item text and names.", starters: ["Write the shopkeeper's greeting in three moods", "Name ten potions in the game's voice", "Draft a side quest for the first zone"] },
  { key: "art", label: "2D art", hint: "Art direction, palettes, sprite and UI advice, and image prompts.", starters: ["Write an image prompt for the main menu background", "Suggest a 16-color palette for a cozy forest", "How many frames should a walk cycle have?"] },
  { key: "model3d", label: "3D", hint: "Modelling, low-poly, rigging, Blender scripts and 3D prompts.", starters: ["Write a Blender Python script that builds a low-poly tree", "What polycount should a mobile enemy have?", "Write a Meshy prompt for a treasure chest"] },
  { key: "review", label: "Review", hint: "Paste code or a design and get honest feedback.", starters: ["Review this script for bugs and performance:", "What's missing from this level plan?"] },
];

export const ENGINES: [string, string][] = [
  ["godot", "Godot 4 (GDScript)"],
  ["godot-cs", "Godot 4 (C#)"],
  ["unity", "Unity (C#)"],
  ["unreal", "Unreal Engine 5 (C++ and Blueprints)"],
  ["gamemaker", "GameMaker (GML)"],
  ["phaser", "Phaser 3 (JavaScript/TypeScript)"],
  ["love", "LÖVE (Lua)"],
  ["bevy", "Bevy (Rust)"],
  ["other", "Something else"],
];

export interface Brief { game: string; genre: string; engine: string; artStyle: string; notes: string; useCodex: boolean }
export const EMPTY_BRIEF: Brief = { game: "", genre: "", engine: "godot", artStyle: "", notes: "", useCodex: true };

export function cleanBrief(v: unknown): Brief {
  const b = (v && typeof v === "object" ? v : {}) as Partial<Brief>;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  return {
    game: s(b.game, 120), genre: s(b.genre, 200), artStyle: s(b.artStyle, 600), notes: s(b.notes, 6000),
    engine: ENGINES.some(([k]) => k === b.engine) ? b.engine! : EMPTY_BRIEF.engine,
    useCodex: b.useCodex !== false,
  };
}

const MODE_RULES: Record<Mode, string> = {
  general: "Help with any part of making the game. Be practical: suggest the smallest next step that moves the game forward.",
  code: "Help with game code. Write complete, working code for the person's engine and language, in fenced code blocks with the language named. Prefer the engine's own built-in features over custom systems. Say which file or node each piece goes in. When fixing a bug, explain the cause in one or two sentences first.",
  design: "Help with game design: mechanics, levels, encounters, progression, economy and pacing. Give a few concrete options with their trade-offs, then say which you would pick and why. Tie ideas to what the game already has.",
  writing: "Help with story, lore, quests, dialogue, item descriptions and names. Match the game's tone and stay consistent with its existing lore. Keep in-game text short enough to read during play.",
  art: "Help with 2D art direction: style, palettes (give hex codes), sprite sizes, animation frame counts, UI and readability. When asked for an image prompt, put it in a ```text code block, as one paragraph, describing subject, style, palette, framing and background.",
  model3d: "Help with 3D: modelling, low-poly technique, topology, UVs, rigging and engine import settings. When asked for a Blender script, write a complete Python script for Blender 4 (bpy) that builds the model from scratch when run in Blender's Scripting tab. When asked for a 3D generation prompt, put it in a ```text code block, describing one object with its shape, materials and style.",
  review: "Review what the person pastes. List real problems first (bugs, edge cases, performance, unclear design), most important first, each with a fix. Then mention anything done well, briefly.",
};

/** The instructions sent with every message of a chat. */
export function systemPrompt(mode: Mode, brief: Brief, codex: Codex | null): string {
  const engine = ENGINES.find(([k]) => k === brief.engine)?.[1] ?? "not chosen yet";
  const lines = [
    "You are AI Forge, an assistant for an indie game developer, inside Forge Suite (their game development tools).",
    MODE_RULES[mode],
    "Answer in Markdown. Be direct and concise; skip preamble. If something about the game is unknown and it matters, ask one short question.",
    "",
    "About the game:",
    `- Name: ${brief.game.trim() || "not named yet"}`,
    `- Genre: ${brief.genre.trim() || "not given"}`,
    `- Engine: ${engine}`,
    `- Art style: ${brief.artStyle.trim() || "not given"}`,
  ];
  if (brief.notes.trim()) lines.push(`- Notes: ${brief.notes.trim()}`);
  if (brief.useCodex && codex && codex.entries.length) {
    lines.push("", `The game's codex (from Forge Core, "${codex.project}"). Treat it as canon:`);
    for (const e of codex.entries.slice(0, 400)) lines.push(`- [${e.kind}] ${e.name}${e.summary ? `: ${e.summary}` : ""}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- images

export interface ArtPreset { key: string; label: string; words: string; transparent: boolean }
export const ART_PRESETS: ArtPreset[] = [
  { key: "none", label: "As written", words: "", transparent: false },
  { key: "sprite", label: "Pixel art sprite", words: "pixel art game sprite, full body, clean 1 px dark outline, limited palette, flat shading, centered, no text", transparent: true },
  { key: "icon", label: "Item icon", words: "game inventory icon, single object, centered, bold readable silhouette, no text", transparent: true },
  { key: "tile", label: "Seamless tile", words: "seamless tileable texture, top-down, even lighting, no visible seams", transparent: false },
  { key: "concept", label: "Concept art", words: "game concept art, painterly, strong composition, atmospheric lighting", transparent: false },
  { key: "background", label: "Background", words: "2D game background, layered for parallax, wide landscape, no characters", transparent: false },
  { key: "portrait", label: "Character portrait", words: "character portrait for dialogue box, bust shot, expressive face, plain background", transparent: false },
  { key: "ui", label: "UI element", words: "game UI element, clean shapes, readable at small size, no text", transparent: true },
];

/** The prompt sent for an image: the person's words, the preset's, and the game's art style when asked. */
export function imagePrompt(text: string, preset: string, brief: Brief, withStyle: boolean): string {
  const p = ART_PRESETS.find((a) => a.key === preset);
  const parts = [text.trim()];
  if (p?.words) parts.push(p.words);
  if (withStyle && brief.artStyle.trim()) parts.push(`in this art style: ${brief.artStyle.trim()}`);
  return parts.filter(Boolean).join(", ");
}

/** What "Improve prompt" asks the chat model for. */
export function improveRequest(kind: "image" | "model", text: string, brief: Brief): string {
  const what = kind === "image" ? "an image generator making 2D game art" : "a 3D model generator (one object, game-ready)";
  return [
    `Rewrite this prompt for ${what}. Keep the person's idea; add concrete detail about shape, materials, colors, lighting and framing.`,
    brief.artStyle.trim() ? `The game's art style: ${brief.artStyle.trim()}.` : "",
    `Answer with the prompt only, one paragraph, no quotes, under ${kind === "image" ? 120 : 80} words.`,
    "",
    `Prompt: ${text.trim()}`,
  ].filter((l) => l !== "").join("\n");
}

/** The first ```text block in an answer, or the whole answer when there is none. */
export function firstPrompt(answer: string): string {
  const m = answer.match(/```(?:text|prompt)?\n([\s\S]*?)```/);
  return (m ? m[1] : answer).trim();
}
