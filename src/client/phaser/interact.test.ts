/**
 * Pure-logic tests for the proximity selector (src/client/phaser/interact.ts).
 *
 * Deterministic f(args) — no Phaser/DOM/clock/Math.random. Coverage: empty/none-in-range
 * → null, nearest wins, inclusive boundary, lowest-index tie-break, mixed kinds, toZone
 * propagation for doors (and its absence for non-doors).
 */
import { describe, it, expect } from "vitest";
import { nearestInteractable, type InteractCandidate } from "./interact.js";

const C = (id: string, kind: InteractCandidate["kind"], x: number, y: number, toZone?: string): InteractCandidate =>
  toZone !== undefined ? { id, kind, x, y, toZone } : { id, kind, x, y };

describe("nearestInteractable", () => {
  it("returns null for no candidates", () => {
    expect(nearestInteractable(0, 0, [], 50)).toBeNull();
  });

  it("returns null when every candidate is out of range", () => {
    const cs = [C("a", "npc", 100, 0), C("b", "item", 0, 100)];
    expect(nearestInteractable(0, 0, cs, 50)).toBeNull();
  });

  it("picks the nearest in-range candidate", () => {
    const cs = [C("far", "npc", 40, 0), C("near", "item", 10, 0)];
    expect(nearestInteractable(0, 0, cs, 50)?.id).toBe("near");
  });

  it("includes the exact boundary (dist === range)", () => {
    const cs = [C("edge", "npc", 50, 0)];
    const hit = nearestInteractable(0, 0, cs, 50);
    expect(hit?.id).toBe("edge");
    expect(hit?.dist).toBe(50);
  });

  it("breaks ties by lowest input index", () => {
    const cs = [C("first", "npc", 30, 0), C("second", "door", 0, 30, "cellar")];
    // both exactly 30 away → the earlier one wins
    expect(nearestInteractable(0, 0, cs, 50)?.id).toBe("first");
  });

  it("propagates toZone for a door hit and omits it for non-doors", () => {
    const door = nearestInteractable(0, 0, [C("d", "door", 5, 0, "study")], 50);
    expect(door).toMatchObject({ id: "d", kind: "door", toZone: "study" });
    const npc = nearestInteractable(0, 0, [C("n", "npc", 5, 0)], 50);
    expect(npc?.toZone).toBeUndefined();
  });

  it("measures Euclidean distance across both axes", () => {
    const hit = nearestInteractable(0, 0, [C("p", "item", 3, 4)], 50);
    expect(hit?.dist).toBe(5); // 3-4-5
  });
});
