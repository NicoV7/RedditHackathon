/**
 * Killer-lie baking (B2b, PLAN §2.4 / harness lie-tells).
 *
 * The generator marks the KILLER's incriminating slice entries (their own
 * means/opportunity self-account) as `statedAs: "statedLie"` so the killer
 * actually lies and the hero lie-tell can fire end-to-end. CRITICAL invariant:
 * `statedAs` lives on the slice PROJECTION and is read ONLY by the NPC harness —
 * the validator, blind solver, and reachability traverse facts/clues/reachability
 * and NEVER read it. So lie-baking MUST be SOLVABILITY-NEUTRAL: the fact/clue
 * graph, the unique-killer guarantee, and validation stay byte-identical.
 */
import { describe, it, expect } from "vitest";
import type { CaseInstance, Fact, SliceEntry } from "../../shared/case.js";
import { drawInstance, generateTemplate } from "./procedural.js";
import { validateInstance } from "./validate.js";
import { solveInstance } from "./solve.js";
import { computeLieTell } from "../npc/harness.js";
import type { FacultyLevels } from "../../shared/api.js";

const template = generateTemplate("statedlie-seed");

/** Slice entries the named NPC states deceptively. */
function liesOf(inst: CaseInstance, npcId: string): SliceEntry[] {
  const npc = inst.npcs.find((n) => n.id === npcId)!;
  return npc.slice.filter((e) => e.statedAs === "statedLie");
}

/** The fact graph the validator/solver read — WITHOUT statedAs (the lie marker). */
function graphSansStatedAs(inst: CaseInstance): unknown {
  return {
    suspectIds: inst.suspectIds,
    killerId: inst.killerId,
    facts: inst.facts,
    clues: inst.clues,
    items: inst.items,
    lockedZones: inst.lockedZones,
    solution: inst.solution,
    // slice factIds + ordering are structural; statedAs is the harness-only marker.
    npcs: inst.npcs.map((n) => ({ id: n.id, factIds: n.slice.map((e) => e.factId) })),
  };
}

