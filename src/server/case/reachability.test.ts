/**
 * Unit tests for src/server/case/reachability.ts
 *
 * Covers:
 *   - computeSurface(): locked zones, present-reaction chains, gated-door
 *     preconditions, clue-chain fixpoint, clue gating via all Precondition kinds.
 *   - satisfied(): each Precondition kind, including one that is never satisfiable
 *     (a clue whose prerequisite clue does not exist).
 *   - detectClueCycle(): cycle detection in the clue→clue precondition graph.
 */
import { describe, it, expect } from "vitest";
import type { CaseInstance, Clue, Item, Npc } from "../../shared/case.js";
import { computeSurface, detectClueCycle } from "./reachability.js";

// ─────────────────────────── FIXTURE HELPERS ───────────────────────────

function makeNpc(id: string, homeZone = "lobby"): Npc {
  return {
    id,
    persona: { name: id, blurb: id, voice: "flat" },
    tier: "principal",
    homeZone,
    routine: [{ zoneId: homeZone, fromTick: 0, toTick: 1, activity: "present" }],
    slice: [],
  };
}

function makeItem(id: string, zone: string, revealsFactIds: string[] = []): Item {
  return {
    id,
    kind: "document",
    zone,
    coords: { x: 0, y: 0 },
    examineText: `item ${id}`,
    revealsFactIds,
    presentReactions: [],
  };
}

function makeClue(id: string, revealsFactIds: string[], unlockedBy: Clue["unlockedBy"]): Clue {
  return { id, revealsFactIds, unlockedBy };
}

/** Minimal valid-enough CaseInstance for reachability tests (solver/validator not exercised). */
function baseInstance(overrides: Partial<CaseInstance> = {}): CaseInstance {
  return {
    templateId: "test",
    instanceSeed: "test",
    suspectIds: ["A"],
    killerId: "A",
    facts: [],
    clues: [],
    items: [],
    npcs: [],
    lockedZones: [],
    solution: { killerId: "A", supportingClueIds: [] },
    ...overrides,
  };
}

// ─────────────────────────── LOCKED ZONES ───────────────────────────

