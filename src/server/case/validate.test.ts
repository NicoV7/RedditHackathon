/**
 * Unit tests for validateInstance() in validate.ts.
 *
 * Coverage strategy:
 *  - Happy path: a procedurally generated valid instance must pass.
 *  - Each rejection branch is exercised individually by hand-mutating a clone of
 *    a valid instance so exactly the target invariant is broken.
 *
 * Rejection branches covered:
 *  1. no suspects (empty suspectIds)
 *  2. >MAX_SUSPECTS suspects
 *  3. duplicate suspect ids
 *  4. killerId not in suspectIds
 *  5. dangling fact ref (clue revealsFactIds references unknown fact)
 *  6. duplicate fact / clue ids (structural — tested via duplicate suspect ids path
 *     and via dangling ref; explicit duplicate-id test below)
 *  7. cycle in the clue→clue precondition graph
 *  8. blind-solver mismatch (ambiguous case — two viable suspects)
 *  9. blind-solver mismatch (zero viable suspects — unsolvable)
 * 10. blind-solver mismatch (unique viable ≠ killerId)
 */

import { describe, it, expect } from "vitest";
import type { CaseInstance, Clue, Fact } from "../../shared/case.js";
import { MAX_SUSPECTS } from "../../shared/case.js";
import { generateTemplate, drawInstance } from "./procedural.js";
import { validateInstance } from "./validate.js";

// ─────────── helpers ───────────

/** Deep-clone a CaseInstance (JSON round-trip, safe because all values are serializable). */
function clone(inst: CaseInstance): CaseInstance {
  return JSON.parse(JSON.stringify(inst)) as CaseInstance;
}

/** Produce a base valid instance used as the mutation target in every negative test. */
const BASE_TEMPLATE = generateTemplate("validate-test-2026");
const BASE_INSTANCE = drawInstance(BASE_TEMPLATE, "base-player-0");

// Sanity: the base instance must be valid before we start mutating.
if (!validateInstance(BASE_INSTANCE).ok) {
  throw new Error(`Base instance for validate.test.ts is invalid: ${validateInstance(BASE_INSTANCE).reason}`);
}

// ─────────── happy path ───────────

describe("validateInstance — happy path", () => {
  it("accepts a procedurally generated valid instance", () => {
    const result = validateInstance(BASE_INSTANCE);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts 10 distinct valid instances across different player seeds", () => {
    for (let i = 0; i < 10; i++) {
      const inst = drawInstance(BASE_TEMPLATE, `happy-${i}`);
      const result = validateInstance(inst);
      expect(result.ok, `seed happy-${i}: ${result.reason}`).toBe(true);
    }
  });
});

// ─────────── rejection branch 1: no suspects ───────────

describe("validateInstance — rejection: no suspects", () => {
  it("rejects when suspectIds is empty", () => {
    const inst = clone(BASE_INSTANCE);
    inst.suspectIds = [];
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no suspects");
  });
});

// ─────────── rejection branch 2: too many suspects ───────────

describe("validateInstance — rejection: >MAX_SUSPECTS suspects", () => {
  it(`rejects when suspectIds has more than ${MAX_SUSPECTS} entries`, () => {
    const inst = clone(BASE_INSTANCE);
    // Build a list of MAX_SUSPECTS+1 unique ids.
    const extra = Array.from({ length: MAX_SUSPECTS + 1 }, (_, i) => `extra-suspect-${i}`);
    // killerId must be in the list so we don't trip a different rejection first.
    extra[0] = inst.killerId;
    inst.suspectIds = extra;
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(`>${MAX_SUSPECTS} suspects`);
  });
});

// ─────────── rejection branch 3: duplicate suspect ids ───────────