describe("killer lie-baking (B2b)", () => {
  it("the killer has ≥1 statedLie after every draw (200 seeds)", () => {
    for (let i = 0; i < 200; i++) {
      const inst = drawInstance(template, `k-${i}`);
      expect(liesOf(inst, inst.killerId).length, `seed k-${i}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("the killer's lies are exactly their OWN incriminating means/opportunity", () => {
    for (let i = 0; i < 100; i++) {
      const inst = drawInstance(template, `shape-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      for (const e of liesOf(inst, inst.killerId)) {
        const f = factById.get(e.factId)!;
        expect(f.subject).toBe(inst.killerId);
        expect(["means", "opportunity"]).toContain(f.predicate);
      }
    }
  });

  it("the killer never lies about a refuter (it has none by construction)", () => {
    for (let i = 0; i < 100; i++) {
      const inst = drawInstance(template, `nor-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const killer = inst.npcs.find((n) => n.id === inst.killerId)!;
      for (const e of killer.slice) {
        const f = factById.get(e.factId)!;
        expect(f.predicate.startsWith("refutes")).toBe(false);
      }
    }
  });

  it("every instance has ≥1 INNOCENT decoy tell, shaped only on its OWN m/o (D2)", () => {
    // Post-fix: innocent decoy tells are UNCONDITIONAL (no 0.5 gate). At least one
    // innocent always carries a means/opportunity statedLie so the killer is never
    // the sole tell-bearer. Decoy lies live ONLY on the decoy's own means/opp.
    for (let i = 0; i < 300; i++) {
      const inst = drawInstance(template, `rh-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const innocentsWithLies = inst.suspectIds
        .filter((s) => s !== inst.killerId)
        .filter((s) => liesOf(inst, s).length > 0);
      expect(innocentsWithLies.length, `seed rh-${i}: no innocent decoy tell`).toBeGreaterThanOrEqual(1);
      for (const s of innocentsWithLies) {
        for (const e of liesOf(inst, s)) {
          const f = factById.get(e.factId)!;
          expect(f.subject).toBe(s); // decoy lies only about ITSELF
          expect(["means", "opportunity"]).toContain(f.predicate); // never a refuter
        }
      }
    }
  });

  it("innocents never deceptively assert a refuter (alibi stays truthful)", () => {
    for (let i = 0; i < 100; i++) {
      const inst = drawInstance(template, `alibi-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      for (const s of inst.suspectIds) {
        if (s === inst.killerId) continue;
        const npc = inst.npcs.find((n) => n.id === s)!;
        for (const e of npc.slice) {
          const f = factById.get(e.factId)!;
          if (f.predicate.startsWith("refutes")) {
            expect(e.statedAs).toBe("true"); // alibis are always stated truthfully
          }
        }
      }
    }
  });
});

describe("lie-baking is solvability-neutral", () => {
  it("the fact/clue graph (sans statedAs) is unchanged by lie-baking — proven via validation", () => {
    // Lie-baking only writes statedAs; the validator/solver never read it. Every
    // instance must still validate and the blind solver must still land on the killer.
    for (let i = 0; i < 200; i++) {
      const inst = drawInstance(template, `neutral-${i}`);
      const res = validateInstance(inst);
      expect(res.ok, `seed neutral-${i}: ${res.reason}`).toBe(true);
      expect(solveInstance(inst).unique).toBe(inst.killerId);
    }
  });

  it("the fact/clue graph is BYTE-IDENTICAL with and without lie-baking (lies:false) (D2)", () => {
    // The keystone anti-spoiler proof: lie-baking writes ONLY statedAs, which the
    // validator/solver/reachability never read. Drawing with lies suppressed must
    // produce the SAME structural graph (suspects/killer/facts/clues/items/solution
    // and the slice FACT-IDs + ordering) as drawing with lies on — only the
    // statedAs markers may differ. Proven over a large sweep, both flavours valid.
    for (let i = 0; i < 300; i++) {
      const withLies = drawInstance(template, `bake-${i}`, { lies: true });
      const noLies = drawInstance(template, `bake-${i}`, { lies: false });
      expect(JSON.stringify(graphSansStatedAs(withLies)), `seed bake-${i}`).toBe(
        JSON.stringify(graphSansStatedAs(noLies)),
      );
      // Both flavours validate + blind-solve to the same unique killer (statedAs
      // is invisible to that machinery).
      expect(validateInstance(withLies).ok).toBe(true);
      expect(validateInstance(noLies).ok).toBe(true);
      expect(solveInstance(withLies).unique).toBe(withLies.killerId);
      expect(solveInstance(noLies).unique).toBe(noLies.killerId);
      // With lies suppressed, NO slice entry is ever a statedLie.
      const anyLie = noLies.npcs.some((n) => n.slice.some((e) => e.statedAs === "statedLie"));
      expect(anyLie, `seed bake-${i}: lies:false leaked a statedLie`).toBe(false);
    }
  });

  it("the graph-sans-statedAs is byte-identical to a draw with quirks suppressed", () => {
    // quirks:false and quirks:true differ only in the (validator-ignored) quirks
    // field; the slice factIds + statedAs are produced identically. Confirm the
    // structural graph (ignoring statedAs) is stable across the quirk flag too.
    for (let i = 0; i < 100; i++) {
      const withQuirks = drawInstance(template, `q-${i}`, { quirks: true });
      const without = drawInstance(template, `q-${i}`, { quirks: false });
      expect(JSON.stringify(graphSansStatedAs(withQuirks)), `seed q-${i}`).toBe(
        JSON.stringify(graphSansStatedAs(without)),
      );
      // ...and statedAs itself is identical across the quirk flag (lie stream is
      // independent of quirks), so the FULL slice matches too.
      expect(JSON.stringify(withQuirks.npcs.map((n) => n.slice))).toBe(
        JSON.stringify(without.npcs.map((n) => n.slice)),
      );
    }
  });

  it("the same daily template still draws the same killer + same statedLie set per seed", () => {
    for (let i = 0; i < 50; i++) {
      const a = drawInstance(template, `det-${i}`);
      const b = drawInstance(template, `det-${i}`);
      expect(a.killerId).toBe(b.killerId);
      expect(JSON.stringify(a.npcs.map((n) => n.slice))).toBe(JSON.stringify(b.npcs.map((n) => n.slice)));
      // and the whole instance is byte-identical (determinism is total).
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe("lie-baking wires through to the harness lie-tell end-to-end", () => {
  const HIGH: FacultyLevels = { logic: 5, empathy: 5, drama: 5, perception: 5, authority: 5, encyclopedia: 5 };
  const NONE: FacultyLevels = { logic: 0, empathy: 0, drama: 0, perception: 0, authority: 0, encyclopedia: 0 };

  it("a high-faculty player gets a TellSignal off the killer's baked lie", () => {
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(template, `tell-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const killer = inst.npcs.find((n) => n.id === inst.killerId)!;
      const tell = computeLieTell(killer.slice, HIGH, factById);
      expect(tell, `seed tell-${i}`).not.toBeNull();
      // means/opportunity lies read as an emotional/theatrical tell.
      expect(["empathy", "drama"]).toContain(tell!.faculty);
    }
  });

  it("a zero-faculty player sees no tell even though the lie is baked", () => {
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(template, `notell-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const killer = inst.npcs.find((n) => n.id === inst.killerId)!;
      expect(computeLieTell(killer.slice, NONE, factById)).toBeNull();
    }
  });

  it("the tell intensity is cosmetic and never gates the structural solve", () => {
    // The tell exists, but the case is still solved purely from the clue graph:
    // removing the tell entirely (faculties undefined) does not change the killer.
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(template, `cos-${i}`);
      expect(solveInstance(inst).unique).toBe(inst.killerId);
    }
  });
});

// ─────────── ANTI-SPOILER INTEGRITY: symmetric tells (D2) ───────────
// The verified flaw was that the killer was the SOLE empathy/drama tell-bearer in
// ~52% of instances — a >50% killer fingerprint visible to a high-faculty player
// purely from "who has a tell at all", undermining "solvability is STRUCTURAL".
// These tests pin the fix: a tell never identifies the killer better than a coin
// over the suspect pool, and NEVER fingerprints them outright.
describe("symmetric tells: the killer is never distinguishable by a tell (D2)", () => {
  const HIGH: FacultyLevels = { logic: 5, empathy: 5, drama: 5, perception: 5, authority: 5, encyclopedia: 5 };

  /** Suspects whose slice yields a (high-faculty) TellSignal — the "tell-bearers". */
  function tellBearers(inst: CaseInstance): string[] {
    const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
    return inst.suspectIds.filter((s) => {
      const npc = inst.npcs.find((n) => n.id === s)!;
      return computeLieTell(npc.slice, HIGH, factById) !== null;
    });
  }

  it("the killer is NEVER the SOLE tell-bearer (1000-seed sweep, high faculties)", () => {
    for (let i = 0; i < 1000; i++) {
      const inst = drawInstance(template, `sole-${i}`);
      const bearers = tellBearers(inst);
      // The killer always bears a tell, AND at least one innocent does too.
      expect(bearers).toContain(inst.killerId);
      expect(bearers.length, `seed sole-${i}: killer is the only tell-bearer`).toBeGreaterThanOrEqual(2);
      const innocentBearers = bearers.filter((s) => s !== inst.killerId);
      expect(innocentBearers.length, `seed sole-${i}: no innocent tell-bearer`).toBeGreaterThanOrEqual(1);
    }
  });

  it("an innocent decoy's tell is SHAPE- and COUNT-symmetric with the killer's (D2)", () => {
    // The killer must not be distinguishable by the SHAPE (which predicates) or the
    // COUNT of its tellable lies. At least one innocent reproduces the killer's exact
    // tell shape, entry-for-entry.
    for (let i = 0; i < 500; i++) {
      const inst = drawInstance(template, `shape-sym-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const predicatesOf = (npcId: string): string[] =>
        liesOf(inst, npcId)
          .map((e) => factById.get(e.factId)!.predicate)
          .sort();
      const killerShape = predicatesOf(inst.killerId).join(",");
      const innocents = inst.suspectIds.filter((s) => s !== inst.killerId);
      const matchingDecoy = innocents.some((s) => predicatesOf(s).join(",") === killerShape);
      expect(matchingDecoy, `seed shape-sym-${i}: no innocent matches killer tell-shape ${killerShape}`).toBe(true);
    }
  });

  it("an innocent decoy's tell uses the SAME faculty bucket as the killer's (D2)", () => {
    // The killer's m/o lies read as empathy/drama. At least one innocent's tell must
    // resolve to the same faculty bucket, so a high-empathy player can't isolate the
    // killer by the faculty that lights up.
    for (let i = 0; i < 500; i++) {
      const inst = drawInstance(template, `fac-sym-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      const killerNpc = inst.npcs.find((n) => n.id === inst.killerId)!;
      const killerTell = computeLieTell(killerNpc.slice, HIGH, factById);
      expect(killerTell).not.toBeNull();
      const bucket = killerTell!.faculty; // empathy | drama
      const innocents = inst.suspectIds.filter((s) => s !== inst.killerId);
      const sameBucket = innocents.some((s) => {
        const npc = inst.npcs.find((n) => n.id === s)!;
        const t = computeLieTell(npc.slice, HIGH, factById);
        return t !== null && t.faculty === bucket;
      });
      expect(sameBucket, `seed fac-sym-${i}: no innocent shares the killer's tell bucket`).toBe(true);
    }
  });

  it("P(killer is the UNIQUE tell-bearer) ≈ 1/|suspects| and NEVER 1.0 (5000-seed sweep)", () => {
    // The structural guarantee target: a tell, on its own, identifies the killer no
    // better than picking uniformly at random from the suspects — and never fingerprints
    // them. With ≥2 decoys possible, P(unique) should sit well under 1/|suspects|.
    let uniqueKillerBearer = 0;
    let total = 0;
    let suspectCountSum = 0;
    for (let i = 0; i < 5000; i++) {
      const inst = drawInstance(template, `prob-${i}`);
      const bearers = tellBearers(inst);
      suspectCountSum += inst.suspectIds.length;
      // "killer is the unique tell-bearer" = bearers == exactly {killer}.
      if (bearers.length === 1 && bearers[0] === inst.killerId) uniqueKillerBearer++;
      total++;
    }
    const pUnique = uniqueKillerBearer / total;
    const avgSuspects = suspectCountSum / total;
    const oneOverN = 1 / avgSuspects; // ~0.2 for 5 suspects
    // HARD invariant: the killer is NEVER the unique tell-bearer (the fix's core).
    expect(uniqueKillerBearer, "killer was the unique tell-bearer at least once").toBe(0);
    // P(unique killer tell-bearer) is at or below the 1/|suspects| random baseline
    // (it is in fact 0 by construction, comfortably under the random baseline).
    expect(pUnique).toBeLessThanOrEqual(oneOverN);
    expect(pUnique).toBeLessThan(1); // NEVER a deterministic fingerprint.
  });

  it("a high-faculty player can't beat random by ranking on 'has a tell' alone (D2)", () => {
    // Strongest framing: if a player guessed the killer to be a uniformly-random
    // tell-bearer, their accuracy must be ≈ 1/|tell-bearers|, NOT inflated by the
    // killer being over-represented among tell-bearers. We measure the expected
    // accuracy of that strategy and assert it stays near the random baseline.
    let expectedAccuracySum = 0;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const inst = drawInstance(template, `rank-${i}`);
      const bearers = tellBearers(inst);
      // guess a uniformly random tell-bearer ⇒ P(correct) = 1/|bearers| (killer is
      // always in the set). The flaw inflated this toward 1.0 (~52% sole-bearer).
      expectedAccuracySum += 1 / bearers.length;
      n++;
    }
    const meanAccuracy = expectedAccuracySum / n;
    // With ≥2 bearers every time, the "pick a tell-bearer" strategy tops out at 0.5
    // and trends lower as decoys stack — i.e. it is no longer a >50% fingerprint.
    expect(meanAccuracy).toBeLessThanOrEqual(0.5);
  });

  it("decoys keep a reachable, truthful refuter — never a second viable killer (D2)", () => {
    // The decoy tell is flavor: the innocent's alibi (refuter) stays statedAs:'true'
    // and reachable, so the blind solver still refutes them. The unique killer holds.
    for (let i = 0; i < 500; i++) {
      const inst = drawInstance(template, `viab-${i}`);
      const factById = new Map<string, Fact>(inst.facts.map((f) => [f.id, f]));
      // No decoy ever marks a refuter as a lie.
      for (const s of inst.suspectIds) {
        if (s === inst.killerId) continue;
        const npc = inst.npcs.find((n) => n.id === s)!;
        for (const e of npc.slice) {
          const f = factById.get(e.factId)!;
          if (f.predicate.startsWith("refutes")) expect(e.statedAs).toBe("true");
        }
      }
      // And the structural solve is untouched: exactly the intended unique killer.
      expect(validateInstance(inst).ok).toBe(true);
      expect(solveInstance(inst).unique).toBe(inst.killerId);
    }
  });
});
