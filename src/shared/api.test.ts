import { describe, it, expect } from "vitest";
import { toClientView } from "./api.js";
import type { CaseInstance, Npc, Item, Fact, Clue } from "./case.js";

// ---------------------------------------------------------------------------
// Minimal CaseInstance fixture — only the fields toClientView() touches.
// ---------------------------------------------------------------------------

const makeInstance = (): CaseInstance => {
  const npcs: Npc[] = [
    {
      id: "npc-1",
      persona: { name: "Vera Nox", blurb: "The pianist.", voice: "dry, sardonic" },
      tier: "principal",
      homeZone: "bar",
      routine: [{ zoneId: "bar", fromTick: 0, toTick: 100, activity: "playing piano" }],
      slice: [{ factId: "f-means-1", statedAs: "statedLie" }],
      quirks: ["nervous-hands"],
    },
    {
      id: "npc-2",
      persona: { name: "Cedric Holt", blurb: "The barkeep.", voice: "jovial" },
      tier: "supporting",
      homeZone: "bar",
      routine: [],
      slice: [{ factId: "f-opp-1", statedAs: "true" }],
    },
  ];

  const items: Item[] = [
    {
      id: "item-1",
      kind: "weapon",
      zone: "kitchen",
      coords: { x: 3, y: 7 },
      examineText: "A serrated bread knife, recently cleaned.",
      revealsFactIds: ["f-means-1"],
      presentReactions: [
        { npcId: "npc-1", revealsFactIds: ["f-opp-1"] },
      ],
    },
  ];

  const facts: Fact[] = [
    { id: "f-means-1", subject: "npc-1", predicate: "means" },
    { id: "f-opp-1", subject: "npc-1", predicate: "opportunity" },
    { id: "f-refute-1", subject: "npc-2", predicate: "refutesOpportunity" },
  ];

  const clues: Clue[] = [
    {
      id: "clue-1",
      revealsFactIds: ["f-means-1"],
      unlockedBy: { kind: "always" },
    },
    {
      id: "clue-2",
      revealsFactIds: ["f-opp-1"],
      unlockedBy: { kind: "clue", clueId: "clue-1" },
    },
  ];

  return {
    templateId: "template-noir-001",
    instanceSeed: "player-seed-abc",
    suspectIds: ["npc-1", "npc-2"],
    killerId: "npc-1",                          // SECRET — must NOT reach client
    facts,                                       // SECRET — must NOT reach client
    clues,                                       // SECRET — must NOT reach client
    items,
    npcs,
    lockedZones: [],
    solution: { killerId: "npc-1", supportingClueIds: ["clue-1", "clue-2"] }, // SECRET
  };
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("toClientView() — security sanitization", () => {
  const DAILY_SEED = "2026-06-28";
  const instance = makeInstance();
  const view = toClientView(instance, DAILY_SEED);
  const serialized = JSON.stringify(view);

  // ── 1. killerId never leaks ──────────────────────────────────────────────
  it("does NOT expose killerId anywhere in the serialized output", () => {
    expect(serialized).not.toContain('"killerId"');
    // Also check the known killer value itself doesn't appear under that key
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "killerId")).toBe(false);
  });

  // ── 2. solution never leaks ───────────────────────────────────────────────
  it("does NOT expose solution anywhere in the serialized output", () => {
    expect(serialized).not.toContain('"solution"');
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "solution")).toBe(false);
  });

  // ── 3. facts (the structural deduction graph) never leak ─────────────────
  it("does NOT expose facts anywhere in the serialized output", () => {
    expect(serialized).not.toContain('"facts"');
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "facts")).toBe(false);
  });

  // ── 4. clues (graph edges with fact-reveals) never leak ──────────────────
  it("does NOT expose clues anywhere in the serialized output", () => {
    expect(serialized).not.toContain('"clues"');
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "clues")).toBe(false);
  });

  // ── 5. NPC slice projections (statedLie / factId refs) never leak ─────────
  it("does NOT expose NPC slice on any ClientNpcView", () => {
    expect(serialized).not.toContain('"slice"');
    for (const npc of view.npcs) {
      expect(Object.prototype.hasOwnProperty.call(npc, "slice")).toBe(false);
    }
  });

  // ── 6. NPC quirks (internal flavor) never leak ───────────────────────────
  it("does NOT expose NPC quirks on any ClientNpcView", () => {
    expect(serialized).not.toContain('"quirks"');
    for (const npc of view.npcs) {
      expect(Object.prototype.hasOwnProperty.call(npc, "quirks")).toBe(false);
    }
  });

  // ── 7. Item examineText never leaks (server reveals via examine endpoint) ─
  it("does NOT expose item examineText in the client item view", () => {
    expect(serialized).not.toContain('"examineText"');
    for (const item of view.items) {
      expect(Object.prototype.hasOwnProperty.call(item, "examineText")).toBe(false);
    }
  });

  // ── 8. Item presentReactions (structural reveal graph) never leak ─────────
  it("does NOT expose item presentReactions in the client item view", () => {
    expect(serialized).not.toContain('"presentReactions"');
    for (const item of view.items) {
      expect(Object.prototype.hasOwnProperty.call(item, "presentReactions")).toBe(false);
    }
  });

  // ── 9. Item revealsFactIds never leak ────────────────────────────────────
  it("does NOT expose item revealsFactIds in the client item view", () => {
    expect(serialized).not.toContain('"revealsFactIds"');
    for (const item of view.items) {
      expect(Object.prototype.hasOwnProperty.call(item, "revealsFactIds")).toBe(false);
    }
  });

  // ── 10. statedAs / statedLie strings never appear ─────────────────────────
  it("does NOT expose statedAs truthfulness markers anywhere", () => {
    expect(serialized).not.toContain('"statedAs"');
    expect(serialized).not.toContain("statedLie");
  });

  // ── 11. instanceSeed never leaks ──────────────────────────────────────────
  it("does NOT expose the private instanceSeed", () => {
    expect(serialized).not.toContain('"instanceSeed"');
  });

  // ── 12. Correct public fields ARE present ─────────────────────────────────
  it("carries the correct public fields: caseId, dailySeed, suspectIds, npcs, items, map", () => {
    expect(view.caseId).toBe("template-noir-001");
    expect(view.dailySeed).toBe(DAILY_SEED);
    expect(view.suspectIds).toEqual(["npc-1", "npc-2"]);
    expect(view.npcs).toHaveLength(2);
    expect(view.items).toHaveLength(1);
    expect(view.map).toBeDefined();
  });

  // ── 13. ClientNpcView carries only the safe fields ─────────────────────────
  it("each ClientNpcView carries id, name, blurb, voice, tier, homeZone, routine and nothing else", () => {
    const npc = view.npcs[0]!;
    expect(npc.id).toBe("npc-1");
    expect(npc.name).toBe("Vera Nox");
    expect(npc.blurb).toBe("The pianist.");
    expect(npc.voice).toBe("dry, sardonic");
    expect(npc.tier).toBe("principal");
    expect(npc.homeZone).toBe("bar");
    expect(npc.routine).toHaveLength(1);
    // Safe subset only — no secret keys
    const keys = Object.keys(npc);
    expect(keys).toEqual(
      expect.arrayContaining(["id", "name", "blurb", "voice", "tier", "homeZone", "routine"])
    );
    expect(keys).not.toContain("slice");
    expect(keys).not.toContain("quirks");
    expect(keys).not.toContain("persona");
  });

  // ── 14. ClientItemView carries only id, kind, zone, coords ────────────────
  it("each ClientItemView carries id, kind, zone, coords and nothing else", () => {
    const item = view.items[0]!;
    expect(item.id).toBe("item-1");
    expect(item.kind).toBe("weapon");
    expect(item.zone).toBe("kitchen");
    expect(item.coords).toEqual({ x: 3, y: 7 });
    const keys = Object.keys(item);
    expect(keys).not.toContain("examineText");
    expect(keys).not.toContain("revealsFactIds");
    expect(keys).not.toContain("presentReactions");
  });

  // ── 15. dailySeed passes through correctly ────────────────────────────────
  it("passes the dailySeed argument through to the view unchanged", () => {
    const customSeed = "test-seed-xyz-789";
    const v = toClientView(makeInstance(), customSeed);
    expect(v.dailySeed).toBe(customSeed);
  });

  // ── 16. Multiple instances produce independent views ──────────────────────
  it("two separate calls produce independent (non-aliased) outputs", () => {
    const v1 = toClientView(makeInstance(), "seed-1");
    const v2 = toClientView(makeInstance(), "seed-2");
    expect(v1.dailySeed).not.toBe(v2.dailySeed);
    expect(v1).not.toBe(v2);
  });
});
