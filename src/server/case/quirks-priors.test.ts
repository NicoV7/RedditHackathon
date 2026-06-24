/**
 * Quirk invariance + clue-prior determinism (J3, PLAN §2.5).
 *
 *  - QUIRKS are FLAVOR ONLY: the fact/clue/slice graph the validator+solver read must
 *    be byte-identical with and without quirks for the same seed.
 *  - CLUE PRIORS only *weight* a seeded draw: same seed ⇒ byte-identical instance, and
 *    the prior function ranks evidentiary kinds above background kinds.
 */
import { describe, it, expect } from "vitest";
import type { CaseInstance } from "../../shared/case.js";
import { cluePrior, drawInstance, generateTemplate } from "./procedural.js";
import { validateInstance } from "./validate.js";

/** Strip the flavor-only `quirks` field everywhere so we compare only the graph. */
function graphOf(inst: CaseInstance): unknown {
  return {
    suspectIds: inst.suspectIds,
    killerId: inst.killerId,
    facts: inst.facts,
    clues: inst.clues,
    items: inst.items,
    lockedZones: inst.lockedZones,
    solution: inst.solution,
    // NPC slices are part of the deduction graph; quirks are NOT.
    npcs: inst.npcs.map((n) => ({ id: n.id, slice: n.slice })),
  };
}

describe("quirk materialization is flavor-only", () => {
  const template = generateTemplate("quirk-seed");

  it("the fact graph is byte-identical with and without quirks (same seed)", () => {
    for (let i = 0; i < 100; i++) {
      const withQuirks = drawInstance(template, `p-${i}`, { quirks: true });
      const without = drawInstance(template, `p-${i}`, { quirks: false });
      expect(JSON.stringify(graphOf(withQuirks)), `seed p-${i}`).toBe(JSON.stringify(graphOf(without)));
    }
  });

  it("validation result is identical with and without quirks", () => {
    for (let i = 0; i < 50; i++) {
      const a = validateInstance(drawInstance(template, `v-${i}`, { quirks: true }));
      const b = validateInstance(drawInstance(template, `v-${i}`, { quirks: false }));
      expect(a.ok).toBe(b.ok);
      expect(a.ok).toBe(true);
    }
  });

  it("quirks ARE materialized by default (flavor present, drawn from the pool)", () => {
    const inst = drawInstance(template, "has-quirks");
    for (const n of inst.npcs) {
      expect(Array.isArray(n.quirks)).toBe(true);
      expect(n.quirks!.length).toBeGreaterThanOrEqual(1);
      expect(new Set(n.quirks).size).toBe(n.quirks!.length); // no dupes within an NPC
    }
  });

  it("quirks are deterministic (same seed ⇒ same quirks)", () => {
    const a = drawInstance(template, "det-q");
    const b = drawInstance(template, "det-q");
    expect(JSON.stringify(a.npcs.map((n) => n.quirks))).toBe(JSON.stringify(b.npcs.map((n) => n.quirks)));
  });
});

describe("clue-likelihood priors", () => {
  it("rank: weapon/document > food/drink/trash, and crime-scene tags amplify", () => {
    const social = ["social", "host"];
    const hidden = ["hidden", "storage"];
    expect(cluePrior("weapon", social)).toBeGreaterThan(cluePrior("drink", social));
    expect(cluePrior("document", social)).toBeGreaterThan(cluePrior("trash", social));
    // A weapon in a hidden/storage zone outweighs the same weapon in a social zone.
    expect(cluePrior("weapon", hidden)).toBeGreaterThan(cluePrior("weapon", social));
    // Priors are strictly positive so every item keeps a chance (red herrings persist).
    for (const k of ["drink", "food", "trash", "effect", "document", "weapon"] as const) {
      expect(cluePrior(k, [])).toBeGreaterThan(0);
    }
  });

  it("priors are a PURE function of (kind, tags) — order-independent, repeatable", () => {
    expect(cluePrior("weapon", ["hidden", "private"])).toBe(cluePrior("weapon", ["hidden", "private"]));
    expect(cluePrior("document", ["documents"])).toBe(cluePrior("document", ["documents"]));
  });

  it("priors only WEIGHT the draw: same seed ⇒ byte-identical instance", () => {
    const template = generateTemplate("prior-det");
    const a = drawInstance(template, "same");
    const b = drawInstance(template, "same");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the inspectItem refuter channel still lands on real template items", () => {
    const template = generateTemplate("prior-items");
    const itemIds = new Set(template.items.map((i) => i.id));
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(template, `c-${i}`);
      for (const c of inst.clues) {
        if (c.unlockedBy.kind === "inspectItem") {
          expect(itemIds.has(c.unlockedBy.itemId), `seed c-${i}`).toBe(true);
        }
      }
    }
  });
});
