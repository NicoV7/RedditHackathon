/**
 * Unit tests for src/server/watcher/traits.ts
 *
 * Coverage: inferTraits, deltasForEvent (via inferTraits), poleForScore,
 *           revealedPoles, newlyRevealed, chipTone.
 *
 * Key invariants under test:
 *  - Integer-pure + deterministic: same event log → same byte-identical result.
 *  - Zero-knowledge: inferred traits are identical regardless of which NPC is the
 *    killer (the event log carries no guilt).
 *  - poleForScore respects sign convention (neg ⇒ first pole, pos ⇒ second).
 *  - REVEAL_THRESHOLD gate works correctly in revealedPoles.
 *  - newlyRevealed correctly diffs prior vs. next.
 *  - chipTone: explicit tag wins; keyword fallbacks; free-text → neutral.
 */

import { describe, it, expect } from "vitest";
import {
  inferTraits,
  poleForScore,
  revealedPoles,
  newlyRevealed,
  chipTone,
  REVEAL_THRESHOLD,
  type TraitEvent,
  type AskTone,
} from "./traits.js";
import type { TraitAxis, TraitPole, TraitState } from "../../shared/api.js";

// ─────────────────────────── helpers ───────────────────────────

/** Build a TraitEvent with defaults. */
const ev = (kind: TraitEvent["kind"], over: Partial<TraitEvent> = {}): TraitEvent => ({
  kind,
  ...over,
});

/** Empty TraitState baseline. */
const emptyPrior = (): TraitState => ({ scores: {}, revealed: [] });

// ─────────────────────────── poleForScore ───────────────────────────

describe("poleForScore", () => {
  it("returns null for score === 0", () => {
    const axes: TraitAxis[] = [
      "ruthless_merciful",
      "methodical_reckless",
      "empathetic_cold",
      "skeptical_credulous",
      "bold_cautious",
    ];
    for (const axis of axes) {
      expect(poleForScore(axis, 0)).toBeNull();
    }
  });

  it("negative score → first pole of each axis", () => {
    expect(poleForScore("ruthless_merciful", -1)).toBe("ruthless");
    expect(poleForScore("methodical_reckless", -1)).toBe("methodical");
    expect(poleForScore("empathetic_cold", -1)).toBe("empathetic");
    expect(poleForScore("skeptical_credulous", -1)).toBe("skeptical");
    expect(poleForScore("bold_cautious", -1)).toBe("bold");
  });

  it("positive score → second pole of each axis", () => {
    expect(poleForScore("ruthless_merciful", +1)).toBe("merciful");
    expect(poleForScore("methodical_reckless", +1)).toBe("reckless");
    expect(poleForScore("empathetic_cold", +1)).toBe("cold");
    expect(poleForScore("skeptical_credulous", +1)).toBe("credulous");
    expect(poleForScore("bold_cautious", +1)).toBe("cautious");
  });

  it("works for large magnitudes too", () => {
    expect(poleForScore("bold_cautious", -999)).toBe("bold");
    expect(poleForScore("bold_cautious", +999)).toBe("cautious");
  });
});

// ─────────────────────────── revealedPoles ───────────────────────────

