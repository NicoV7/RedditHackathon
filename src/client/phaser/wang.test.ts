/**
 * Unit tests for src/client/phaser/wang.ts
 *
 * Coverage targets:
 *   - cornersToIndex: all 16 corner combinations → correct index 0..15
 *   - buildWangAtlas: well-formed metadata, malformed/missing-field fallback, null/undefined input
 *   - wangRectForCorners: exact hit, fallback to base, fallback to any rect, synthesised fallback
 *   - flatLowerField: always "lower"
 *   - cornersAt: corner-lattice sampling
 */

import { describe, it, expect } from "vitest";
import {
  cornersToIndex,
  buildWangAtlas,
  wangRectForCorners,
  flatLowerField,
  cornersAt,
  type Corners,
  type WangTilesetMeta,
  type WangRect,
} from "./wang.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Corners object from a 4-bit number (NW=bit3, NE=bit2, SW=bit1, SE=bit0). */
function cornersFromBits(bits: number): Corners {
  return {
    NW: bits & 8 ? "upper" : "lower",
    NE: bits & 4 ? "upper" : "lower",
    SW: bits & 2 ? "upper" : "lower",
    SE: bits & 1 ? "upper" : "lower",
  };
}

/** Minimal valid tile entry for buildWangAtlas. */
function makeTile(
  bits: number,
  x: number,
  y: number,
  w = 16,
  h = 16,
): NonNullable<NonNullable<WangTilesetMeta["tileset_data"]>["tiles"]>[number] {
  const c = cornersFromBits(bits);
  return {
    corners: { NW: c.NW, NE: c.NE, SW: c.SW, SE: c.SE },
    bounding_box: { x, y, width: w, height: h },
  };
}

/** Build a minimal WangTilesetMeta containing only the supplied indices. */
function makeMeta(
  indices: number[],
  tileSize = 16,
): WangTilesetMeta {
  const tiles = indices.map((idx) => makeTile(idx, (idx % 4) * tileSize, Math.floor(idx / 4) * tileSize, tileSize, tileSize));
  return {
    tile_size: { width: tileSize, height: tileSize },
    tileset_data: { tiles },
  };
}

// ---------------------------------------------------------------------------
// cornersToIndex
// ---------------------------------------------------------------------------

describe("cornersToIndex", () => {
  it("all-lower corners produce index 0 (the base tile)", () => {
    expect(cornersToIndex({ NW: "lower", NE: "lower", SW: "lower", SE: "lower" })).toBe(0);
  });

  it("all-upper corners produce index 15", () => {
    expect(cornersToIndex({ NW: "upper", NE: "upper", SW: "upper", SE: "upper" })).toBe(15);
  });

  it("covers all 16 combinations with the formula NW*8+NE*4+SW*2+SE*1", () => {
    for (let expected = 0; expected < 16; expected++) {
      const c = cornersFromBits(expected);
      expect(cornersToIndex(c), `bits=${expected.toString(2).padStart(4, "0")}`).toBe(expected);
    }
  });

  it("NW only upper → 8", () => {
    expect(cornersToIndex({ NW: "upper", NE: "lower", SW: "lower", SE: "lower" })).toBe(8);
  });

  it("NE only upper → 4", () => {
    expect(cornersToIndex({ NW: "lower", NE: "upper", SW: "lower", SE: "lower" })).toBe(4);
  });

  it("SW only upper → 2", () => {
    expect(cornersToIndex({ NW: "lower", NE: "lower", SW: "upper", SE: "lower" })).toBe(2);
  });

  it("SE only upper → 1", () => {
    expect(cornersToIndex({ NW: "lower", NE: "lower", SW: "lower", SE: "upper" })).toBe(1);
  });

  it("NW+SE upper → 9", () => {
    expect(cornersToIndex({ NW: "upper", NE: "lower", SW: "lower", SE: "upper" })).toBe(9);
  });

  it("NE+SW upper → 6", () => {
    expect(cornersToIndex({ NW: "lower", NE: "upper", SW: "upper", SE: "lower" })).toBe(6);
  });

  it("index is always in range 0..15 for any valid Corners", () => {
    for (let i = 0; i < 16; i++) {
      const idx = cornersToIndex(cornersFromBits(i));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(15);
    }
  });
});

// ---------------------------------------------------------------------------
// buildWangAtlas — well-formed metadata
// ---------------------------------------------------------------------------

