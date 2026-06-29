/**
 * src/client/phaser/pathfind.ts — pure A* over the case navGrid (Pillar 3).
 *
 * DETERMINISM / TESTABILITY: this is a PURE function of (grid, start, goal). No
 * Phaser, no DOM, no clocks, no Math.random — it is unit-testable in plain node
 * (see pathfind.test.ts). The COSMETIC tween that animates the avatar along the
 * returned cells lives in world.ts; the avatar's LOGICAL position is the zone it
 * snaps into, reported via WorldHandlers.onMovePlayer — never the pixel path.
 *
 * Ties are broken deterministically (insertion order + a stable heuristic) so the
 * same inputs always yield the same path on every device.
 */
import type { NavGrid } from "../../shared/case.js";

export interface Cell {
  col: number;
  row: number;
}

function idx(grid: NavGrid, col: number, row: number): number {
  return row * grid.cols + col;
}

export function isBlocked(grid: NavGrid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return true;
  return grid.blocked?.includes(idx(grid, col, row)) ?? false;
}

/** Manhattan distance — admissible for 4-neighbour movement. Integer-pure. */
function heuristic(a: Cell, b: Cell): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * 4-neighbour A* on the navGrid. Returns the cell path INCLUDING start and goal,
 * or an empty array if no path exists (or start/goal are blocked/out of bounds).
 */
export function findPath(grid: NavGrid, start: Cell, goal: Cell): Cell[] {
  if (isBlocked(grid, start.col, start.row)) return [];
  if (isBlocked(grid, goal.col, goal.row)) return [];
  if (start.col === goal.col && start.row === goal.row) return [start];

  const startKey = idx(grid, start.col, start.row);
  const goalKey = idx(grid, goal.col, goal.row);

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open = new Map<number, Cell>(); // key → cell (acts as the open set)
  gScore.set(startKey, 0);
  open.set(startKey, start);

  // 4-neighbour deltas in a fixed order → deterministic tie-breaking.
  const deltas: ReadonlyArray<readonly [number, number]> = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (open.size > 0) {
    // pick the open cell with the lowest f = g + h; deterministic by key on ties.
    let bestKey = -1;
    let bestF = Infinity;
    let bestCell: Cell | null = null;
    for (const [key, cell] of open) {
      const g = gScore.get(key) ?? Infinity;
      const f = g + heuristic(cell, goal);
      if (f < bestF || (f === bestF && key < bestKey)) {
        bestF = f;
        bestKey = key;
        bestCell = cell;
      }
    }
    if (bestCell === null) break;

    if (bestKey === goalKey) {
      return reconstruct(grid, cameFrom, goalKey);
    }

    open.delete(bestKey);
    const baseG = gScore.get(bestKey) ?? Infinity;

    for (const [dc, dr] of deltas) {
      const nc = bestCell.col + dc;
      const nr = bestCell.row + dr;
      if (isBlocked(grid, nc, nr)) continue;
      const nKey = idx(grid, nc, nr);
      const tentative = baseG + 1;
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, bestKey);
        gScore.set(nKey, tentative);
        if (!open.has(nKey)) open.set(nKey, { col: nc, row: nr });
      }
    }
  }
  return [];
}

function reconstruct(grid: NavGrid, cameFrom: Map<number, number>, goalKey: number): Cell[] {
  const path: Cell[] = [];
  let cur: number | undefined = goalKey;
  while (cur !== undefined) {
    const col = cur % grid.cols;
    const row = Math.floor(cur / grid.cols);
    path.push({ col, row });
    cur = cameFrom.get(cur);
  }
  return path.reverse();
}