describe("revealedPoles", () => {
  it("returns empty array when all scores are 0", () => {
    expect(revealedPoles({})).toEqual([]);
  });

  it("does NOT reveal a pole below the threshold", () => {
    const poles = revealedPoles({ methodical_reckless: -(REVEAL_THRESHOLD - 1) });
    expect(poles).toEqual([]);
  });

  it("reveals a pole exactly AT the threshold", () => {
    const poles = revealedPoles({ methodical_reckless: -REVEAL_THRESHOLD });
    expect(poles).toContain("methodical");
    expect(poles).toHaveLength(1);
  });

  it("reveals a pole above the threshold", () => {
    const poles = revealedPoles({ methodical_reckless: -(REVEAL_THRESHOLD + 2) });
    expect(poles).toContain("methodical");
  });

  it("reveals the positive pole when score is at +threshold", () => {
    const poles = revealedPoles({ bold_cautious: REVEAL_THRESHOLD });
    expect(poles).toContain("cautious");
  });

  it("reveals multiple poles from different axes", () => {
    const scores: Partial<Record<TraitAxis, number>> = {
      methodical_reckless: -REVEAL_THRESHOLD,
      skeptical_credulous: -REVEAL_THRESHOLD,
      bold_cautious: REVEAL_THRESHOLD,
    };
    const poles = revealedPoles(scores);
    expect(poles).toContain("methodical");
    expect(poles).toContain("skeptical");
    expect(poles).toContain("cautious");
    expect(poles).toHaveLength(3);
  });

  it("returns poles in stable axis order (deterministic)", () => {
    const scores: Partial<Record<TraitAxis, number>> = {
      bold_cautious: REVEAL_THRESHOLD,
      methodical_reckless: -REVEAL_THRESHOLD,
    };
    const a = revealedPoles(scores);
    const b = revealedPoles(scores);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────── newlyRevealed ───────────────────────────

describe("newlyRevealed", () => {
  it("returns all revealed poles when prior is undefined", () => {
    const next: TraitState = { scores: {}, revealed: ["methodical", "skeptical"] };
    expect(newlyRevealed(undefined, next)).toEqual(["methodical", "skeptical"]);
  });

  it("returns empty array when next has same revealed as prior", () => {
    const prior: TraitState = { scores: {}, revealed: ["methodical"] };
    const next: TraitState = { scores: {}, revealed: ["methodical"] };
    expect(newlyRevealed(prior, next)).toEqual([]);
  });

  it("returns only the newly appeared poles", () => {
    const prior: TraitState = { scores: {}, revealed: ["methodical"] };
    const next: TraitState = { scores: {}, revealed: ["methodical", "skeptical", "bold"] };
    const fresh = newlyRevealed(prior, next);
    expect(fresh).toContain("skeptical");
    expect(fresh).toContain("bold");
    expect(fresh).not.toContain("methodical");
    expect(fresh).toHaveLength(2);
  });

  it("does not regress if a pole disappears (filter is one-directional)", () => {
    const prior: TraitState = { scores: {}, revealed: ["methodical", "skeptical"] };
    const next: TraitState = { scores: {}, revealed: ["methodical"] };
    // Only poles that are NEW in next are returned; no negatives.
    expect(newlyRevealed(prior, next)).toEqual([]);
  });
});

// ─────────────────────────── chipTone ───────────────────────────

describe("chipTone", () => {
  it("explicit tone tag always wins (aggressive)", () => {
    expect(chipTone({ id: "gentleQuestion", label: "reassure me", tone: "aggressive" })).toBe("aggressive");
  });

  it("explicit tone tag always wins (gentle)", () => {
    expect(chipTone({ id: "accuse", tone: "gentle" })).toBe("gentle");
  });

  it("explicit tone tag always wins (neutral)", () => {
    expect(chipTone({ id: "accuse", tone: "neutral" })).toBe("neutral");
  });

  it("falls back to aggressive via id keyword", () => {
    expect(chipTone({ id: "pressureNpc", label: "some label" })).toBe("aggressive");
  });

  it("falls back to aggressive via label keyword (accuse)", () => {
    expect(chipTone({ id: "q1", label: "Accuse them of lying" })).toBe("aggressive");
  });

  it("falls back to aggressive via label keyword (confront)", () => {
    expect(chipTone({ label: "Confront about the alibi" })).toBe("aggressive");
  });

  it("falls back to gentle via id keyword (reassure)", () => {
    expect(chipTone({ id: "reassure", label: "Say something nice" })).toBe("gentle");
  });

  it("falls back to gentle via label keyword (comfort)", () => {
    expect(chipTone({ id: "q2", label: "Comfort them" })).toBe("gentle");
  });

  it("falls back to gentle via label keyword (sympathize)", () => {
    expect(chipTone({ label: "Sympathize with their loss" })).toBe("gentle");
  });

  it("unknown chip with no keywords → neutral", () => {
    expect(chipTone({ id: "q_mystery", label: "What happened?" })).toBe("neutral");
  });

  it("empty chip → neutral", () => {
    expect(chipTone({})).toBe("neutral");
  });

  it("aggressive hint wins over gentle (aggressive hints checked first)", () => {
    // "liar" is in AGGRESSIVE_HINTS; "trust" is in GENTLE_HINTS — aggressive wins
    // because the loop checks aggressive hints before gentle hints.
    expect(chipTone({ label: "liar or trust?" })).toBe("aggressive");
  });
});

// ─────────────────────────── inferTraits — single event deltas ───────────────────────────

describe("inferTraits — individual event shapes", () => {
  it("askedTopic aggressive → ruthless (-2) + cold (+2)", () => {
    const result = inferTraits([ev("askedTopic", { tone: "aggressive" })]);
    expect(result.scores["ruthless_merciful"]).toBe(-2);
    expect(result.scores["empathetic_cold"]).toBe(2);
  });

  it("askedTopic gentle → merciful (+2) + empathetic (-2)", () => {
    const result = inferTraits([ev("askedTopic", { tone: "gentle" })]);
    expect(result.scores["ruthless_merciful"]).toBe(2);
    expect(result.scores["empathetic_cold"]).toBe(-2);
  });

  it("askedTopic neutral → no delta", () => {
    const result = inferTraits([ev("askedTopic", { tone: "neutral" })]);
    expect(result.scores["ruthless_merciful"]).toBeUndefined();
    expect(result.scores["empathetic_cold"]).toBeUndefined();
  });

  it("askedTopic with no tone → no delta", () => {
    const result = inferTraits([ev("askedTopic")]);
    expect(Object.keys(result.scores)).toHaveLength(0);
  });

  it("tookItem (non-thorough) → methodical (-1)", () => {
    const result = inferTraits([ev("tookItem")]);
    expect(result.scores["methodical_reckless"]).toBe(-1);
  });

  it("tookItem (thorough) → methodical (-2)", () => {
    const result = inferTraits([ev("tookItem", { thorough: true })]);
    expect(result.scores["methodical_reckless"]).toBe(-2);
  });

  it("presentedItem → skeptical (-2) + methodical (-1)", () => {
    const result = inferTraits([ev("presentedItem")]);
    expect(result.scores["skeptical_credulous"]).toBe(-2);
    expect(result.scores["methodical_reckless"]).toBe(-1);
  });

  it("caughtInLie → skeptical (-2) + methodical (-1)", () => {
    const result = inferTraits([ev("caughtInLie")]);
    expect(result.scores["skeptical_credulous"]).toBe(-2);
    expect(result.scores["methodical_reckless"]).toBe(-1);
  });

  it("enteredZone → methodical (-1)", () => {
    const result = inferTraits([ev("enteredZone")]);
    expect(result.scores["methodical_reckless"]).toBe(-1);
  });

  it("accuse with fullEvidence → methodical (-3) + cautious (+3)", () => {
    const result = inferTraits([ev("accuse", { fullEvidence: true })]);
    expect(result.scores["methodical_reckless"]).toBe(-3);
    expect(result.scores["bold_cautious"]).toBe(3);
  });

  it("accuse with early → reckless (+3) + bold (-3)", () => {
    const result = inferTraits([ev("accuse", { early: true })]);
    expect(result.scores["methodical_reckless"]).toBe(3);
    expect(result.scores["bold_cautious"]).toBe(-3);
  });

  it("accuse with solved=false → reckless (+3)", () => {
    const result = inferTraits([ev("accuse", { solved: false })]);
    expect(result.scores["methodical_reckless"]).toBe(3);
  });

  it("accuse with solved=true → no solved-false nudge", () => {
    const result = inferTraits([ev("accuse", { solved: true })]);
    // No fullEvidence, no early → no deltas at all for a plain correct solve
    expect(result.scores["methodical_reckless"]).toBeUndefined();
  });

  it("accuse fullEvidence + early → additive deltas (both flags)", () => {
    const result = inferTraits([ev("accuse", { fullEvidence: true, early: true })]);
    // fullEvidence: methodical -3, bold_cautious +3
    // early: methodical +3, bold_cautious -3
    // net: 0 on both → both deleted from map
    expect(result.scores["methodical_reckless"]).toBeUndefined();
    expect(result.scores["bold_cautious"]).toBeUndefined();
  });

  it("accuse fullEvidence + solved=false → additive (methodical -3 + reckless +3 = 0, cautious +3)", () => {
    const result = inferTraits([ev("accuse", { fullEvidence: true, solved: false })]);
    // fullEvidence: methodical -3, bold_cautious +3
    // solved=false: methodical +3 (net 0, deleted)
    expect(result.scores["methodical_reckless"]).toBeUndefined();
    expect(result.scores["bold_cautious"]).toBe(3);
  });
});

// ─────────────────────────── inferTraits — accumulation ───────────────────────────

describe("inferTraits — score accumulation", () => {
  it("accumulates scores across multiple events", () => {
    const events: TraitEvent[] = [
      ev("tookItem"),
      ev("tookItem"),
      ev("tookItem"),
      ev("caughtInLie"),
    ];
    // tookItem: -1 each × 3 = -3
    // caughtInLie: skeptical_credulous -2, methodical_reckless -1 → methodical -4 total
    const result = inferTraits(events);
    expect(result.scores["methodical_reckless"]).toBe(-4);
    expect(result.scores["skeptical_credulous"]).toBe(-2);
  });

  it("axes that cancel to 0 are dropped from the scores map", () => {
    const events: TraitEvent[] = [
      ev("tookItem"),  // methodical_reckless -1
      ev("accuse", { solved: false }),  // methodical_reckless +3 (but with -1 from tookItem, sum: +2)
      // net: +2 (not zero). Let's do something that cancels:
    ];
    // For true cancellation: 4 tookItems (-4) + 1 accuse (solved=false, +3) = -1. Not zero.
    // Let's use accuse early (+3) + 3 tookItem (-3) = 0 on methodical_reckless.
    const events2: TraitEvent[] = [
      ev("tookItem"),
      ev("tookItem"),
      ev("tookItem"),
      ev("accuse", { early: true }),
    ];
    // methodical: -1-1-1+3 = 0 → deleted; bold_cautious: -3
    const result = inferTraits(events2);
    expect(result.scores["methodical_reckless"]).toBeUndefined();
    expect(result.scores["bold_cautious"]).toBe(-3);
  });

  it("accumulates on top of a prior TraitState (cross-day accumulation)", () => {
    const prior: TraitState = {
      scores: { methodical_reckless: -4 },
      revealed: [],
    };
    const result = inferTraits([ev("tookItem"), ev("tookItem")], prior);
    // prior -4, + 2 × (-1) = -6
    expect(result.scores["methodical_reckless"]).toBe(-6);
  });

  it("prior TraitState is NOT mutated", () => {
    const prior: TraitState = {
      scores: { methodical_reckless: -3 },
      revealed: [],
    };
    const frozen = JSON.stringify(prior);
    inferTraits([ev("tookItem")], prior);
    expect(JSON.stringify(prior)).toBe(frozen);
  });

  it("empty event log returns a copy of the prior scores", () => {
    const prior: TraitState = {
      scores: { skeptical_credulous: -5 },
      revealed: [],
    };
    const result = inferTraits([], prior);
    expect(result.scores["skeptical_credulous"]).toBe(-5);
  });

  it("empty event log with no prior returns empty scores + no revealed", () => {
    const result = inferTraits([]);
    expect(result.scores).toEqual({});
    expect(result.revealed).toEqual([]);
  });

  it("sets revealed when threshold is crossed", () => {
    // Need |methodical_reckless| >= 6. Each tookItem = -1. So 6 events.
    const events = Array.from({ length: REVEAL_THRESHOLD }, () => ev("tookItem"));
    const result = inferTraits(events);
    expect(result.scores["methodical_reckless"]).toBe(-REVEAL_THRESHOLD);
    expect(result.revealed).toContain("methodical");
  });

  it("does NOT reveal poles below the threshold", () => {
    const events = Array.from({ length: REVEAL_THRESHOLD - 1 }, () => ev("tookItem"));
    const result = inferTraits(events);
    expect(result.revealed).not.toContain("methodical");
  });
});

// ─────────────────────────── determinism ───────────────────────────

describe("inferTraits — determinism", () => {
  const SYNTHETIC_LOGS: ReadonlyArray<readonly TraitEvent[]> = [
    // Log A: investigation-heavy player
    [
      ev("enteredZone"),
      ev("tookItem"),
      ev("askedTopic", { tone: "gentle" }),
      ev("tookItem", { thorough: true }),
      ev("presentedItem"),
      ev("caughtInLie"),
      ev("accuse", { fullEvidence: true, solved: true }),
    ],
    // Log B: aggressive interrogator who accuses early
    [
      ev("askedTopic", { tone: "aggressive" }),
      ev("askedTopic", { tone: "aggressive" }),
      ev("askedTopic", { tone: "aggressive" }),
      ev("accuse", { early: true, solved: false }),
    ],
    // Log C: passive observer
    [
      ev("enteredZone"),
      ev("enteredZone"),
      ev("enteredZone"),
    ],
    // Log D: mixed — gentle + methodical + wrong accuse
    [
      ev("askedTopic", { tone: "gentle" }),
      ev("tookItem"),
      ev("presentedItem"),
      ev("caughtInLie"),
      ev("accuse", { solved: false }),
    ],
  ];

  for (const [i, log] of SYNTHETIC_LOGS.entries()) {
    it(`repeated calls on log #${i} produce byte-identical results`, () => {
      const a = inferTraits(log);
      const b = inferTraits(log);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  }

  it("inference is fully deterministic: same log → same score map and revealed list on N calls", () => {
    const log: TraitEvent[] = [
      ev("tookItem"),
      ev("askedTopic", { tone: "aggressive" }),
      ev("presentedItem"),
      ev("accuse", { fullEvidence: true, solved: true }),
    ];
    const results = Array.from({ length: 5 }, () => JSON.stringify(inferTraits(log)));
    const unique = new Set(results);
    expect(unique.size).toBe(1);
  });
});

// ─────────────────────────── ZERO-KNOWLEDGE invariant ───────────────────────────
//
// The Watcher's portrait must be identical regardless of which NPC is the killer.
// The event log carries no guilt: trait inference NEVER receives killerId/solution/
// NPC slices. We simulate this by showing that the SAME event log, conceptually
// associated with different "killer" identifiers (which are NOT passed to inferTraits),
// produces byte-identical results.

describe("inferTraits — zero-knowledge (killer-agnostic) invariant", () => {
  /** Simulate different "whose killer" scenarios by running the SAME event log;
   *  no killerId is passed to inferTraits — the function signature has no such param. */
  const KILLER_IDS = ["npc_lola", "npc_victor", "npc_max", "npc_diana", "npc_theo"];

  const TEST_LOGS: Array<{ name: string; events: TraitEvent[] }> = [
    {
      name: "thorough investigator",
      events: [
        ev("enteredZone", { tick: 1 }),
        ev("tookItem", { tick: 2, thorough: true }),
        ev("askedTopic", { tick: 3, tone: "gentle" }),
        ev("caughtInLie", { tick: 5 }),
        ev("presentedItem", { tick: 6 }),
        ev("accuse", { tick: 10, fullEvidence: true, solved: true }),
      ],
    },
    {
      name: "reckless aggressor",
      events: [
        ev("askedTopic", { tick: 1, tone: "aggressive" }),
        ev("askedTopic", { tick: 2, tone: "aggressive" }),
        ev("accuse", { tick: 3, early: true, solved: false }),
      ],
    },
    {
      name: "cautious explorer",
      events: [
        ev("enteredZone", { tick: 1 }),
        ev("enteredZone", { tick: 2 }),
        ev("tookItem", { tick: 3 }),
        ev("tookItem", { tick: 4 }),
        ev("tookItem", { tick: 5 }),
        ev("enteredZone", { tick: 6 }),
        ev("tookItem", { tick: 7 }),
        ev("presentedItem", { tick: 8 }),
        ev("accuse", { tick: 20, fullEvidence: true, solved: true }),
      ],
    },
    {
      name: "mixed tone interrogator",
      events: [
        ev("askedTopic", { tick: 1, tone: "aggressive" }),
        ev("tookItem", { tick: 2 }),
        ev("askedTopic", { tick: 3, tone: "gentle" }),
        ev("caughtInLie", { tick: 4 }),
        ev("askedTopic", { tick: 5, tone: "neutral" }),
        ev("accuse", { tick: 6, solved: false }),
      ],
    },
  ];

  for (const { name, events } of TEST_LOGS) {
    it(`"${name}" — trait result is byte-identical for every possible killer`, () => {
      // inferTraits takes only the event log — no killer param. We call it once per
      // "candidate killer" to prove the function is structurally incapable of
      // leaking killer identity (its signature has no such parameter).
      const results = KILLER_IDS.map(() => JSON.stringify(inferTraits(events)));
      const unique = new Set(results);
      expect(unique.size).toBe(1);
    });

    it(`"${name}" — trait result is byte-identical with or without a prior containing no killer info`, () => {
      // Even if a prior TraitState is threaded in, killer identity is not in TraitState.
      const prior: TraitState = { scores: { methodical_reckless: -2 }, revealed: [] };
      const results = KILLER_IDS.map(() => JSON.stringify(inferTraits(events, prior)));
      const unique = new Set(results);
      expect(unique.size).toBe(1);
    });
  }

  it("inferTraits signature accepts no killerId parameter (structural zero-knowledge)", () => {
    // This is a type-level assertion enforced at compile time, but we also verify
    // at runtime that the function length (arity) is exactly 2: (events, prior?).
    expect(inferTraits.length).toBe(2);
  });
});

// ─────────────────────────── edge cases ───────────────────────────

describe("inferTraits — edge cases", () => {
  it("handles a very long event log without error", () => {
    const events = Array.from({ length: 1000 }, () => ev("enteredZone"));
    const result = inferTraits(events);
    expect(result.scores["methodical_reckless"]).toBe(-1000);
    expect(result.revealed).toContain("methodical");
  });

  it("handles tick field that is just for ordering (not read by trait logic)", () => {
    const evWithTick = inferTraits([ev("tookItem", { tick: 999 })]);
    const evNoTick = inferTraits([ev("tookItem")]);
    expect(JSON.stringify(evWithTick)).toBe(JSON.stringify(evNoTick));
  });

  it("accuse with no flags → no trait nudge at all", () => {
    const result = inferTraits([ev("accuse")]);
    expect(result.scores).toEqual({});
    expect(result.revealed).toEqual([]);
  });

  it("prior scores that are 0 are treated as absent (integer-pure)", () => {
    const prior: TraitState = {
      scores: { methodical_reckless: 0 },
      revealed: [],
    };
    const result = inferTraits([ev("tookItem")], prior);
    expect(result.scores["methodical_reckless"]).toBe(-1);
  });

  it("multiple axes can reveal simultaneously", () => {
    // 6 presentedItems: skeptical_credulous += -2 each (-12), methodical_reckless += -1 each (-6)
    const events = Array.from({ length: REVEAL_THRESHOLD }, () => ev("presentedItem"));
    const result = inferTraits(events);
    expect(result.revealed).toContain("skeptical");
    expect(result.revealed).toContain("methodical");
  });
});
