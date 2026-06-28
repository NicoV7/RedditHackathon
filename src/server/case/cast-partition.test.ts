/**
 * Cast-partition + anti-spoiler validation guards (Wave 2). Pins two implicit
 * invariants the review flagged as untested: witnesses are NEVER drawn as suspects,
 * and a degenerate single-suspect case is rejected (else the killer is the sole
 * lie-tell bearer).
 */
import { describe, it, expect } from "vitest";
import { generateTemplate, drawInstance } from "./procedural.js";
import { validateInstance } from "./validate.js";
import { SUSPECT_NAMES, WITNESS_NAMES } from "../npc/personas/cast.js";

describe("cast partition", () => {
  it("SUSPECT_NAMES and WITNESS_NAMES are disjoint", () => {
    const suspects = new Set(SUSPECT_NAMES);
    for (const w of WITNESS_NAMES) expect(suspects.has(w), w).toBe(false);
  });

  it("witnesses are NEVER drawn as suspects across many seeds", () => {
    for (let i = 0; i < 60; i++) {
      const t = generateTemplate(`cp-${i}`);
      for (const w of WITNESS_NAMES) expect(t.suspectIds.includes(w), `${w} @ seed ${i}`).toBe(false);
    }
  });

  it("witnesses stay out of suspects across the opts.suspects boundary", () => {
    for (const n of [2, 4, 6, 8]) {
      const t = generateTemplate(`cp-opt-${n}`, { suspects: n });
      for (const w of WITNESS_NAMES) expect(t.suspectIds.includes(w), `${w} @ n=${n}`).toBe(false);
    }
  });
});

describe("anti-spoiler validation guard", () => {
  it("validateInstance rejects a degenerate single-suspect case", () => {
    const t = generateTemplate("single", { suspects: 1 });
    const inst = drawInstance(t, "p");
    const res = validateInstance(inst);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("too few suspects");
  });

  it("normal generated instances still validate", () => {
    for (let i = 0; i < 12; i++) {
      const inst = drawInstance(generateTemplate(`ok-${i}`), `p-${i}`);
      expect(validateInstance(inst).ok, `seed ${i}: ${validateInstance(inst).reason}`).toBe(true);
    }
  });
});
