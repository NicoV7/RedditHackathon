import { describe, it, expect } from "vitest";
import { generateTemplate, drawInstance } from "./procedural.js";
import { validateInstance } from "./validate.js";
import { solveInstance } from "./solve.js";

describe("procedural generator → per-player instances", () => {
  const template = generateTemplate("2026-06-24");

  it("every drawn instance is solvable-by-construction (200 seeds)", () => {
    for (let i = 0; i < 200; i++) {
      const inst = drawInstance(template, `player-${i}`);
      const res = validateInstance(inst);
      expect(res.ok, `seed player-${i}: ${res.reason}`).toBe(true);
    }
  });

  it("blind solver lands exactly on the intended killer", () => {
    for (let i = 0; i < 200; i++) {
      const inst = drawInstance(template, `player-${i}`);
      expect(solveInstance(inst).unique).toBe(inst.killerId);
    }
  });

  it("randomizes the killer across players (anti-spoiler)", () => {
    const killers = new Set<string>();
    for (let i = 0; i < 200; i++) killers.add(drawInstance(template, `player-${i}`).killerId);
    // With ≥4 suspects we expect the killer to vary widely across instances.
    expect(killers.size).toBeGreaterThan(1);
    for (const k of killers) expect(template.suspectIds).toContain(k);
  });

  it("is deterministic: same seed → byte-identical instance", () => {
    const a = drawInstance(template, "repeat-me");
    const b = drawInstance(template, "repeat-me");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("templates are deterministic: same daily seed → identical template", () => {
    expect(JSON.stringify(generateTemplate("d1"))).toBe(JSON.stringify(generateTemplate("d1")));
    expect(JSON.stringify(generateTemplate("d1"))).not.toBe(JSON.stringify(generateTemplate("d2")));
  });

  it("respects suspect count bounds (≤ 8) and tiers (suspects ⊆ principal)", () => {
    const t = generateTemplate("bounds", { suspects: 6, extras: 8 });
    expect(t.suspectIds.length).toBeLessThanOrEqual(8);
    for (const s of t.suspectIds) {
      const npc = t.roster.find((n) => n.id === s)!;
      expect(npc.tier).toBe("principal");
    }
  });
});