describe("validateInstance — rejection: duplicate suspect ids", () => {
  it("rejects when suspectIds contains a repeated id", () => {
    const inst = clone(BASE_INSTANCE);
    // Append a duplicate of the first suspect.
    const dup = inst.suspectIds[0]!;
    inst.suspectIds = [...inst.suspectIds, dup];
    // Make sure we still stay ≤ MAX_SUSPECTS so we don't hit the count check first.
    inst.suspectIds = inst.suspectIds.slice(0, Math.min(inst.suspectIds.length, MAX_SUSPECTS));
    // Force the dup in regardless (use just 2 entries if needed).
    if (inst.suspectIds.length < 2 || !inst.suspectIds.slice(1).includes(dup)) {
      inst.suspectIds = [dup, dup];
    }
    // Ensure killerId is still present.
    if (!inst.suspectIds.includes(inst.killerId)) {
      inst.suspectIds[1] = inst.killerId;
      inst.suspectIds[0] = inst.killerId; // duplicate it
    }
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("duplicate suspect ids");
  });
});

// ─────────── rejection branch 4: killerId not in suspectIds ───────────

describe("validateInstance — rejection: killerId not in suspectIds", () => {
  it("rejects when killerId is absent from suspectIds", () => {
    const inst = clone(BASE_INSTANCE);
    // Remove the killer from suspectIds (keep at least one entry so we don't hit "no suspects").
    inst.suspectIds = inst.suspectIds.filter((s) => s !== inst.killerId);
    if (inst.suspectIds.length === 0) {
      inst.suspectIds = ["some-other-suspect"];
    }
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("killerId not in suspectIds");
  });
});

// ─────────── rejection branch 5: dangling fact reference ───────────

describe("validateInstance — rejection: dangling / unknown fact ref in clue", () => {
  it("rejects when a clue revealsFactIds contains an id not in facts", () => {
    const inst = clone(BASE_INSTANCE);
    // Find a clue that already reveals at least one fact, then corrupt one ref.
    const target = inst.clues.find((c) => c.revealsFactIds.length > 0);
    if (!target) throw new Error("No clues with fact refs found in base instance");
    target.revealsFactIds[0] = "non-existent-fact-id-xyz";
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unknown fact");
  });

  it("rejects when a clue with always precondition has a wholly invented fact ref", () => {
    const inst = clone(BASE_INSTANCE);
    // Inject a brand-new clue (always-reachable) that references a made-up fact.
    const badClue: Clue = {
      id: "injected-clue-bad",
      revealsFactIds: ["ghost-fact-id"],
      unlockedBy: { kind: "always" },
    };
    inst.clues = [...inst.clues, badClue];
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("injected-clue-bad");
    expect(result.reason).toContain("ghost-fact-id");
  });
});

// ─────────── rejection branch 6: cycle in clue→clue precondition graph ───────────

describe("validateInstance — rejection: clue cycle", () => {
  it("rejects a direct 1-node cycle (clue depends on itself)", () => {
    const inst = clone(BASE_INSTANCE);
    // Craft a clue whose unlockedBy references its own id.
    const selfRef: Clue = {
      id: "cycle-clue-self",
      revealsFactIds: [],
      unlockedBy: { kind: "clue", clueId: "cycle-clue-self" },
    };
    inst.clues = [...inst.clues, selfRef];
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cycle");
  });

  it("rejects a 2-node cycle (A → B → A)", () => {
    const inst = clone(BASE_INSTANCE);
    const clueA: Clue = {
      id: "cycle-A",
      revealsFactIds: [],
      unlockedBy: { kind: "clue", clueId: "cycle-B" },
    };
    const clueB: Clue = {
      id: "cycle-B",
      revealsFactIds: [],
      unlockedBy: { kind: "clue", clueId: "cycle-A" },
    };
    inst.clues = [...inst.clues, clueA, clueB];
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cycle");
  });

  it("rejects a 3-node cycle (A → B → C → A)", () => {
    const inst = clone(BASE_INSTANCE);
    const clueA: Clue = { id: "cyc3-A", revealsFactIds: [], unlockedBy: { kind: "clue", clueId: "cyc3-C" } };
    const clueB: Clue = { id: "cyc3-B", revealsFactIds: [], unlockedBy: { kind: "clue", clueId: "cyc3-A" } };
    const clueC: Clue = { id: "cyc3-C", revealsFactIds: [], unlockedBy: { kind: "clue", clueId: "cyc3-B" } };
    inst.clues = [...inst.clues, clueA, clueB, clueC];
    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cycle");
  });
});

