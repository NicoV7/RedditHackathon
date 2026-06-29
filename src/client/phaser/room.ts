/**
 * src/client/phaser/room.ts — PURE helpers for the ROOM-BASED overworld (PLAN
 * Part 6.1). The world renders ONE active zone (room) at a time on the local 25×25
 * navGrid; the avatar walks freely WITHIN the room and DOORS (not walking) transition
 * between rooms. These selectors decide what belongs in a room and where a door drops
 * the avatar — all deterministic, integer-pure f(args): no Phaser, no DOM, no clocks,
 * no Math.random — so the world.ts scene wiring stays a thin cosmetic shell.
 *
 * DETERMINISM BOUNDARY (CLAUDE.md hard rule): every coordinate produced here is a
 * RENDER cell on the navGrid; the only LOGICAL signal is the active zone id (reported
 * via onMovePlayer on a door transition). Nothing here is read by the validator,
 * solver, or reachability — zone bounds / navGrid are client-render only.
 */
import type { Door, NavGrid } from "../../shared/case.js";

/** Minimal shape of a room-resident NPC view (homeZone is its room). */
export interface RoomNpc {
  readonly homeZone: string;
}
/** Minimal shape of a room-resident item view (zone is its room). */
export interface RoomItem {
  readonly zone: string;
}

/**
 * The NPCs whose HOME room is the active zone — the only NPCs rendered in a
 * room-based scene. Stable input order (no sort) so placement is reproducible.
 * Pure & deterministic.
 */
export function npcsInRoom<T extends RoomNpc>(npcs: readonly T[], zoneId: string): T[] {
  return npcs.filter((n) => n.homeZone === zoneId);
}

/**
 * The items that live in the active room — the only items rendered there. Stable
 * input order. Pure & deterministic.
 */
export function itemsInRoom<T extends RoomItem>(items: readonly T[], zoneId: string): T[] {
  return items.filter((i) => i.zone === zoneId);
}

/**
 * The doors LEAVING the active room (i.e. `from === zoneId`) — the only doors a
 * player can use while standing in that room. Stable input order. Pure.
 */
export function doorsFromRoom(doors: readonly Door[] | undefined, zoneId: string): Door[] {
  return (doors ?? []).filter((d) => d.from === zoneId);
}

/**
 * The cell the avatar should appear on when ARRIVING in a room via a door. ROOM-BASED
 * model: a door's own `coords` mark an edge of its FROM-room; stepping through it drops
 * you at the MIRROR edge of the destination room (a door on the FROM-room's RIGHT wall
 * drops you near the destination room's LEFT wall — you walked rightward, so you enter
 * from the left), nudged one cell INWARD so the avatar stands inside the room, not on
 * the wall. The result is always clamped on-grid. Pure integer math — no RNG, no floats.
 */
export function doorEntryCell(grid: NavGrid, door: Door): { col: number; row: number } {
  const maxC = grid.cols - 1;
  const maxR = grid.rows - 1;
  const cx = clamp(Math.round(door.coords.x), 0, maxC);
  const cy = clamp(Math.round(door.coords.y), 0, maxR);

  // Default: keep the door's own column/row, just stepped inward off any wall it sat on.
  let col = clamp(cx, 1, maxC - 1);
  let row = clamp(cy, 1, maxR - 1);

  // Mirror across whichever wall the FROM-door sat on so the entry reads as "coming
  // through" that wall from the opposite side.
  if (cx === 0) col = maxC - 1; // FROM left wall  → enter from the right
  else if (cx === maxC) col = 1; // FROM right wall → enter from the left
  if (cy === 0) row = maxR - 1; // FROM top wall   → enter from the bottom
  else if (cy === maxR) row = 1; // FROM bottom wall→ enter from the top

  return { col: clamp(col, 0, maxC), row: clamp(row, 0, maxR) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
