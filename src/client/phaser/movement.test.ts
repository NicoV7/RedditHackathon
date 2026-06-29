/**
 * Pure-logic tests for the locomotion helpers (src/client/phaser/movement.ts).
 *
 * Every tested function is a deterministic f(args) — no Phaser, no DOM, no clocks,
 * no Math.random. Tests cover:
 *   - zoneBoundsPx: pixel-projection math
 *   - allZoneBoundsPx: projects every zone in a MapDef
 *   - pointInBounds: half-open rectangle inclusion (far edges excluded)
 *   - pointInZone: first-match semantics, overlapping zones, null for gaps
 *   - inputVector: axis composition, cancellation, diagonal unit-length normalisation
 *   - steerToward: unit vector toward target, zero vector inside stopRadius
 *   - clampToPlayfield: already-inside passthrough, out-of-bounds clamp
 */
import { describe, it, expect } from "vitest";
import {
  zoneBoundsPx,
  allZoneBoundsPx,
  pointInBounds,
  pointInZone,
  inputVector,
  steerToward,
  clampToPlayfield,
  type ZoneBoundsPx,
} from "./movement.js";
import type { NavGrid, Zone, MapDef } from "../../shared/case.js";

// ─────────────────────────── Fixture helpers ───────────────────────────

function makeGrid(opts?: Partial<NavGrid>): NavGrid {
  return {
    cellSize: 32,
    origin: { x: 0, y: 0 },
    cols: 10,
    rows: 10,
    ...opts,
  };
}

function makeZone(id: string, x: number, y: number, w: number, h: number): Zone {
  return {
    id,
    name: id,
    tags: [],
    bounds: { x, y, w, h },
  };
}

function makeMapDef(zones: Zone[], grid?: NavGrid): MapDef {
  return {
    zones,
    navGrid: grid ?? makeGrid(),
  };
}

// ─────────────────────────── zoneBoundsPx ───────────────────────────

describe("zoneBoundsPx", () => {
  it("projects a zone from grid-cell space into pixel space with zero origin", () => {
    const grid = makeGrid({ cellSize: 32, origin: { x: 0, y: 0 } });
    const zone = makeZone("parlor", 2, 3, 4, 5);
    const b = zoneBoundsPx(grid, zone);
    expect(b.id).toBe("parlor");
    expect(b.px).toBe(64);   // 0 + 2 * 32
    expect(b.py).toBe(96);   // 0 + 3 * 32
    expect(b.pw).toBe(128);  // 4 * 32
    expect(b.ph).toBe(160);  // 5 * 32
  });

  it("offsets correctly when the grid has a non-zero origin", () => {
    const grid = makeGrid({ cellSize: 16, origin: { x: 100, y: 200 } });
    const zone = makeZone("cellar", 1, 1, 3, 2);
    const b = zoneBoundsPx(grid, zone);
    expect(b.px).toBe(116);  // 100 + 1 * 16
    expect(b.py).toBe(216);  // 200 + 1 * 16
    expect(b.pw).toBe(48);   // 3 * 16
    expect(b.ph).toBe(32);   // 2 * 16
  });

  it("preserves the zone id verbatim", () => {
    const grid = makeGrid();
    const zone = makeZone("zone-XYZ", 0, 0, 1, 1);
    expect(zoneBoundsPx(grid, zone).id).toBe("zone-XYZ");
  });

  it("handles a single-cell zone (1×1)", () => {
    const grid = makeGrid({ cellSize: 8, origin: { x: 0, y: 0 } });
    const zone = makeZone("tiny", 5, 5, 1, 1);
    const b = zoneBoundsPx(grid, zone);
    expect(b.px).toBe(40);
    expect(b.py).toBe(40);
    expect(b.pw).toBe(8);
    expect(b.ph).toBe(8);
  });
});

// ─────────────────────────── allZoneBoundsPx ───────────────────────────