describe("computeSurface — locked zones", () => {
  it("items in an unlocked zone reveal their facts", () => {
    const inst = baseInstance({
      items: [makeItem("coin", "lobby", ["fact_coin"])],
      lockedZones: [],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_coin")).toBe(true);
  });

  it("items in a locked zone do NOT reveal their facts", () => {
    const inst = baseInstance({
      items: [makeItem("coin", "vault", ["fact_coin"])],
      lockedZones: ["vault"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_coin")).toBe(false);
  });

  it("locking one zone does not affect items in other unlocked zones", () => {
    const inst = baseInstance({
      items: [
        makeItem("coin", "vault", ["fact_vault"]),
        makeItem("note", "lobby", ["fact_lobby"]),
      ],
      lockedZones: ["vault"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_vault")).toBe(false);
    expect(surface.reachableFactIds.has("fact_lobby")).toBe(true);
  });

  it("undefined lockedZones is treated as empty (no lock)", () => {
    const inst = baseInstance({
      items: [makeItem("coin", "lobby", ["fact_coin"])],
      lockedZones: undefined,
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_coin")).toBe(true);
  });
});

// ─────────────────────────── PRESENT-REACTION CHAINS ───────────────────────────

describe("computeSurface — present-reaction chains", () => {
  it("showing a reachable item to an existing NPC reveals present-reaction facts", () => {
    const item: Item = {
      ...makeItem("knife", "lobby"),
      presentReactions: [{ npcId: "barkeep", revealsFactIds: ["fact_pr1"] }],
    };
    const inst = baseInstance({
      items: [item],
      npcs: [makeNpc("barkeep")],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_pr1")).toBe(true);
  });

  it("present-reaction for a non-existent NPC is NOT revealed", () => {
    const item: Item = {
      ...makeItem("knife", "lobby"),
      presentReactions: [{ npcId: "ghost", revealsFactIds: ["fact_ghost"] }],
    };
    const inst = baseInstance({
      items: [item],
      npcs: [], // ghost does not exist
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_ghost")).toBe(false);
  });

  it("present-reaction for an item in a LOCKED zone is NOT revealed even when NPC exists", () => {
    const item: Item = {
      ...makeItem("key", "vault"),
      presentReactions: [{ npcId: "barkeep", revealsFactIds: ["fact_locked_pr"] }],
    };
    const inst = baseInstance({
      items: [item],
      npcs: [makeNpc("barkeep")],
      lockedZones: ["vault"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_locked_pr")).toBe(false);
  });

  it("multiple present-reactions on one item each reveal their own facts independently", () => {
    const item: Item = {
      ...makeItem("ring", "lobby"),
      presentReactions: [
        { npcId: "alice", revealsFactIds: ["fact_alice"] },
        { npcId: "bob", revealsFactIds: ["fact_bob"] },
      ],
    };
    const inst = baseInstance({
      items: [item],
      npcs: [makeNpc("alice"), makeNpc("bob")],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_alice")).toBe(true);
    expect(surface.reachableFactIds.has("fact_bob")).toBe(true);
  });
});

// ─────────────────────────── GATED DOOR PRECONDITIONS ───────────────────────────

describe("computeSurface — gated-door preconditions (inspectItem)", () => {
  /**
   * Pattern: the alibi clue is gated by inspecting the "key" item.
   * When the key item is in an open zone, the gate is traversable.
   * When the key is in a locked zone, the gate is blocked.
   */
  const alibiClue = makeClue("alibi_c", ["alibi_fact"], { kind: "inspectItem", itemId: "key" });

  it("clue behind inspectItem gate is reachable when the key item is in an unlocked zone", () => {
    const inst = baseInstance({
      items: [makeItem("key", "lobby", [])],
      clues: [alibiClue],
      lockedZones: [],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("alibi_c")).toBe(true);
    expect(surface.reachableFactIds.has("alibi_fact")).toBe(true);
  });

  it("clue behind inspectItem gate is NOT reachable when the key item is in a locked zone", () => {
    const inst = baseInstance({
      items: [makeItem("key", "vault", [])],
      clues: [alibiClue],
      lockedZones: ["vault"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("alibi_c")).toBe(false);
    expect(surface.reachableFactIds.has("alibi_fact")).toBe(false);
  });

  it("clue behind inspectItem gate is NOT reachable when the item does not exist", () => {
    const inst = baseInstance({
      items: [], // key item absent entirely
      clues: [alibiClue],
      lockedZones: [],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("alibi_c")).toBe(false);
  });
});

// ─────────────────────────── CLUE GATING — ALL PRECONDITION KINDS ───────────────────────────

describe("computeSurface — clue precondition kinds", () => {
  it('kind="always": clue is immediately reachable with no dependencies', () => {
    const inst = baseInstance({
      clues: [makeClue("c_always", ["f_always"], { kind: "always" })],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_always")).toBe(true);
    expect(surface.reachableFactIds.has("f_always")).toBe(true);
  });

  it('kind="clue": clue is reachable only after its prerequisite clue is reached', () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", ["f1"], { kind: "always" }),
        makeClue("c2", ["f2"], { kind: "clue", clueId: "c1" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c1")).toBe(true);
    expect(surface.reachableClueIds.has("c2")).toBe(true);
    expect(surface.reachableFactIds.has("f2")).toBe(true);
  });

  it('kind="clue": clue with unmet prerequisite is NOT reachable', () => {
    const inst = baseInstance({
      clues: [
        // c_root is NOT present, so c_dep can never be reached
        makeClue("c_dep", ["f_dep"], { kind: "clue", clueId: "c_root" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_dep")).toBe(false);
    expect(surface.reachableFactIds.has("f_dep")).toBe(false);
  });

  it('kind="enterZone": clue is reachable when the zone is NOT locked', () => {
    const inst = baseInstance({
      clues: [makeClue("c_zone", ["f_zone"], { kind: "enterZone", zoneId: "parlor" })],
      lockedZones: [],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_zone")).toBe(true);
  });

  it('kind="enterZone": clue is NOT reachable when the zone IS locked', () => {
    const inst = baseInstance({
      clues: [makeClue("c_zone", ["f_zone"], { kind: "enterZone", zoneId: "parlor" })],
      lockedZones: ["parlor"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_zone")).toBe(false);
  });

  it('kind="askTopic": clue is reachable when the referenced NPC exists in the instance', () => {
    const inst = baseInstance({
      npcs: [makeNpc("butler")],
      clues: [makeClue("c_ask", ["f_ask"], { kind: "askTopic", npcId: "butler", topic: "whereabouts" })],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_ask")).toBe(true);
  });

  it('kind="askTopic": clue is NOT reachable when the NPC does not exist', () => {
    const inst = baseInstance({
      npcs: [],
      clues: [makeClue("c_ask", ["f_ask"], { kind: "askTopic", npcId: "ghost", topic: "whereabouts" })],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_ask")).toBe(false);
  });

  it('kind="presentItemTo": clue is reachable when item is in open zone AND NPC exists', () => {
    const inst = baseInstance({
      items: [makeItem("glove", "lobby")],
      npcs: [makeNpc("detective")],
      clues: [
        makeClue("c_present", ["f_present"], {
          kind: "presentItemTo",
          itemId: "glove",
          npcId: "detective",
        }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_present")).toBe(true);
    expect(surface.reachableFactIds.has("f_present")).toBe(true);
  });

  it('kind="presentItemTo": clue is NOT reachable when the item is in a locked zone', () => {
    const inst = baseInstance({
      items: [makeItem("glove", "vault")],
      npcs: [makeNpc("detective")],
      clues: [
        makeClue("c_present", ["f_present"], {
          kind: "presentItemTo",
          itemId: "glove",
          npcId: "detective",
        }),
      ],
      lockedZones: ["vault"],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_present")).toBe(false);
  });

  it('kind="presentItemTo": clue is NOT reachable when the NPC does not exist', () => {
    const inst = baseInstance({
      items: [makeItem("glove", "lobby")],
      npcs: [],
      clues: [
        makeClue("c_present", ["f_present"], {
          kind: "presentItemTo",
          itemId: "glove",
          npcId: "absent_npc",
        }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_present")).toBe(false);
  });

  it('kind="presentItemTo": clue is NOT reachable when the item does not exist', () => {
    const inst = baseInstance({
      items: [],
      npcs: [makeNpc("detective")],
      clues: [
        makeClue("c_present", ["f_present"], {
          kind: "presentItemTo",
          itemId: "missing_item",
          npcId: "detective",
        }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_present")).toBe(false);
  });
});

// ─────────────────────────── NEVER-SATISFIABLE PRECONDITION ───────────────────────────

describe("computeSurface — never-satisfiable precondition", () => {
  it("a clue whose prerequisite clue is absent from the instance is NEVER reachable (fixpoint terminates)", () => {
    // The prerequisite clue "c_missing" is not in the instance at all.
    // The fixpoint loop must terminate without reaching "c_dep".
    const inst = baseInstance({
      clues: [
        makeClue("c_dep", ["f_dep"], { kind: "clue", clueId: "c_missing" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_dep")).toBe(false);
    expect(surface.reachableFactIds.has("f_dep")).toBe(false);
    // Confirm the surface is otherwise empty — no phantom facts.
    expect(surface.reachableClueIds.size).toBe(0);
    expect(surface.reachableFactIds.size).toBe(0);
  });

  it("multiple chained clues are all blocked when the root prerequisite is missing", () => {
    // c1 ← c2 ← c3; c1 references a missing prerequisite
    const inst = baseInstance({
      clues: [
        makeClue("c1", ["f1"], { kind: "clue", clueId: "missing_root" }),
        makeClue("c2", ["f2"], { kind: "clue", clueId: "c1" }),
        makeClue("c3", ["f3"], { kind: "clue", clueId: "c2" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.size).toBe(0);
    expect(surface.reachableFactIds.size).toBe(0);
  });

  it("a never-satisfiable clue coexists with always-reachable clues without interference", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c_always", ["f_always"], { kind: "always" }),
        makeClue("c_impossible", ["f_impossible"], { kind: "clue", clueId: "ghost_clue" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c_always")).toBe(true);
    expect(surface.reachableFactIds.has("f_always")).toBe(true);
    expect(surface.reachableClueIds.has("c_impossible")).toBe(false);
    expect(surface.reachableFactIds.has("f_impossible")).toBe(false);
  });
});

// ─────────────────────────── FIXPOINT CHAIN ───────────────────────────

describe("computeSurface — clue-chain fixpoint", () => {
  it("resolves a deep chain: c1 → c2 → c3 → c4, each unlocking the next", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", ["f1"], { kind: "always" }),
        makeClue("c2", ["f2"], { kind: "clue", clueId: "c1" }),
        makeClue("c3", ["f3"], { kind: "clue", clueId: "c2" }),
        makeClue("c4", ["f4"], { kind: "clue", clueId: "c3" }),
      ],
    });
    const surface = computeSurface(inst);
    for (const id of ["c1", "c2", "c3", "c4"]) {
      expect(surface.reachableClueIds.has(id), `clue ${id} should be reachable`).toBe(true);
    }
    for (const id of ["f1", "f2", "f3", "f4"]) {
      expect(surface.reachableFactIds.has(id), `fact ${id} should be reachable`).toBe(true);
    }
  });

  it("a clue listed before its dependency in the array is still resolved (order-independent)", () => {
    // c2 depends on c1, but c2 appears first in the clues array.
    const inst = baseInstance({
      clues: [
        makeClue("c2", ["f2"], { kind: "clue", clueId: "c1" }),
        makeClue("c1", ["f1"], { kind: "always" }),
      ],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableClueIds.has("c1")).toBe(true);
    expect(surface.reachableClueIds.has("c2")).toBe(true);
  });

  it("a clue reveals multiple facts and all are collected", () => {
    const inst = baseInstance({
      clues: [makeClue("c_multi", ["fact_a", "fact_b", "fact_c"], { kind: "always" })],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("fact_a")).toBe(true);
    expect(surface.reachableFactIds.has("fact_b")).toBe(true);
    expect(surface.reachableFactIds.has("fact_c")).toBe(true);
  });

  it("item facts and clue facts are both accumulated in the same reachableFactIds set", () => {
    const inst = baseInstance({
      items: [makeItem("letter", "lobby", ["item_fact"])],
      clues: [makeClue("c_always", ["clue_fact"], { kind: "always" })],
    });
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("item_fact")).toBe(true);
    expect(surface.reachableFactIds.has("clue_fact")).toBe(true);
  });

  it("empty instance yields empty surface (no clues, no items, no NPCs)", () => {
    const surface = computeSurface(baseInstance());
    expect(surface.reachableClueIds.size).toBe(0);
    expect(surface.reachableFactIds.size).toBe(0);
  });
});

// ─────────────────────────── detectClueCycle ───────────────────────────

describe("detectClueCycle", () => {
  it("returns null for an acyclic chain", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", [], { kind: "always" }),
        makeClue("c2", [], { kind: "clue", clueId: "c1" }),
        makeClue("c3", [], { kind: "clue", clueId: "c2" }),
      ],
    });
    expect(detectClueCycle(inst)).toBeNull();
  });

  it("returns null when no clue depends on another (all always)", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", [], { kind: "always" }),
        makeClue("c2", [], { kind: "always" }),
      ],
    });
    expect(detectClueCycle(inst)).toBeNull();
  });

  it("returns null for an empty clue list", () => {
    expect(detectClueCycle(baseInstance())).toBeNull();
  });

  it("detects a direct self-cycle (c1 → c1)", () => {
    const inst = baseInstance({
      clues: [makeClue("c1", [], { kind: "clue", clueId: "c1" })],
    });
    const cycle = detectClueCycle(inst);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("c1");
  });

  it("detects a two-node cycle (c1 → c2 → c1)", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", [], { kind: "clue", clueId: "c2" }),
        makeClue("c2", [], { kind: "clue", clueId: "c1" }),
      ],
    });
    const cycle = detectClueCycle(inst);
    expect(cycle).not.toBeNull();
    // Both nodes must appear in the returned cycle path.
    expect(cycle).toContain("c1");
    expect(cycle).toContain("c2");
  });

  it("detects a three-node cycle (c1 → c2 → c3 → c1)", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c1", [], { kind: "clue", clueId: "c2" }),
        makeClue("c2", [], { kind: "clue", clueId: "c3" }),
        makeClue("c3", [], { kind: "clue", clueId: "c1" }),
      ],
    });
    const cycle = detectClueCycle(inst);
    expect(cycle).not.toBeNull();
    expect(Array.isArray(cycle)).toBe(true);
  });

  it("returns null when a clue references a clue ID that does not exist in the list (no cycle)", () => {
    // Referencing a missing ID is not a cycle — it is a dangling edge.
    const inst = baseInstance({
      clues: [makeClue("c1", [], { kind: "clue", clueId: "no_such_clue" })],
    });
    expect(detectClueCycle(inst)).toBeNull();
  });

  it("detects a cycle even when mixed with non-clue-kind preconditions", () => {
    const inst = baseInstance({
      clues: [
        makeClue("c_always", [], { kind: "always" }),
        makeClue("c_cycleA", [], { kind: "clue", clueId: "c_cycleB" }),
        makeClue("c_cycleB", [], { kind: "clue", clueId: "c_cycleA" }),
      ],
    });
    const cycle = detectClueCycle(inst);
    expect(cycle).not.toBeNull();
  });
});