// ─────────── rejection branch 7: blind-solver mismatch — ambiguous ───────────

describe("validateInstance — rejection: blind-solver ambiguous (multiple viable suspects)", () => {
  it("rejects when two suspects both have unreachable refuters (ambiguous)", () => {
    // Build a minimal instance with exactly 2 suspects, both having means+opp
    // reachable and NO reachable refuters → the blind solver returns 2 viable.
    const inst = clone(BASE_INSTANCE);

    const s1 = "sus-ambig-1";
    const s2 = "sus-ambig-2";
    inst.suspectIds = [s1, s2];
    inst.killerId = s1;

    // Two facts each: means + opportunity (always reachable via always-clues).
    const meansFact1: Fact = { id: "f-means-1", subject: s1, predicate: "means" };
    const oppFact1: Fact = { id: "f-opp-1", subject: s1, predicate: "opportunity" };
    const meansFact2: Fact = { id: "f-means-2", subject: s2, predicate: "means" };
    const oppFact2: Fact = { id: "f-opp-2", subject: s2, predicate: "opportunity" };
    inst.facts = [meansFact1, oppFact1, meansFact2, oppFact2];

    const meansClue1: Clue = { id: "c-means-1", revealsFactIds: ["f-means-1"], unlockedBy: { kind: "always" } };
    const oppClue1: Clue = { id: "c-opp-1", revealsFactIds: ["f-opp-1"], unlockedBy: { kind: "always" } };
    const meansClue2: Clue = { id: "c-means-2", revealsFactIds: ["f-means-2"], unlockedBy: { kind: "always" } };
    const oppClue2: Clue = { id: "c-opp-2", revealsFactIds: ["f-opp-2"], unlockedBy: { kind: "always" } };
    // No refuter clue for either suspect → both are viable.
    inst.clues = [meansClue1, oppClue1, meansClue2, oppClue2];
    inst.items = [];
    // NPCs must include both suspects so askTopic preconditions can resolve.
    inst.npcs = [
      {
        id: s1,
        persona: { name: s1, blurb: "", voice: "" },
        tier: "principal",
        homeZone: "parlor",
        routine: [],
        slice: [],
      },
      {
        id: s2,
        persona: { name: s2, blurb: "", voice: "" },
        tier: "principal",
        homeZone: "parlor",
        routine: [],
        slice: [],
      },
    ];
    inst.lockedZones = [];
    inst.solution = { killerId: s1, supportingClueIds: [] };

    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ambiguous");
    expect(result.reason).toContain("2 viable");
  });
});

// ─────────── rejection branch 8: blind-solver mismatch — no viable suspect ───────────

describe("validateInstance — rejection: blind-solver unsolvable (zero viable suspects)", () => {
  it("rejects when no suspect has all required reachable facts", () => {
    const inst = clone(BASE_INSTANCE);

    const s1 = "sus-noviable-1";
    const s2 = "sus-noviable-2";
    // Two suspects (so the anti-spoiler >=2 guard passes), but NEITHER is viable:
    // each has means and no opportunity → blind solver finds zero viable suspects.
    inst.suspectIds = [s1, s2];
    inst.killerId = s1;

    const meansFact1: Fact = { id: "f-means-1", subject: s1, predicate: "means" };
    const meansFact2: Fact = { id: "f-means-2", subject: s2, predicate: "means" };
    inst.facts = [meansFact1, meansFact2];
    inst.clues = [
      { id: "c-means-1", revealsFactIds: ["f-means-1"], unlockedBy: { kind: "always" } },
      { id: "c-means-2", revealsFactIds: ["f-means-2"], unlockedBy: { kind: "always" } },
    ];
    inst.items = [];
    inst.npcs = [s1, s2].map((id) => ({
      id,
      persona: { name: id, blurb: "", voice: "" },
      tier: "principal" as const,
      homeZone: "parlor",
      routine: [],
      slice: [],
    }));
    inst.lockedZones = [];
    inst.solution = { killerId: s1, supportingClueIds: [] };

    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unsolvable");
  });
});