describe("allZoneBoundsPx", () => {
  it("projects every zone in the map, in map order", () => {
    const zones = [makeZone("a", 0, 0, 2, 2), makeZone("b", 3, 0, 2, 2)];
    const map = makeMapDef(zones, makeGrid({ cellSize: 10, origin: { x: 0, y: 0 } }));
    const bounds = allZoneBoundsPx(map);
    expect(bounds).toHaveLength(2);
    expect(bounds[0]!.id).toBe("a");
    expect(bounds[1]!.id).toBe("b");
    expect(bounds[0]!.px).toBe(0);
    expect(bounds[1]!.px).toBe(30); // 3 * 10
  });

  it("returns an empty array for a map with no zones", () => {
    const map = makeMapDef([], makeGrid());
    expect(allZoneBoundsPx(map)).toEqual([]);
  });

  it("a single zone map returns a single-element array", () => {
    const map = makeMapDef([makeZone("only", 1, 1, 4, 4)]);
    const bounds = allZoneBoundsPx(map);
    expect(bounds).toHaveLength(1);
    expect(bounds[0]!.id).toBe("only");
  });
});

// ─────────────────────────── pointInBounds ───────────────────────────

describe("pointInBounds (half-open rectangle)", () => {
  const b: ZoneBoundsPx = { id: "r", px: 100, py: 200, pw: 50, ph: 40 };
  // rect covers [100, 150) × [200, 240)

  it("contains the top-left corner pixel", () => {
    expect(pointInBounds(b, 100, 200)).toBe(true);
  });

  it("contains a clearly interior point", () => {
    expect(pointInBounds(b, 125, 220)).toBe(true);
  });

  it("excludes the right edge (half-open)", () => {
    expect(pointInBounds(b, 150, 220)).toBe(false);
  });

  it("excludes the bottom edge (half-open)", () => {
    expect(pointInBounds(b, 125, 240)).toBe(false);
  });

  it("excludes the far corner (right+bottom)", () => {
    expect(pointInBounds(b, 150, 240)).toBe(false);
  });

  it("includes one pixel before the right edge", () => {
    expect(pointInBounds(b, 149, 220)).toBe(true);
  });

  it("includes one pixel before the bottom edge", () => {
    expect(pointInBounds(b, 125, 239)).toBe(true);
  });

  it("excludes a point left of the rectangle", () => {
    expect(pointInBounds(b, 99, 220)).toBe(false);
  });

  it("excludes a point above the rectangle", () => {
    expect(pointInBounds(b, 125, 199)).toBe(false);
  });

  it("excludes a point completely outside", () => {
    expect(pointInBounds(b, 0, 0)).toBe(false);
  });

  it("excludes negative coordinates when rectangle is at positive origin", () => {
    expect(pointInBounds(b, -1, 220)).toBe(false);
  });
});

// ─────────────────────────── pointInZone ───────────────────────────

