/**
 * src/client/phaser/movement.ts — PURE locomotion helpers for the free-flowing
 * overworld (PLAN Part 6.1). No Phaser, no DOM, no clocks, no Math.random — every
 * function is a deterministic, unit-testable f(args) so the world.ts physics layer
 * stays decoupled from the logical-zone derivation.
 *
 * DETERMINISM BOUNDARY (CLAUDE.md hard rule): the avatar's continuous FLOAT
 * position is COSMETIC and is never read by game logic. The only thing perception
 * reads is the ZONE the avatar is standing in, derived here by `pointInZone(x,y)`
 * over the zone pixel bounds, and reported (on CHANGE only) via onMovePlayer. The
 * input→velocity helpers are likewise cosmetic — they shape how the sprite glides,
 * never what is true. (Smooth motion is presentation; zone+tick is the logic.)
 */
import type { MapDef, NavGrid, Zone } from "../../shared/case.js";

/** A zone's pixel rectangle on the world canvas (origin + cellSize scaled bounds). */
export interface ZoneBoundsPx {
  readonly id: string;
  readonly px: number; // left
  readonly py: number; // top
  readonly pw: number; // width
  readonly ph: number; // height
}

/** Project a zone's grid-cell bounds into pixel space. Pure; mirrors world render. */
export function zoneBoundsPx(grid: NavGrid, zone: Zone): ZoneBoundsPx {
  return {
    id: zone.id,
    px: grid.origin.x + zone.bounds.x * grid.cellSize,
    py: grid.origin.y + zone.bounds.y * grid.cellSize,
    pw: zone.bounds.w * grid.cellSize,
    ph: zone.bounds.h * grid.cellSize,
  };
}

/** Project every zone in a map. Stable order (map order) so ties resolve the same. */
export function allZoneBoundsPx(map: MapDef): ZoneBoundsPx[] {
  return map.zones.map((z) => zoneBoundsPx(grid(map), z));
}

function grid(map: MapDef): NavGrid {
  return map.navGrid;
}

/** True iff a pixel point lies inside a zone's pixel rectangle (half-open on the
 *  far edges so adjacent zones never both claim a boundary pixel). Pure. */
export function pointInBounds(b: ZoneBoundsPx, x: number, y: number): boolean {
  return x >= b.px && x < b.px + b.pw && y >= b.py && y < b.py + b.ph;
}

/**
 * Which zone id (if any) contains a float pixel point — the LOGICAL position the
 * perception model reads. Pure & deterministic: walks zones in map order and
 * returns the FIRST whose pixel rect contains the point (stable on overlaps). When
 * no zone contains the point (e.g. a hallway gap), returns null and the caller
 * keeps the last zone (no spurious perception change).
 *
 * COSMETIC-FX GUARD: only the RETURNED zone id is ever read by logic; the x/y
 * floats that produced it are presentation and are discarded here.
 */
export function pointInZone(zones: readonly ZoneBoundsPx[], x: number, y: number): string | null {
  for (const b of zones) {
    if (pointInBounds(b, x, y)) return b.id;
  }
  return null;
}

/** A normalized 2-axis input intent in [-1,1] per axis (pre-normalization). */
export interface InputAxes {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Turn raw held-key booleans into a NORMALIZED direction vector. Opposite keys
 * cancel; diagonals are unit-length (so diagonal travel isn't ~1.41× faster).
 * Returns {0,0} when no (or fully-cancelled) input. Pure & deterministic — purely
 * cosmetic steering, never read by logic.
 */
export function inputVector(keys: {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
}): InputAxes {
  let dx = 0;
  let dy = 0;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;
  if (keys.up) dy -= 1;
  if (keys.down) dy += 1;
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  const len = Math.hypot(dx, dy);
  return { dx: dx / len, dy: dy / len };
}

/**
 * A steering vector from the avatar toward a target point (mobile tap-to-walk).
 * Returns a unit vector toward the target, or {0,0} once within `stopRadius` so the
 * avatar halts on arrival rather than orbiting. Pure & cosmetic.
 */
export function steerToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  stopRadius: number,
): InputAxes {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist <= stopRadius || dist === 0) return { dx: 0, dy: 0 };
  return { dx: dx / dist, dy: dy / dist };
}

/**
 * Clamp a pixel point to stay inside the union of all zone rects (with a small
 * inset margin). Used to keep the cosmetic avatar from gliding off the playfield
 * when no wall colliders are present. Pure; returns the nearest in-bounds point.
 * Cosmetic only — the avatar's logical zone is still pointInZone of the result.
 */
export function clampToPlayfield(
  zones: readonly ZoneBoundsPx[],
  x: number,
  y: number,
  margin = 0,
): { x: number; y: number } {
  if (zones.length === 0) return { x, y };
  // If already inside any zone, leave it.
  if (pointInZone(zones, x, y) !== null) return { x, y };
  // Otherwise clamp to the overall bounding box (cheap, deterministic).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of zones) {
    minX = Math.min(minX, b.px);
    minY = Math.min(minY, b.py);
    maxX = Math.max(maxX, b.px + b.pw);
    maxY = Math.max(maxY, b.py + b.ph);
  }
  return {
    x: Math.min(Math.max(x, minX + margin), maxX - margin),
    y: Math.min(Math.max(y, minY + margin), maxY - margin),
  };
}
