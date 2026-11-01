import { describe, expect, it } from "vitest";
import { MODULES, formatValue, fieldLabel } from "./modules";

describe("module definitions", () => {
  it("cover the six first-version modules with unique field keys", () => {
    expect(MODULES.map((m) => m.kind)).toEqual(["lore", "quest", "zone", "mob", "item", "skill"]);
    for (const m of MODULES) {
      const keys = m.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const c of m.columns) expect(keys).toContain(c);
      expect(m.types.length).toBeGreaterThan(0);
    }
  });
  it("formats values for display", () => {
    expect(formatValue(["Fire", "Ice"])).toBe("Fire, Ice");
    expect(formatValue(3, { key: "i", label: "I", type: "rating" })).toBe("★★★☆☆");
    expect(formatValue(4, { key: "c", label: "C", type: "number", unit: "s" })).toBe("4 s");
    expect(formatValue(undefined)).toBe("");
    expect(fieldLabel("mob", "aggroRadius")).toBe("Aggression radius");
  });
});