describe("pointInZone", () => {
  it("returns the id of the zone containing the point", () => {
    const grid = makeGrid({ cellSize: 32, origin: { x: 0, y: 0 } });
    const zones = [makeZone("parlor", 0, 0, 3, 3), makeZone("kitchen", 3, 0, 3, 3)];
    const bounds = zones.map((z) => zoneBoundsPx(grid, z));
    // parlor covers [0,96) × [0,96); point (50, 50) is inside parlor
    expect(pointInZone(bounds, 50, 50)).toBe("parlor");
  });

  it("returns the correct id for a point inside the second zone", () => {
    const grid = makeGrid({ cellSize: 32, origin: { x: 0, y: 0 } });
    const zones = [makeZone("a", 0, 0, 3, 3), makeZone("b", 3, 0, 3, 3)];
    const bounds = zones.map((z) => zoneBoundsPx(grid, z));
    // b starts at px=96; point (100, 50) is inside b
    expect(pointInZone(bounds, 100, 50)).toBe("b");
  });

  it("returns null when the point is in a gap between zones (no zone covers it)", () => {
    const grid = makeGrid({ cellSize: 32, origin: { x: 0, y: 0 } });
    // Two zones with a 1-cell gap between them (cols 3 and 4 missing)
    const zones = [makeZone("left", 0, 0, 3, 3), makeZone("right", 5, 0, 3, 3)];
    const bounds = zones.map((z) => zoneBoundsPx(grid, z));
    // gap is at x in [96, 160), pick middle of gap: x=128
    expect(pointInZone(bounds, 128, 50)).toBeNull();
  });

  it("returns null when the point is entirely outside all zones", () => {
    const grid = makeGrid({ cellSize: 32, origin: { x: 0, y: 0 } });
    const zones = [makeZone("a", 0, 0, 2, 2)];
    const bounds = zones.map((z) => zoneBoundsPx(grid, z));
    expect(pointInZone(bounds, 1000, 1000)).toBeNull();
  });

  it("returns null for an empty zone list", () => {
    expect(pointInZone([], 50, 50)).toBeNull();
  });

  it("returns the FIRST matching zone when zones overlap (stable tie-break)", () => {
    // Build two overlapping bounds manually to avoid depending on the grid formula
    const first: ZoneBoundsPx = { id: "first", px: 0, py: 0, pw: 100, ph: 100 };
    const second: ZoneBoundsPx = { id: "second", px: 0, py: 0, pw: 100, ph: 100 };
    expect(pointInZone([first, second], 50, 50)).toBe("first");
  });

  it("respects the right boundary pixel as half-open (not claimed by the zone)", () => {
    const b: ZoneBoundsPx = { id: "z", px: 0, py: 0, pw: 64, ph: 64 };
    expect(pointInZone([b], 64, 0)).toBeNull();
  });

  it("respects the bottom boundary pixel as half-open (not claimed by the zone)", () => {
    const b: ZoneBoundsPx = { id: "z", px: 0, py: 0, pw: 64, ph: 64 };
    expect(pointInZone([b], 0, 64)).toBeNull();
  });

  it("handles zones with a non-zero grid origin", () => {
    const grid = makeGrid({ cellSize: 16, origin: { x: 50, y: 50 } });
    const zone = makeZone("offset", 0, 0, 4, 4);
    // px = 50 + 0*16 = 50, py = 50 + 0*16 = 50, pw = 64, ph = 64
    // covers [50, 114) × [50, 114)
    const bounds = [zoneBoundsPx(grid, zone)];
    expect(pointInZone(bounds, 50, 50)).toBe("offset");
    expect(pointInZone(bounds, 49, 50)).toBeNull();
    expect(pointInZone(bounds, 114, 50)).toBeNull();
  });
});

// ─────────────────────────── inputVector ───────────────────────────

describe("inputVector", () => {
  it("returns {0,0} when no keys are pressed", () => {
    expect(inputVector({})).toEqual({ dx: 0, dy: 0 });
  });

  it("returns {0,0} when all four keys are pressed (full cancellation)", () => {
    expect(inputVector({ left: true, right: true, up: true, down: true })).toEqual({ dx: 0, dy: 0 });
  });

  it("returns {0,0} when left+right cancel and up+down cancel independently", () => {
    expect(inputVector({ left: true, right: true })).toEqual({ dx: 0, dy: 0 });
    expect(inputVector({ up: true, down: true })).toEqual({ dx: 0, dy: 0 });
  });

  it("returns unit left vector for left key only", () => {
    const v = inputVector({ left: true });
    expect(v.dx).toBeCloseTo(-1);
    expect(v.dy).toBeCloseTo(0);
  });

  it("returns unit right vector for right key only", () => {
    const v = inputVector({ right: true });
    expect(v.dx).toBeCloseTo(1);
    expect(v.dy).toBeCloseTo(0);
  });

  it("returns unit up vector for up key only", () => {
    const v = inputVector({ up: true });
    expect(v.dx).toBeCloseTo(0);
    expect(v.dy).toBeCloseTo(-1);
  });

  it("returns unit down vector for down key only", () => {
    const v = inputVector({ down: true });
    expect(v.dx).toBeCloseTo(0);
    expect(v.dy).toBeCloseTo(1);
  });

  it("normalises a right+down diagonal to unit length", () => {
    const v = inputVector({ right: true, down: true });
    const len = Math.hypot(v.dx, v.dy);
    expect(len).toBeCloseTo(1);
    // both components must be equal and positive
    expect(v.dx).toBeCloseTo(Math.SQRT1_2);
    expect(v.dy).toBeCloseTo(Math.SQRT1_2);
  });

  it("normalises a left+up diagonal to unit length", () => {
    const v = inputVector({ left: true, up: true });
    const len = Math.hypot(v.dx, v.dy);
    expect(len).toBeCloseTo(1);
    expect(v.dx).toBeCloseTo(-Math.SQRT1_2);
    expect(v.dy).toBeCloseTo(-Math.SQRT1_2);
  });

  it("normalises a right+up diagonal to unit length", () => {
    const v = inputVector({ right: true, up: true });
    const len = Math.hypot(v.dx, v.dy);
    expect(len).toBeCloseTo(1);
    expect(v.dx).toBeCloseTo(Math.SQRT1_2);
    expect(v.dy).toBeCloseTo(-Math.SQRT1_2);
  });

  it("normalises a left+down diagonal to unit length", () => {
    const v = inputVector({ left: true, down: true });
    const len = Math.hypot(v.dx, v.dy);
    expect(len).toBeCloseTo(1);
    expect(v.dx).toBeCloseTo(-Math.SQRT1_2);
    expect(v.dy).toBeCloseTo(Math.SQRT1_2);
  });

  it("treats absent key fields (undefined) as not pressed", () => {
    // Only 'right' provided; all others absent
    const v = inputVector({ right: true });
    expect(v.dx).toBeCloseTo(1);
    expect(v.dy).toBeCloseTo(0);
  });

  it("treats false key values as not pressed", () => {
    const v = inputVector({ left: false, right: false, up: false, down: false });
    expect(v).toEqual({ dx: 0, dy: 0 });
  });

  it("is deterministic — same input always yields same output", () => {
    const a = inputVector({ right: true, up: true });
    const b = inputVector({ right: true, up: true });
    expect(a).toEqual(b);
  });
});

