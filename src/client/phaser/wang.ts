/**
 * src/client/phaser/wang.ts — PixelLab "tileset15" Wang-corner lookup (PLAN Part 4,
 * "Best Use of Phaser" floor autotiling). PURE, allocation-light, unit-testable; it
 * imports neither Phaser nor any asset, so it stays version-agnostic and trivially
 * fuzzable.
 *
 * A PixelLab top-down tileset PNG is a 4×4 grid of sixteen 16×16 Wang tiles. Each
 * tile fills its four corners (NW, NE, SW, SE) with one of two terrains — "lower"
 * (the base floor, encoded 0) or "upper" (the overlay, e.g. a rug / puddle, encoded
 * 1). The canonical Wang index is:
 *
 *     index = NW*8 + NE*4 + SW*2 + SE*1            (lower = 0, upper = 1)
 *
 * The PNG, however, does NOT lay the tiles out in index order — the JSON metadata
 * pins each tile's pixel `bounding_box {x,y,width,height}`. So we parse the metadata
 * once into an index → source-rect table (`buildWangAtlas`) and look tiles up by
 * index (`cornersToIndex`, `wangRectForCorners`).
 *
 * COSMETIC-FX GUARD (CLAUDE.md / PLAN 4.2): nothing here is read by game logic. The
 * terrain field a caller autotiles is decorative; logical zone/tick state never
 * depends on which Wang tile shows. Deterministic & integer-pure (no RNG, no float
 * accumulation in any returned value).
 */

/** A single tile's source rectangle inside the tileset PNG (pixels). */
export interface WangRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The two terrain layers PixelLab encodes per corner. */
export type Terrain = "lower" | "upper";

/** Corner terrains for one tile cell (the 2×2 that defines its Wang index). */
export interface Corners {
  readonly NW: Terrain;
  readonly NE: Terrain;
  readonly SW: Terrain;
  readonly SE: Terrain;
}

/**
 * Minimal shape of the bits of a PixelLab tileset JSON we read. Everything optional
 * so a partial / malformed file degrades to an empty atlas instead of throwing.
 */
export interface WangTilesetMeta {
  readonly tile_size?: { width?: number; height?: number };
  readonly tileset_data?: {
    readonly tiles?: ReadonlyArray<{
      readonly corners?: Partial<Record<keyof Corners, string>>;
      readonly bounding_box?: Partial<WangRect>;
    }>;
    readonly tile_size?: { width?: number; height?: number };
  };
}

/** The 16-entry source-rect table, indexed by canonical Wang index 0..15. */
export interface WangAtlas {
  /** index 0..15 → source rect; an absent entry falls back to the base tile. */
  readonly rects: ReadonlyArray<WangRect | undefined>;
  /** Tile edge length in px (square tiles assumed; 16 for PixelLab tileset15). */
  readonly tileSize: number;
  /** Convenience: the all-lower base tile rect (index 0), or undefined if absent. */
  readonly base?: WangRect;
}

/** lower → 0, anything else (upper) → 1. Defensive: unknown strings read as lower. */
function bit(t: string | undefined): 0 | 1 {
  return t === "upper" ? 1 : 0;
}

/**
 * Canonical Wang index for a corner set: NW*8 + NE*4 + SW*2 + SE*1 over {lower:0,
 * upper:1}. Pure; range 0..15.
 */
export function cornersToIndex(c: Corners): number {
  return bit(c.NW) * 8 + bit(c.NE) * 4 + bit(c.SW) * 2 + bit(c.SE) * 1;
}

/**
 * Parse a PixelLab tileset JSON into an index → source-rect atlas. Tolerant of
 * missing fields: any tile lacking complete corners/bbox is skipped, and `tileSize`
 * defaults to 16. Never throws.
 */
export function buildWangAtlas(meta: WangTilesetMeta | null | undefined): WangAtlas {
  const tileSize =
    meta?.tile_size?.width ?? meta?.tileset_data?.tile_size?.width ?? 16;
  const rects: Array<WangRect | undefined> = new Array(16).fill(undefined);
  const tiles = meta?.tileset_data?.tiles ?? [];
  for (const tile of tiles) {
    const c = tile.corners;
    const bb = tile.bounding_box;
    if (!c || !bb) continue;
    if (c.NW == null || c.NE == null || c.SW == null || c.SE == null) continue;
    if (bb.x == null || bb.y == null) continue;
    const idx = cornersToIndex({
      NW: c.NW === "upper" ? "upper" : "lower",
      NE: c.NE === "upper" ? "upper" : "lower",
      SW: c.SW === "upper" ? "upper" : "lower",
      SE: c.SE === "upper" ? "upper" : "lower",
    });
    rects[idx] = {
      x: bb.x,
      y: bb.y,
      width: bb.width ?? tileSize,
      height: bb.height ?? tileSize,
    };
  }
  const atlas: WangAtlas = { rects, tileSize, base: rects[0] };
  return atlas;
}

/**
 * Resolve a corner set to its source rect, falling back to the base (all-lower)
 * tile, then to a synthesized top-left 16×16 rect, so a caller always has SOMETHING
 * to draw even from a sparse atlas. Pure.
 */
export function wangRectForCorners(atlas: WangAtlas, c: Corners): WangRect {
  const idx = cornersToIndex(c);
  return (
    atlas.rects[idx] ??
    atlas.base ??
    atlas.rects.find((r): r is WangRect => r != null) ?? {
      x: 0,
      y: 0,
      width: atlas.tileSize,
      height: atlas.tileSize,
    }
  );
}

/**
 * Sample a boolean "upper-terrain" field at integer corner-lattice point (cx, cy)
 * deterministically. A terrain field has one more lattice point than tiles per axis
 * (corners sit between tiles). This default field paints an all-lower floor (every
 * corner = lower) — the cheapest correct autotiling: every cell resolves to the base
 * tile. Callers wanting rugs/puddles pass their own field. Pure & integer-only.
 */
export function flatLowerField(_cx: number, _cy: number): Terrain {
  return "lower";
}

/**
 * Build the four corner terrains for the tile at integer (col, row) given a
 * corner-field sampler `f(cornerX, cornerY) → Terrain`. The tile at (col,row) owns
 * the corner lattice points (col,row)=NW, (col+1,row)=NE, (col,row+1)=SW,
 * (col+1,row+1)=SE. Pure; the sampler MUST itself be deterministic.
 */
export function cornersAt(
  col: number,
  row: number,
  f: (cx: number, cy: number) => Terrain,
): Corners {
  return {
    NW: f(col, row),
    NE: f(col + 1, row),
    SW: f(col, row + 1),
    SE: f(col + 1, row + 1),
  };
}
