/**
 * src/client/phaser/roomLayout.ts — PURE side-scroll room deriver (platformer overworld).
 *
 * Turns the existing top-down map data (a room's `Zone` + `NavGrid` + the doors/items/
 * NPCs that belong to it) into a 2D SIDE-SCROLL layout: a world wider than the viewport,
 * a ground line, a few cosmetic platforms, and a spawn-X on the ground for every
 * interactable. No Phaser, no DOM, no clocks, no Math.random — a deterministic f(args)
 * so the world.ts physics scene stays a thin cosmetic shell.
 *
 * DETERMINISM BOUNDARY (CLAUDE.md hard rule): everything here is a RENDER coordinate.
 * `Zone.bounds`/`NavGrid` are client-render-only (the validator/solver/reachability never
 * read them), so deriving a wider world from them never touches solvability. The only
 * seeded randomness is `mulberry32(hashSeed(\`${dailySeed}|${zoneId}\`))` — never RNG/clock.
 * Interactable X is COORDS-driven (a pure function of the door/item cell + world width),
 * so the seed only ever moves cosmetic platforms; an interactable never shifts.
 */
import type { Door, NavGrid, Zone } from "../../shared/case.js";
import { hashSeed, mulberry32 } from "../../shared/prng.js";

// ── Layout tuning (all in navGrid CELLS unless noted; multiplied by cellSize to px) ──
/** Ground slab thickness below the walk line. */
const GROUND_THICKNESS_CELLS = 2;
/** Room width = grid.cols × this multiplier → always wider than the (cols-wide) viewport. */
const WORLD_WIDTH_MULT_MIN = 2;
const WORLD_WIDTH_MULT_SPAN = 2; // → ×2 or ×3
/** Cosmetic platform count + size + how high above the ground they float. */
const PLATFORM_COUNT_MIN = 2;
const PLATFORM_COUNT_SPAN = 3; // → 2..4 platforms
const PLATFORM_WIDTH_CELLS_MIN = 3;
const PLATFORM_WIDTH_CELLS_SPAN = 3; // → 3..5 cells wide
const PLATFORM_THICKNESS_CELLS = 1;
const PLATFORM_RISE_CELLS_MIN = 3;
const PLATFORM_RISE_CELLS_SPAN = 2; // → 3..4 cells above the ground (within jump reach)
/** Keep interactables/platforms this far off the world's left/right edges. */
const EDGE_INSET_CELLS = 2;
/** Minimum horizontal gap between two interactables so glyphs never stack. */
const MIN_PLACEMENT_GAP_CELLS = 2;

export type PlacementKind = "npc" | "door" | "item";

/** A floating cosmetic platform rect, in world pixels (integer). */
export interface PlatformRect {
  x: number; // left
  y: number; // top (the standable surface)
  w: number;
  h: number;
}

/** Where one interactable stands in the side-scroll room (world pixels, integer). */
export interface Placement {
  id: string;
  kind: PlacementKind;
  x: number; // horizontal centre
  surfaceY: number; // the Y its feet rest on (ground line, in v1)
  toZone?: string; // doors only — the room this door leads to
}

/** A fully-derived side-scroll room. All fields are integer world pixels. */
export interface RoomLayout {
  zoneId: string;
  worldW: number; // strictly > viewport width → the camera scrolls
  worldH: number; // = grid.rows × cellSize (no vertical scroll in v1)
  groundY: number; // the walk line (top of the ground slab)
  platforms: PlatformRect[];
  placements: Placement[]; // doors, then items, then NPCs — stable order
}

/** Minimal interactable shapes the deriver needs (subset of the client views). */
export interface LayoutItem {
  readonly id: string;
  readonly coords: { x: number; y: number };
}
export interface LayoutNpc {
  readonly id: string;
}

