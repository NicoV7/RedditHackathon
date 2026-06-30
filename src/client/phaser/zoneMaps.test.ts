/**
 * Validation tests for the authored speakeasy tilemaps (src/client/phaser/zoneMaps.ts).
 *
 * These guard the hand-designed maps against soft-locks / typos and run each through the
 * deriver: the 4 zone ids exist, every map has exactly one spawn + reachable doors, all
 * platforms/markers sit in-bounds and in air, and `mapToLevel` yields a sane, scrollable
 * level (camera wider than the viewport; doors/items on a real surface).
 */
import { describe, it, expect } from "vitest";
import { ZONE_MAPS } from "./zoneMaps.js";
import { mapToLevel, type ZoneMapSpec } from "./mapToLevel.js";
import type { Door } from "../../shared/case.js";

const ZONE_IDS = ["bar", "lot", "backbar", "alley"] as const;
const VIEWPORT_W = 400; // the side-scroll viewport — every room must be wider (scrolls)

const isSolidAt = (spec: ZoneMapSpec, col: number, row: number): boolean => {
  if (row >= spec.rows - spec.groundRows) return true;
  return spec.platforms.some((p) => p.row === row && col >= p.col && col < p.col + p.len);
};

describe("ZONE_MAPS — coverage of the four speakeasy rooms", () => {
  it("defines exactly the four zone ids that mirror ZONE_DEFS", () => {
    expect(Object.keys(ZONE_MAPS).sort()).toEqual([...ZONE_IDS].sort());
  });
});

describe.each(ZONE_IDS)("ZONE_MAPS[%s]", (id) => {
  const spec = ZONE_MAPS[id]!;

  it("has positive dimensions and a ground band", () => {
    expect(spec.cols).toBeGreaterThan(0);
    expect(spec.rows).toBeGreaterThan(0);
    expect(spec.tileSize).toBeGreaterThan(0);
    expect(spec.groundRows).toBeGreaterThanOrEqual(1);
  });

  it("keeps every platform in-bounds and above the ground band", () => {
    for (const p of spec.platforms) {
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col + p.len).toBeLessThanOrEqual(spec.cols);
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(spec.rows - spec.groundRows);
    }
  });

  it("has exactly one spawn and at least two door anchors", () => {
    const kinds = spec.markers.map((m) => m.kind);
    expect(kinds.filter((k) => k === "spawn")).toHaveLength(1);
    expect(kinds.filter((k) => k === "door").length).toBeGreaterThanOrEqual(2);
  });

  it("places every marker in-bounds, in an AIR cell with solid ground below it", () => {
    for (const m of spec.markers) {
      expect(m.col).toBeGreaterThanOrEqual(0);
      expect(m.col).toBeLessThan(spec.cols);
      expect(m.row).toBeGreaterThanOrEqual(0);
      expect(m.row).toBeLessThan(spec.rows);
      expect(isSolidAt(spec, m.col, m.row)).toBe(false); // the marker's own cell is air
      // some solid exists at/below it to stand on
      let hasFloor = false;
      for (let r = m.row; r < spec.rows; r++) if (isSolidAt(spec, m.col, r)) hasFloor = true;
      expect(hasFloor).toBe(true);
    }
  });

  it("derives a scrollable level with doors/items on a real surface", () => {
    const doors: Door[] = [
      { from: id, to: "bar", coords: { x: 0, y: 0 } },
      { from: id, to: "lot", coords: { x: 0, y: 0 } },
    ];
    const level = mapToLevel(spec, { doors, items: [{ id: "x" }], npcs: [{ id: "n" }] });
    expect(level.worldW).toBeGreaterThan(VIEWPORT_W); // camera scrolls
    expect(level.groundY).toBeGreaterThan(0);
    expect(level.groundY).toBeLessThan(level.worldH);
    expect(level.collisionRects.length).toBeGreaterThan(0);
    for (const p of level.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(level.worldW);
      expect(p.surfaceY).toBeGreaterThan(0);
      expect(p.surfaceY).toBeLessThanOrEqual(level.groundY); // on the ground or an elevated ledge
    }
    expect(level.spawnX).toBeGreaterThanOrEqual(0);
    expect(level.spawnX).toBeLessThanOrEqual(level.worldW);
  });

  it("gives every cosmetic prop marker a non-empty propId", () => {
    const props = spec.markers.filter((m) => m.kind === "prop");
    expect(props.length).toBeGreaterThan(0); // each room is decorated
    for (const p of props) {
      expect(typeof p.propId).toBe("string");
      expect((p.propId ?? "").length).toBeGreaterThan(0);
    }
  });

  it("floor-snaps every cosmetic prop onto a real surface", () => {
    const level = mapToLevel(spec, { doors: [], items: [], npcs: [] });
    const propMarkers = spec.markers.filter((m) => m.kind === "prop");
    expect(level.props).toHaveLength(propMarkers.length); // each prop marker → one PropPlacement
    expect(level.props.map((p) => p.id)).toEqual(propMarkers.map((m) => m.propId));
    for (const p of level.props) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(level.worldW);
      expect(p.surfaceY).toBeGreaterThan(0);
      expect(p.surfaceY).toBeLessThanOrEqual(level.groundY); // on the ground or an elevated platform
      expect(p.surfaceY % spec.tileSize).toBe(0); // snapped to a tile-top
    }
  });
});
