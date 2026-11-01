/**
 * The six first-version modules and their fields, from the Forge Core spec.
 * Link fields are stored as links between entries (relation = field key);
 * every other field is stored in the entry's `fields`.
 */
export type Kind = "lore" | "quest" | "zone" | "mob" | "item" | "skill";

export type FieldDef =
  | { key: string; label: string; type: "text" | "longtext" }
  | { key: string; label: string; type: "number"; unit?: string }
  | { key: string; label: string; type: "select"; options: string[] }
  | { key: string; label: string; type: "list"; hint?: string }
  | { key: string; label: string; type: "rating" }
  | { key: string; label: string; type: "link"; to: Kind[] };

export interface ModuleDef {
  kind: Kind;
  label: string;
  singular: string;
  types: string[];
  fields: FieldDef[];
  /** Fields shown as columns in table view and on cards. */
  columns: string[];
}

export const STATUSES = ["Idea", "Draft", "In Review", "Final", "Cut"];
const RARITY = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

export const MODULES: ModuleDef[] = [
  {
    kind: "lore",
    label: "Lore",
    singular: "Lore entry",
    types: ["History", "Religion", "Culture", "Event", "Character", "Myth", "Timeline Entry", "Organization", "Faction", "Government", "Technology", "Magic", "Misc"],
    fields: [
      { key: "canonStatus", label: "Canon status", type: "select", options: ["Canon", "Semi-canon", "Non-canon", "Retconned"] },
      { key: "importance", label: "Importance", type: "rating" },
      { key: "connectedEntries", label: "Connected entries", type: "link", to: ["lore"] },
      { key: "relatedQuests", label: "Related quests", type: "link", to: ["quest"] },
      { key: "relatedZones", label: "Related zones", type: "link", to: ["zone"] },
      { key: "relatedNpcs", label: "Related NPCs", type: "link", to: ["lore"] },
    ],
    columns: ["canonStatus", "importance"],
  },
  {
    kind: "quest",
    label: "Quests",
    singular: "Quest",
    types: ["Main Quest", "Side Quest", "Event Quest", "Hidden Quest", "Repeatable Quest", "Tutorial Quest", "Achievement Quest"],
    fields: [
      { key: "questGiver", label: "Quest giver", type: "link", to: ["lore"] },
      { key: "completionNpc", label: "Completion NPC", type: "link", to: ["lore"] },
      { key: "zone", label: "Zone", type: "link", to: ["zone"] },
      { key: "difficulty", label: "Difficulty", type: "select", options: ["Trivial", "Easy", "Normal", "Hard", "Elite", "Legendary"] },
      { key: "recommendedLevel", label: "Recommended level", type: "number" },
      { key: "prerequisites", label: "Prerequisite quests", type: "link", to: ["quest"] },
      { key: "objectives", label: "Objectives", type: "list", hint: "One per line" },
      { key: "rewards", label: "Rewards", type: "list", hint: "One per line, e.g. 200 gold" },
      { key: "rewardItems", label: "Reward items", type: "link", to: ["item"] },
      { key: "failureConditions", label: "Failure conditions", type: "longtext" },
      { key: "followUpQuests", label: "Follow-up quests", type: "link", to: ["quest"] },
      { key: "storyImpact", label: "Story impact", type: "longtext" },
    ],
    columns: ["difficulty", "recommendedLevel"],
  },
  {
    kind: "zone",
    label: "Zones",
    singular: "Zone",
    types: ["Forest", "Plains", "Desert", "Mountain", "Swamp", "Ocean", "City", "Dungeon", "Cave", "Space", "Underworld", "Floating Island", "Custom"],
    fields: [
      { key: "biome", label: "Biome", type: "text" },
      { key: "levelMin", label: "Level from", type: "number" },
      { key: "levelMax", label: "Level to", type: "number" },
      { key: "climate", label: "Climate", type: "text" },
      { key: "resources", label: "Resources", type: "list", hint: "One per line" },
      { key: "dangers", label: "Dangers", type: "list", hint: "One per line" },
      { key: "factionsPresent", label: "Factions present", type: "link", to: ["lore"] },
      { key: "questLinks", label: "Quests here", type: "link", to: ["quest"] },
      { key: "npcLinks", label: "NPCs here", type: "link", to: ["lore"] },
      { key: "mobLinks", label: "Mobs here", type: "link", to: ["mob"] },
      { key: "mapNotes", label: "Map notes", type: "longtext" },
    ],
    columns: ["levelMin", "levelMax", "climate"],
  },
  {
    kind: "mob",
    label: "Mobs",
    singular: "Mob",
    types: ["Beast", "Undead", "Construct", "Humanoid", "Elemental", "Boss", "Miniboss", "Elite", "Swarm"],
    fields: [
      { key: "rarity", label: "Rarity", type: "select", options: RARITY },
      { key: "health", label: "Health", type: "number" },
      { key: "damage", label: "Damage", type: "number" },
      { key: "armor", label: "Armor", type: "number" },
      { key: "aggroRadius", label: "Aggression radius", type: "number" },
      { key: "aiBehavior", label: "AI behavior", type: "longtext" },
      { key: "resistances", label: "Resistances", type: "list", hint: "One per line" },
      { key: "weaknesses", label: "Weaknesses", type: "list", hint: "One per line" },
      { key: "spawnLocations", label: "Spawn locations", type: "link", to: ["zone"] },
      { key: "lootTable", label: "Loot table", type: "link", to: ["item"] },
      { key: "skills", label: "Skills", type: "link", to: ["skill"] },
      { key: "variants", label: "Variants", type: "link", to: ["mob"] },
    ],
    columns: ["rarity", "health", "damage", "armor"],
  },
  {
    kind: "item",
    label: "Items",
    singular: "Item",
    types: ["Weapon", "Armor", "Accessory", "Material", "Consumable", "Quest Item", "Currency", "Component", "Collectible"],
    fields: [
      { key: "rarity", label: "Rarity", type: "select", options: RARITY },
      { key: "stackSize", label: "Stack size", type: "number" },
      { key: "buyPrice", label: "Buy price", type: "number" },
      { key: "sellPrice", label: "Sell price", type: "number" },
      { key: "effects", label: "Effects", type: "list", hint: "One per line" },
      { key: "craftingUses", label: "Used to craft", type: "link", to: ["item"] },
      { key: "lootSources", label: "Dropped by", type: "link", to: ["mob"] },
      { key: "upgradePaths", label: "Upgrades into", type: "link", to: ["item"] },
      { key: "relatedSkills", label: "Related skills", type: "link", to: ["skill"] },
    ],
    columns: ["rarity", "buyPrice", "sellPrice"],
  },
  {
    kind: "skill",
    label: "Skills",
    singular: "Skill",
    types: ["Active", "Passive", "Ultimate", "Talent", "Trait", "Class Skill", "Weapon Skill"],
    fields: [
      { key: "cost", label: "Cost", type: "text" },
      { key: "cooldown", label: "Cooldown", type: "number", unit: "s" },
      { key: "scaling", label: "Scaling", type: "text" },
      { key: "damageFormula", label: "Damage formula", type: "text" },
      { key: "unlockMethod", label: "Unlock method", type: "text" },
      { key: "requirements", label: "Requirements", type: "longtext" },
      { key: "prerequisiteSkills", label: "Requires skills", type: "link", to: ["skill"] },
      { key: "upgradeTree", label: "Upgrades into", type: "link", to: ["skill"] },
      { key: "animationNotes", label: "Animation notes", type: "longtext" },
    ],
    columns: ["cost", "cooldown"],
  },
];

export const MODULE_BY_KIND = Object.fromEntries(MODULES.map((m) => [m.kind, m])) as Record<Kind, ModuleDef>;

export function fieldLabel(kind: string, key: string): string {
  return MODULE_BY_KIND[kind as Kind]?.fields.find((f) => f.key === key)?.label ?? key;
}

/** Display text for a stored field value. */
export function formatValue(v: unknown, field?: FieldDef): string {
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) return v.join(", ");
  if (field?.type === "rating" && typeof v === "number") return "★".repeat(v) + "☆".repeat(Math.max(0, 5 - v));
  if (field?.type === "number" && field.unit) return `${v} ${field.unit}`;
  return String(v);
}