describe("buildWangAtlas — well-formed metadata", () => {
  it("returns 16-length rects array", () => {
    const atlas = buildWangAtlas(makeMeta([0]));
    expect(atlas.rects).toHaveLength(16);
  });

  it("stores the correct rect for each populated index", () => {
    const meta = makeMeta([0, 1, 15]);
    const atlas = buildWangAtlas(meta);

    expect(atlas.rects[0]).toEqual({ x: 0, y: 0, width: 16, height: 16 });
    expect(atlas.rects[1]).toEqual({ x: 16, y: 0, width: 16, height: 16 });
    expect(atlas.rects[15]).toEqual({ x: 48, y: 48, width: 16, height: 16 });
  });

  it("base is rects[0]", () => {
    const atlas = buildWangAtlas(makeMeta([0, 7]));
    expect(atlas.base).toBe(atlas.rects[0]);
  });

  it("reads tileSize from top-level tile_size.width", () => {
    const atlas = buildWangAtlas(makeMeta([0], 32));
    expect(atlas.tileSize).toBe(32);
  });

  it("reads tileSize from tileset_data.tile_size.width when top-level is absent", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tile_size: { width: 24 },
        tiles: [makeTile(0, 0, 0, 24, 24)],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.tileSize).toBe(24);
  });

  it("populates all 16 indices from a full 4×4 metadata fixture", () => {
    const meta = makeMeta(Array.from({ length: 16 }, (_, i) => i));
    const atlas = buildWangAtlas(meta);
    for (let i = 0; i < 16; i++) {
      expect(atlas.rects[i], `index ${i}`).toBeDefined();
    }
  });

  it("width/height default to tileSize when bounding_box omits them", () => {
    const meta: WangTilesetMeta = {
      tile_size: { width: 16 },
      tileset_data: {
        tiles: [
          {
            corners: { NW: "lower", NE: "lower", SW: "lower", SE: "lower" },
            bounding_box: { x: 10, y: 20 }, // no width/height
          },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects[0]).toEqual({ x: 10, y: 20, width: 16, height: 16 });
  });
});

// ---------------------------------------------------------------------------
// buildWangAtlas — malformed / missing-field fallback (never throws)
// ---------------------------------------------------------------------------

