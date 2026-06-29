/**
 * Door reachability (J3, PLAN §2.4). Proves a locked door is a FIRST-CLASS
 * reachability gate: a clue behind a gated door is reachable only once the door's
 * precondition (here: inspect the key) is satisfiable. We test both the generator's
 * emitted doors and the reachability lowering directly.
 */
import { describe, it, expect } from "vitest";
import type { CaseInstance, Clue, Fact, Item } from "../../shared/case.js";
import { generateTemplate, drawInstance } from "./procedural.js";
import { computeSurface } from "./reachability.js";
import { solveInstance } from "./solve.js";
import { validateInstance } from "./validate.js";

describe("generated doors", () => {
  it("the template emits a connected door graph linking adjacent zones", () => {
    const t = generateTemplate("doors-1");
    const doors = t.map.doors ?? [];
    expect(doors.length).toBe(t.map.zones.length - 1); // spanning tree over the zones
    const zoneIds = new Set(t.map.zones.map((z) => z.id));
    for (const d of doors) {
      expect(zoneIds.has(d.from)).toBe(true);
      expect(zoneIds.has(d.to)).toBe(true);
      expect(d.from).not.toBe(d.to);
    }
    // Every non-root zone is the target of exactly one tree door → fully connected.
    const reached = new Set<string>([t.map.zones[0]!.id]);
    for (const d of doors) reached.add(d.to);
    expect(reached.size).toBe(t.map.zones.length);
  });

  it("emits exactly one gated door, and its gate is an inspectItem on a placed key", () => {
    const t = generateTemplate("doors-2");
    const gated = (t.map.doors ?? []).filter((d) => d.unlockedBy);
    expect(gated.length).toBe(1);
    const gate = gated[0]!.unlockedBy!;
    expect(gate.kind).toBe("inspectItem");
    if (gate.kind === "inspectItem") {
      const key = t.items.find((i) => i.id === gate.itemId);
      expect(key, "key item must exist in the template").toBeTruthy();
    }
  });

  it("a clue behind the gated door is reachable (door openable) → instance stays solvable", () => {
    // Across many seeds: the gated-door alibi is reachable because the key sits in the
    // always-open start zone, so the blind solver still lands the unique killer.
    const t = generateTemplate("doors-3");
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(t, `p-${i}`);
      const gate = (t.map.doors ?? []).find((d) => d.unlockedBy)?.unlockedBy;
      expect(gate?.kind).toBe("inspectItem");
      if (gate?.kind === "inspectItem") {
        // The clue gated by the door must be among the reachable surface.
        const gatedClue = inst.clues.find(
          (c) => c.unlockedBy.kind === "inspectItem" && c.unlockedBy.itemId === gate.itemId,
        );
        expect(gatedClue, `seed p-${i}: a clue should sit behind the door`).toBeTruthy();
        const surface = computeSurface(inst);
        expect(surface.reachableClueIds.has(gatedClue!.id)).toBe(true);
      }
      expect(solveInstance(inst).unique, `seed p-${i}`).toBe(inst.killerId);
      expect(validateInstance(inst).ok, `seed p-${i}`).toBe(true);
    }
  });
});

describe("door lowering = reachability gate (hand-built)", () => {
  const npc = (id: string): CaseInstance["npcs"][number] => ({
    id,
    persona: { name: id, blurb: id, voice: "plain" },
    tier: "principal",
    homeZone: "lobby",
    routine: [{ zoneId: "lobby", fromTick: 0, toTick: 1, activity: "present" }],
    slice: [],
  });
  const meansOpp = (s: string): Fact[] => [
    { id: `${s}_means`, subject: s, predicate: "means" },
    { id: `${s}_opp`, subject: s, predicate: "opportunity" },
  ];
  const askClues = (s: string): Clue[] => [
    { id: `${s}_cm`, revealsFactIds: [`${s}_means`], unlockedBy: { kind: "askTopic", npcId: s, topic: "means" } },
    { id: `${s}_co`, revealsFactIds: [`${s}_opp`], unlockedBy: { kind: "askTopic", npcId: s, topic: "whereabouts" } },
  ];
  const key: Item = { id: "key", kind: "document", zone: "lobby", coords: { x: 0, y: 0 }, examineText: "a key", revealsFactIds: [], presentReactions: [] };

  const build = (keyZoneLocked: boolean): CaseInstance => ({
    templateId: "door-test",
    instanceSeed: "door-test",
    suspectIds: ["A", "B"],
    killerId: "A",
    facts: [...meansOpp("A"), ...meansOpp("B"), { id: "B_ref", subject: "B", predicate: "refutesOpportunity" }],
    clues: [
      ...askClues("A"),
      ...askClues("B"),
      // B's alibi sits BEHIND the locked door: it needs the key inspected.
      { id: "B_ref_c", revealsFactIds: ["B_ref"], unlockedBy: { kind: "inspectItem", itemId: "key" } },
    ],
    items: [{ ...key, zone: keyZoneLocked ? "vault" : "lobby" }],
    npcs: [npc("A"), npc("B")],
    lockedZones: keyZoneLocked ? ["vault"] : [],
    solution: { killerId: "A", supportingClueIds: ["A_cm", "A_co"] },
  });

  it("door OPEN (key reachable): B's alibi reachable → unique killer A", () => {
    const inst = build(false);
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("B_ref")).toBe(true);
    expect(solveInstance(inst).unique).toBe("A");
    expect(validateInstance(inst).ok).toBe(true);
  });

  it("door LOCKED (key behind a locked zone): B's alibi UNreachable → ambiguous (gate enforced)", () => {
    const inst = build(true);
    const surface = computeSurface(inst);
    expect(surface.reachableFactIds.has("B_ref")).toBe(false); // the gate held
    expect(solveInstance(inst).unique).toBeNull(); // A and B both viable
    expect(validateInstance(inst).ok).toBe(false);
  });
});