// ─────────────────────────── steerToward ───────────────────────────

describe("steerToward", () => {
  it("returns a unit vector pointing from source toward target", () => {
    const v = steerToward(0, 0, 100, 0, 5);
    expect(v.dx).toBeCloseTo(1);
    expect(v.dy).toBeCloseTo(0);
  });

  it("returns {0,0} when already within stopRadius", () => {
    expect(steerToward(10, 10, 12, 10, 5)).toEqual({ dx: 0, dy: 0 });
  });

  it("returns {0,0} when exactly at stopRadius distance", () => {
    // distance = 5, stopRadius = 5 → dist <= stopRadius
    expect(steerToward(0, 0, 5, 0, 5)).toEqual({ dx: 0, dy: 0 });
  });

  it("returns {0,0} when from === to (zero distance)", () => {
    expect(steerToward(10, 10, 10, 10, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("produces a unit-length vector for a diagonal target", () => {
    const v = steerToward(0, 0, 50, 50, 1);
    const len = Math.hypot(v.dx, v.dy);
    expect(len).toBeCloseTo(1);
  });

  it("steers upward (negative dy) when target is above", () => {
    const v = steerToward(0, 100, 0, 0, 1);
    expect(v.dx).toBeCloseTo(0);
    expect(v.dy).toBeCloseTo(-1);
  });
});

// ─────────────────────────── clampToPlayfield ───────────────────────────

describe("clampToPlayfield", () => {
  const bounds: ZoneBoundsPx[] = [
    { id: "a", px: 0, py: 0, pw: 100, ph: 100 },
    { id: "b", px: 100, py: 0, pw: 100, ph: 100 },
  ];
  // overall bounding box: [0, 200) × [0, 100)

  it("returns the point unchanged when it is inside a zone", () => {
    expect(clampToPlayfield(bounds, 50, 50)).toEqual({ x: 50, y: 50 });
  });

  it("clamps a point that is to the left of the playfield", () => {
    const r = clampToPlayfield(bounds, -50, 50);
    expect(r.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps a point that is to the right of the playfield", () => {
    const r = clampToPlayfield(bounds, 300, 50);
    expect(r.x).toBeLessThanOrEqual(200);
  });

  it("clamps a point that is above the playfield", () => {
    const r = clampToPlayfield(bounds, 50, -100);
    expect(r.y).toBeGreaterThanOrEqual(0);
  });

  it("clamps a point that is below the playfield", () => {
    const r = clampToPlayfield(bounds, 50, 200);
    expect(r.y).toBeLessThanOrEqual(100);
  });

  it("returns the point unchanged for an empty zone list", () => {
    expect(clampToPlayfield([], 999, 999)).toEqual({ x: 999, y: 999 });
  });

  it("respects the margin parameter — clamps to minX+margin", () => {
    const r = clampToPlayfield(bounds, -50, 50, 10);
    expect(r.x).toBeGreaterThanOrEqual(10);
  });
});