describe("buildWangAtlas — malformed/missing metadata", () => {
  it("null input → empty atlas with tileSize 16, no entries populated", () => {
    const atlas = buildWangAtlas(null);
    expect(atlas.tileSize).toBe(16);
    expect(atlas.rects).toHaveLength(16);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
    expect(atlas.base).toBeUndefined();
  });

  it("undefined input → same empty atlas", () => {
    const atlas = buildWangAtlas(undefined);
    expect(atlas.tileSize).toBe(16);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("empty object → empty atlas with tileSize 16", () => {
    const atlas = buildWangAtlas({});
    expect(atlas.tileSize).toBe(16);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("tile missing corners is skipped", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tiles: [{ bounding_box: { x: 0, y: 0, width: 16, height: 16 } }],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("tile missing bounding_box is skipped", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tiles: [
          { corners: { NW: "lower", NE: "lower", SW: "lower", SE: "lower" } },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("tile with partial corners (missing NE) is skipped", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tiles: [
          {
            corners: { NW: "lower", SW: "lower", SE: "lower" }, // NE missing
            bounding_box: { x: 0, y: 0, width: 16, height: 16 },
          },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("tile with bounding_box missing x is skipped", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tiles: [
          {
            corners: { NW: "lower", NE: "lower", SW: "lower", SE: "lower" },
            bounding_box: { y: 0, width: 16, height: 16 }, // x missing
          },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("tile with bounding_box missing y is skipped", () => {
    const meta: WangTilesetMeta = {
      tileset_data: {
        tiles: [
          {
            corners: { NW: "lower", NE: "lower", SW: "lower", SE: "lower" },
            bounding_box: { x: 0, width: 16, height: 16 }, // y missing
          },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("unknown corner string value is treated as lower", () => {
    const meta: WangTilesetMeta = {
      tile_size: { width: 16 },
      tileset_data: {
        tiles: [
          {
            corners: { NW: "unknown_value", NE: "lower", SW: "lower", SE: "lower" } as any,
            bounding_box: { x: 5, y: 5, width: 16, height: 16 },
          },
        ],
      },
    };
    // NW treated as lower (0) → index = 0
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects[0]).toEqual({ x: 5, y: 5, width: 16, height: 16 });
  });

  it("valid tiles are accepted even when mixed with invalid ones", () => {
    const meta: WangTilesetMeta = {
      tile_size: { width: 16 },
      tileset_data: {
        tiles: [
          // invalid: missing corners
          { bounding_box: { x: 0, y: 0, width: 16, height: 16 } },
          // valid: index 0
          {
            corners: { NW: "lower", NE: "lower", SW: "lower", SE: "lower" },
            bounding_box: { x: 99, y: 99, width: 16, height: 16 },
          },
          // invalid: bounding_box missing x
          {
            corners: { NW: "upper", NE: "upper", SW: "upper", SE: "upper" },
            bounding_box: { y: 48, width: 16, height: 16 },
          },
        ],
      },
    };
    const atlas = buildWangAtlas(meta);
    expect(atlas.rects[0]).toBeDefined();
    expect(atlas.rects[0]?.x).toBe(99);
    // Index 15 should be skipped due to missing x
    expect(atlas.rects[15]).toBeUndefined();
  });

  it("empty tiles array → empty atlas", () => {
    const atlas = buildWangAtlas({ tileset_data: { tiles: [] } });
    expect(atlas.rects.every((r) => r == null)).toBe(true);
  });

  it("missing tileset_data → empty atlas", () => {
    const atlas = buildWangAtlas({ tile_size: { width: 32 } });
    expect(atlas.rects.every((r) => r == null)).toBe(true);
    expect(atlas.tileSize).toBe(32);
  });
});

// ---------------------------------------------------------------------------
// wangRectForCorners
// ---------------------------------------------------------------------------

describe("wangRectForCorners", () => {
  it("returns the correct indexed rect when present", () => {
    const atlas = buildWangAtlas(makeMeta([0, 1, 15]));
    const rect = wangRectForCorners(atlas, cornersFromBits(1));
    expect(rect).toEqual(atlas.rects[1]);
  });

  it("falls back to base (rects[0]) when the requested index is absent", () => {
    // Only index 0 present; request index 7
    const atlas = buildWangAtlas(makeMeta([0]));
    const rect = wangRectForCorners(atlas, cornersFromBits(7));
    expect(rect).toEqual(atlas.rects[0]);
    expect(rect).toEqual(atlas.base);
  });

  it("falls back to any available rect when index is absent and base is also absent", () => {
    // Only index 5 present; request index 3
    const atlas = buildWangAtlas(makeMeta([5]));
    const rect = wangRectForCorners(atlas, cornersFromBits(3));
    expect(rect).toBeDefined();
    expect(rect).toEqual(atlas.rects[5]);
  });

  it("returns synthesised {0,0,tileSize,tileSize} when atlas is completely empty", () => {
    const atlas = buildWangAtlas(null);
    const rect = wangRectForCorners(atlas, cornersFromBits(0));
    expect(rect).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });

  it("synthesised fallback uses atlas.tileSize, not hard-coded 16", () => {
    const emptyAtlas = buildWangAtlas({ tile_size: { width: 32 } });
    const rect = wangRectForCorners(emptyAtlas, cornersFromBits(0));
    expect(rect).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it("always returns a defined WangRect for every index on a full atlas", () => {
    const atlas = buildWangAtlas(makeMeta(Array.from({ length: 16 }, (_, i) => i)));
    for (let i = 0; i < 16; i++) {
      const rect = wangRectForCorners(atlas, cornersFromBits(i));
      expect(rect, `index ${i}`).toBeDefined();
      expect(typeof rect.x).toBe("number");
      expect(typeof rect.y).toBe("number");
    }
  });

  it("always returns a defined WangRect even on an empty atlas for every index", () => {
    const atlas = buildWangAtlas(null);
    for (let i = 0; i < 16; i++) {
      const rect = wangRectForCorners(atlas, cornersFromBits(i));
      expect(rect, `index ${i}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// flatLowerField and cornersAt (bonus coverage)
// ---------------------------------------------------------------------------

describe("flatLowerField", () => {
  it("always returns 'lower' regardless of coords", () => {
    expect(flatLowerField(0, 0)).toBe("lower");
    expect(flatLowerField(-100, 999)).toBe("lower");
    expect(flatLowerField(1000000, 1000000)).toBe("lower");
  });
});

describe("cornersAt", () => {
  it("maps (col,row) to the four lattice corner positions", () => {
    const called: string[] = [];
    const tracer = (cx: number, cy: number): "lower" => {
      called.push(`${cx},${cy}`);
      return "lower";
    };
    cornersAt(3, 5, tracer);
    expect(called).toContain("3,5");   // NW
    expect(called).toContain("4,5");   // NE
    expect(called).toContain("3,6");   // SW
    expect(called).toContain("4,6");   // SE
    expect(called).toHaveLength(4);
  });

  it("returns all-lower when used with flatLowerField", () => {
    const c = cornersAt(0, 0, flatLowerField);
    expect(c.NW).toBe("lower");
    expect(c.NE).toBe("lower");
    expect(c.SW).toBe("lower");
    expect(c.SE).toBe("lower");
    expect(cornersToIndex(c)).toBe(0);
  });

  it("passes the correct corner coordinates for upper-left tile (0,0)", () => {
    const recorded = new Map<string, "lower" | "upper">();
    const spy = (cx: number, cy: number): "lower" | "upper" => {
      recorded.set(`${cx},${cy}`, "upper");
      return "upper";
    };
    const c = cornersAt(0, 0, spy);
    expect(c.NW).toBe("upper"); // (0,0)
    expect(c.NE).toBe("upper"); // (1,0)
    expect(c.SW).toBe("upper"); // (0,1)
    expect(c.SE).toBe("upper"); // (1,1)
  });

  it("cornersAt + cornersToIndex gives 15 when all corners are upper", () => {
    const c = cornersAt(7, 3, () => "upper");
    expect(cornersToIndex(c)).toBe(15);
  });
});
