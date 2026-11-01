import { describe, expect, it } from "vitest";
import { fighterFor, guessStatMap, judgeCostVsPower, keyFromName, powerCurve, renameInFormula, robustFit, ticks, uniqueKey, type Point } from "./analysis";
import type { Column } from "./api";

const p = (name: string, x: number, y: number): Point => ({ id: name, name, x, y });

describe("column keys", () => {
  it("turns names into formula keys", () => {
    expect(keyFromName("Attack speed")).toBe("attackSpeed");
    expect(keyFromName("2x damage")).toBe("_2xDamage");
    expect(keyFromName("  ")).toBe("_");
  });
  it("avoids clashes and the reserved name", () => {
    const cols: Column[] = [{ key: "damage", name: "Damage", kind: "number" }];
    expect(uniqueKey("Damage", cols)).toBe("damage2");
    expect(uniqueKey("Damage", cols, "damage")).toBe("damage");
    expect(uniqueKey("Name", [])).toBe("name2");
  });
  it("renames keys inside formulas only where they are whole names", () => {
    expect(renameInFormula("dmg * speed + dmgBonus", "dmg", "damage")).toBe("damage * speed + dmgBonus");
    expect(renameInFormula("max(max, 2)", "max", "cap")).toBe("max(cap, 2)");
    expect(renameInFormula("[dmg] + dmg", "dmg", "damage")).toBe("[dmg] + damage");
  });
});

describe("cost vs power", () => {
  const fair = [p("A", 100, 200), p("B", 200, 400), p("C", 300, 600), p("D", 400, 800)];

  it("one overpowered row doesn't move the trend", () => {
    const fit = robustFit([...fair, p("OP", 250, 2000)])!;
    expect(fit.slope).toBeCloseTo(2, 5);
    expect(fit.intercept).toBeCloseTo(0, 5);
  });

  it("flags rows above and below the trend", () => {
    const { rows } = judgeCostVsPower([...fair, p("OP", 250, 800), p("Weak", 350, 400)], 0.2);
    const v = Object.fromEntries(rows.map((r) => [r.name, r.verdict]));
    expect(v).toEqual({ A: "ok", B: "ok", C: "ok", D: "ok", OP: "strong", Weak: "weak" });
    expect(rows.find((r) => r.name === "OP")!.off).toBeCloseTo(0.6, 5);
  });

  it("needs two rows", () => {
    expect(judgeCostVsPower([p("A", 1, 1)], 0.2).rows).toEqual([]);
  });
});

describe("power curve", () => {
  it("flags a spike and a flat spot", () => {
    const pts = [p("1", 1, 100), p("2", 2, 110), p("3", 3, 121), p("4", 4, 200), p("5", 5, 196), p("6", 6, 216)];
    const { levels, typicalGrowth } = powerCurve(pts, 0.1);
    expect(typicalGrowth).toBeCloseTo(1.1, 2);
    expect(levels.map((r) => r.flag)).toEqual([null, null, null, "jump", "dip", null]);
  });
  it("follows the median when several rows share a level", () => {
    const { levels } = powerCurve([p("b", 2, 10), p("a", 1, 5), p("c", 2, 30), p("d", 2, 20)], 0.1);
    expect(levels.map((l) => [l.x, l.y, l.names])).toEqual([[1, 5, ["a"]], [2, 20, ["b", "c", "d"]]]);
    expect(levels[1].growth).toBe(4);
  });
});

describe("combat mapping", () => {
  const cols: Column[] = [
    { key: "hp", name: "HP", kind: "number" },
    { key: "atk", name: "Attack", kind: "number" },
    { key: "critChance", name: "Crit chance", kind: "number" },
    { key: "role", name: "Role", kind: "text" },
  ];
  it("guesses columns by common names", () => {
    expect(guessStatMap(cols)).toEqual({ health: "hp", damage: "atk", critChance: "critChance" });
  });
  it("fills gaps with defaults and reads percents", () => {
    const f = fighterFor("Knight", { hp: 500, atk: 40, critChance: 25 }, guessStatMap(cols));
    expect(f).toEqual({ name: "Knight", health: 500, damage: 40, attackSpeed: 1, armor: 0, critChance: 0.25, critMultiplier: 2, hitChance: 1 });
  });
});

describe("ticks", () => {
  it("covers the range with round numbers", () => {
    expect(ticks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(5, 5).length).toBeGreaterThan(1);
  });
});
