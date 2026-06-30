/**
 * Pure-logic tests for the tilemap→level deriver (src/client/phaser/mapToLevel.ts).
 *
 * Deterministic f(args) — no Phaser/DOM/clock/Math.random. Coverage: world dims + ground
 * line, solid grid (ground rows + platform runs), merged collision rects, spawn/door/item/
 * NPC anchoring (marker → surface below; extras → even spread), stable order, determinism.
 */
import { describe, it, expect } from "vitest";
import { mapToLevel, type ZoneMapSpec, type LevelEntities } from "./mapToLevel.js";
import type { Door } from "../../shared/case.js";

function spec(overrides?: Partial<ZoneMapSpec>): ZoneMapSpec {
  return {
    cols: 10,
    rows: 6,
    tileSize: 16,
    groundRows: 2,
    platforms: [{ col: 3, row: 3, len: 2 }], // a 2-tile ledge at row 3 (cols 3–4)
    markers: [
      { kind: "spawn", col: 1, row: 4 },
      { kind: "door", col: 8, row: 4 },
      { kind: "item", col: 3, row: 2 }, // floats above the ledge → stands on row 3
      { kind: "npc", col: 6, row: 4 },
    ],
    ...overrides,
  };
}
const door = (from: string, to: string): Door => ({ from, to, coords: { x: 0, y: 0 } });
function entities(overrides?: Partial<LevelEntities>): LevelEntities {
  return { doors: [door("bar", "lot")], items: [{ id: "glass" }], npcs: [{ id: "lola" }], ...overrides };
}

describe("mapToLevel — dimensions & ground", () => {
  it("derives world size and the ground line from the spec", () => {
    const l = mapToLevel(spec(), entities());
    expect(l.worldW).toBe(160); // 10 × 16
    expect(l.worldH).toBe(96); // 6 × 16
    expect(l.groundY).toBe(64); // (6 − 2) × 16
  });
});

describe("mapToLevel — solid grid", () => {
  it("fills the bottom ground rows and the platform run, leaving the rest air", () => {
    const l = mapToLevel(spec(), entities());
    expect(l.solid[4]!.every(Boolean)).toBe(true); // ground
    expect(l.solid[5]!.every(Boolean)).toBe(true); // ground
    expect(l.solid[3]![3]).toBe(true); // platform
    expect(l.solid[3]![4]).toBe(true);
    expect(l.solid[3]![0]).toBe(false); // air beside the platform
    expect(l.solid[0]!.some(Boolean)).toBe(false); // top row all air
  });
});

describe("mapToLevel — collision rects", () => {
  it("merges each row's contiguous solids into rectangles", () => {
    const l = mapToLevel(spec(), entities());
    // full-width ground rows
    expect(l.collisionRects).toContainEqual({ x: 0, y: 64, w: 160, h: 16 });
    expect(l.collisionRects).toContainEqual({ x: 0, y: 80, w: 160, h: 16 });
    // the platform run (cols 3–4 → x 48, w 32, at row 3 → y 48)
    expect(l.collisionRects).toContainEqual({ x: 48, y: 48, w: 32, h: 16 });
  });
});

describe("mapToLevel — placements", () => {
  it("spawns the player on the marker's surface", () => {
    const l = mapToLevel(spec(), entities());
    expect(l.spawnX).toBe(24); // col 1 → 1×16 + 8
    expect(l.spawnY).toBe(64); // row 4 is ground
  });

  it("anchors a door to its marker and tags the destination zone", () => {
    const l = mapToLevel(spec(), entities());
    const d = l.placements.find((p) => p.kind === "door");
    expect(d).toMatchObject({ id: "bar->lot", kind: "door", x: 136, surfaceY: 64, toZone: "lot" });
  });

  it("stands an item that floats above a ledge ON the ledge surface", () => {
    const l = mapToLevel(spec(), entities());
    const item = l.placements.find((p) => p.kind === "item");
    expect(item).toMatchObject({ id: "glass", x: 56, surfaceY: 48 }); // row 3 ledge top
  });

  it("keeps a stable doors → items → NPCs order", () => {
    const l = mapToLevel(spec(), entities());
    expect(l.placements.map((p) => p.kind)).toEqual(["door", "item", "npc"]);
  });

  it("even-spreads entities that have no authored marker", () => {
    // two doors but only one door marker → the 2nd spreads onto the ground
    const l = mapToLevel(spec(), entities({ doors: [door("bar", "lot"), door("bar", "alley")] }));
    const doors = l.placements.filter((p) => p.kind === "door");
    expect(doors[0]!.x).toBe(136); // marker
    expect(doors[1]!.surfaceY).toBe(64); // ground
    expect(doors[1]!.x).toBeGreaterThan(0);
    expect(doors[1]!.x).toBeLessThan(l.worldW);
  });
});

describe("mapToLevel — determinism", () => {
  it("is deterministic: identical input → identical level", () => {
    expect(mapToLevel(spec(), entities())).toEqual(mapToLevel(spec(), entities()));
  });
});
