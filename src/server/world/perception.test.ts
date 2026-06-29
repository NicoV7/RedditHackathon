import { describe, it, expect } from "vitest";
import type { Npc } from "../../shared/case.js";
import { npcZoneAtTick, witnessesAt } from "./perception.js";

function npc(id: string, homeZone: string, routine: Npc["routine"]): Npc {
  return { id, persona: { name: id, blurb: "", voice: "" }, tier: "supporting", homeZone, routine, slice: [] };
}

describe("perception: npcZoneAtTick (integer-pure routine derivation)", () => {
  it("returns the routine step covering the tick (half-open windows)", () => {
    const n = npc("a", "home", [
      { zoneId: "parlor", fromTick: 0, toTick: 10, activity: "x" },
      { zoneId: "kitchen", fromTick: 10, toTick: 20, activity: "y" },
    ]);
    expect(npcZoneAtTick(n, 0)).toBe("parlor");
    expect(npcZoneAtTick(n, 9)).toBe("parlor");
    expect(npcZoneAtTick(n, 10)).toBe("kitchen"); // half-open: toTick is exclusive
    expect(npcZoneAtTick(n, 19)).toBe("kitchen");
  });

  it("falls back to homeZone when no step covers the tick", () => {
    const n = npc("a", "study", [{ zoneId: "parlor", fromTick: 0, toTick: 10, activity: "x" }]);
    expect(npcZoneAtTick(n, 50)).toBe("study");
  });

  it("first matching step wins on overlap (deterministic)", () => {
    const n = npc("a", "home", [
      { zoneId: "first", fromTick: 0, toTick: 100, activity: "x" },
      { zoneId: "second", fromTick: 0, toTick: 100, activity: "y" },
    ]);
    expect(npcZoneAtTick(n, 5)).toBe("first");
  });
});

describe("perception: witnessesAt (the pinned witness rule)", () => {
  const npcs: Npc[] = [
    npc("alice", "parlor", [{ zoneId: "parlor", fromTick: 0, toTick: 10, activity: "x" }]),
    npc("bob", "kitchen", [{ zoneId: "kitchen", fromTick: 0, toTick: 10, activity: "x" }]),
    npc("cara", "parlor", [{ zoneId: "garden", fromTick: 0, toTick: 5, activity: "x" }]), // in garden early, home after
  ];

  it("an NPC witnesses an action iff its zone-at-tick equals the event zone", () => {
    expect(witnessesAt(npcs, "parlor", 2)).toEqual(["alice"]); // cara is in garden at t=2
    expect(witnessesAt(npcs, "garden", 2)).toEqual(["cara"]);
    expect(witnessesAt(npcs, "kitchen", 2)).toEqual(["bob"]);
  });

  it("respects time: cara returns to home (parlor) after her garden step ends", () => {
    // At t=7: alice's parlor step (0..10) still covers her; cara's garden step (0..5)
    // has ended so she falls back to homeZone "parlor". Both are in the parlor.
    expect(witnessesAt(npcs, "parlor", 7)).toEqual(["alice", "cara"]);
  });

  it("returns [] when no NPC is co-located", () => {
    expect(witnessesAt(npcs, "cellar", 2)).toEqual([]);
  });

  it("is order-stable (follows input npc order)", () => {
    const w = witnessesAt(npcs, "parlor", 7);
    expect(w).toEqual(["alice", "cara"]); // input order, not sorted by accident
  });
});