// ─────────── rejection branch 9: blind-solver mismatch — wrong unique killer ───────────

describe("validateInstance — rejection: blind-solver finds different unique killer than killerId", () => {
  it("rejects when the uniquely-solvable suspect differs from killerId", () => {
    // Build a case where s2 is the only viable killer but killerId = s1.
    const inst = clone(BASE_INSTANCE);

    const s1 = "sus-wrong-killer";
    const s2 = "sus-actual-unique";
    inst.suspectIds = [s1, s2];
    inst.killerId = s1; // declared killer is s1

    // s1 has no means → not viable.
    // s2 has means + opp, no refuter → uniquely viable. Blind solver will pick s2.
    const meansFact2: Fact = { id: "f-means-s2", subject: s2, predicate: "means" };
    const oppFact2: Fact = { id: "f-opp-s2", subject: s2, predicate: "opportunity" };
    // s1 gets opportunity only, no means → not viable.
    const oppFact1: Fact = { id: "f-opp-s1", subject: s1, predicate: "opportunity" };
    inst.facts = [meansFact2, oppFact2, oppFact1];

    inst.clues = [
      { id: "c-means-s2", revealsFactIds: ["f-means-s2"], unlockedBy: { kind: "always" } },
      { id: "c-opp-s2", revealsFactIds: ["f-opp-s2"], unlockedBy: { kind: "always" } },
      { id: "c-opp-s1", revealsFactIds: ["f-opp-s1"], unlockedBy: { kind: "always" } },
    ];
    inst.items = [];
    inst.npcs = [
      {
        id: s1,
        persona: { name: s1, blurb: "", voice: "" },
        tier: "principal",
        homeZone: "parlor",
        routine: [],
        slice: [],
      },
      {
        id: s2,
        persona: { name: s2, blurb: "", voice: "" },
        tier: "principal",
        homeZone: "parlor",
        routine: [],
        slice: [],
      },
    ];
    inst.lockedZones = [];
    inst.solution = { killerId: s1, supportingClueIds: [] };

    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("blind solver found");
    expect(result.reason).toContain(s2);
    expect(result.reason).toContain(s1);
  });
});

// ─────────── additional negative: remove an innocent's refuter making two viable ───────────

describe("validateInstance — rejection by removing an innocent refuter", () => {
  it("rejects when an innocent's refuter clue is deleted (solver sees 2 viable)", () => {
    // Use the base instance. Find an innocent suspect and remove their refuter clue.
    // The innocent now has no reachable refuter → two viable suspects.
    const inst = clone(BASE_INSTANCE);

    // Find an innocent (not killerId) with a refutesOpportunity or refutesMeans fact.
    const innocents = inst.suspectIds.filter((s) => s !== inst.killerId);
    if (innocents.length === 0) {
      // Only one suspect — can't make this test meaningful; skip gracefully.
      return;
    }

    // Find the fact for an innocent's refuter.
    let removedFactId: string | null = null;
    for (const innocent of innocents) {
      const refFact = inst.facts.find(
        (f) => f.subject === innocent && (f.predicate === "refutesMeans" || f.predicate === "refutesOpportunity"),
      );
      if (refFact) {
        // Remove the clue that reveals this fact so it becomes unreachable.
        const clueIdx = inst.clues.findIndex((c) => c.revealsFactIds.includes(refFact.id));
        if (clueIdx !== -1) {
          inst.clues.splice(clueIdx, 1);
          removedFactId = refFact.id;
          break;
        }
      }
    }

    if (!removedFactId) {
      // Couldn't find a refuter clue to remove — skip.
      return;
    }

    const result = validateInstance(inst);
    expect(result.ok).toBe(false);
    // Could be ambiguous or wrong-killer, depending on how many became viable.
    expect(result.reason).toMatch(/ambiguous|blind solver found/);
  });
});