export interface RoomLayoutInput {
  zone: Zone;
  grid: NavGrid;
  doors: readonly Door[];
  items: readonly LayoutItem[];
  npcs: readonly LayoutNpc[];
  dailySeed: string;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Map a top-down grid column to a side-scroll world X, preserving the column's relative
 * position (cell 0 → near the left edge, the last cell → near the right edge) and keeping
 * an edge inset. PURE — shared by the layout deriver and the door-entry reposition so a
 * cell maps to the same X both places. Result is an integer.
 */
export function cellToWorldX(cellX: number, cols: number, worldW: number, cellSize: number): number {
  const maxCol = Math.max(1, cols - 1);
  const frac = clamp(cellX, 0, maxCol) / maxCol;
  const inset = EDGE_INSET_CELLS * cellSize;
  const span = Math.max(0, worldW - inset * 2);
  return Math.round(inset + frac * span);
}

/** Evenly space `count` items across the insettable width; item `index` (0-based). */
function evenSpreadX(index: number, count: number, worldW: number, insetPx: number): number {
  const span = Math.max(0, worldW - insetPx * 2);
  return Math.round(insetPx + ((index + 1) / (count + 1)) * span);
}

/**
 * Nudge any interactable that lands within `minGapPx` of an already-placed one to the
 * right (stable by the input order), so glyphs never stack. Deterministic; clamps to the
 * insettable width. Cosmetic — `nearestInteractable` would tie-break anyway.
 */
function spreadPlacements(placements: Placement[], minGapPx: number, worldW: number, insetPx: number): Placement[] {
  const used: number[] = [];
  return placements.map((p) => {
    let x = clamp(p.x, insetPx, worldW - insetPx);
    while (used.some((u) => Math.abs(u - x) < minGapPx) && x + minGapPx <= worldW - insetPx) {
      x += minGapPx;
    }
    used.push(x);
    return { ...p, x };
  });
}

/** Derive the cosmetic floating platforms for a room (seeded; never read by logic). */
function derivePlatforms(
  rng: { int(n: number): number },
  worldW: number,
  groundY: number,
  cellSize: number,
  insetPx: number,
): PlatformRect[] {
  const count = PLATFORM_COUNT_MIN + rng.int(PLATFORM_COUNT_SPAN);
  const platforms: PlatformRect[] = [];
  for (let i = 0; i < count; i++) {
    const w = (PLATFORM_WIDTH_CELLS_MIN + rng.int(PLATFORM_WIDTH_CELLS_SPAN)) * cellSize;
    const riseCells = PLATFORM_RISE_CELLS_MIN + rng.int(PLATFORM_RISE_CELLS_SPAN);
    const maxX = Math.max(insetPx, worldW - insetPx - w);
    const xSpan = Math.max(0, maxX - insetPx);
    const x = insetPx + (xSpan > 0 ? rng.int(xSpan) : 0);
    const y = groundY - riseCells * cellSize;
    platforms.push({ x, y, w, h: PLATFORM_THICKNESS_CELLS * cellSize });
  }
  return platforms;
}

/**
 * Derive a deterministic side-scroll layout for one room. The seed only moves cosmetic
 * platforms + the world width; door/item/NPC X is a pure function of their cell/order, so
 * an interactable never shifts between runs.
 */
export function roomLayout(input: RoomLayoutInput): RoomLayout {
  const { zone, grid, doors, items, npcs, dailySeed } = input;
  const { cellSize, cols, rows } = grid;
  const rng = mulberry32(hashSeed(`${dailySeed}|${zone.id}`));

  const widthMult = WORLD_WIDTH_MULT_MIN + rng.int(WORLD_WIDTH_MULT_SPAN);
  const worldW = cols * widthMult * cellSize;
  const worldH = rows * cellSize;
  const groundY = worldH - GROUND_THICKNESS_CELLS * cellSize;
  const insetPx = EDGE_INSET_CELLS * cellSize;

  const platforms = derivePlatforms(rng, worldW, groundY, cellSize, insetPx);

  // COORDS-driven X for doors + items (preserves left/right wall side); even spread for
  // NPCs (which carry no coords). Fixed order: doors, then items, then NPCs.
  const doorPlacements: Placement[] = doors.map((d) => ({
    id: `${d.from}->${d.to}`,
    kind: "door" as const,
    x: cellToWorldX(d.coords.x, cols, worldW, cellSize),
    surfaceY: groundY,
    toZone: d.to,
  }));
  const itemPlacements: Placement[] = items.map((it) => ({
    id: it.id,
    kind: "item" as const,
    x: cellToWorldX(it.coords.x, cols, worldW, cellSize),
    surfaceY: groundY,
  }));
  const npcPlacements: Placement[] = npcs.map((n, i) => ({
    id: n.id,
    kind: "npc" as const,
    x: evenSpreadX(i, npcs.length, worldW, insetPx),
    surfaceY: groundY,
  }));

  const minGapPx = MIN_PLACEMENT_GAP_CELLS * cellSize;
  const placements = spreadPlacements(
    [...doorPlacements, ...itemPlacements, ...npcPlacements],
    minGapPx,
    worldW,
    insetPx,
  );

  return { zoneId: zone.id, worldW, worldH, groundY, platforms, placements };
}
