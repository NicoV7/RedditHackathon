/**
 * Pure-logic tests for the avatar A* pathfinder (src/client/phaser/pathfind.ts).
 *
 * Scope: A* is a PURE function of (grid, start, goal) — no Phaser, no DOM, no WebGL,
 * no clocks, no Math.random. These tests prove correctness + DETERMINISM (the same
 * inputs always yield the byte-identical path), which is what lets the cosmetic tween
 * in world.ts stay decoupled from the logical zone snap. No browser is required.
 */
import { describe, it, expect } from "vitest";
import { findPath, isBlocked, type Cell } from "./pathfind.js";
import type { NavGrid } from "../../shared/case.js";

function grid(cols: number, rows: number, blocked: number[] = []): NavGrid {
  return { cellSize: 16, origin: { x: 0, y: 0 }, cols, rows, blocked };
}

describe("findPath (A* over navGrid)", () => {
  it("returns a path including both endpoints on an open grid", () => {
    const g = grid(5, 5);
    const path = findPath(g, { col: 0, row: 0 }, { col: 4, row: 4 });
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ col: 0, row: 0 });
    expect(path[path.length - 1]).toEqual({ col: 4, row: 4 });
  });

  it("produces the Manhattan-optimal length on an open grid", () => {
    const g = grid(6, 6);
    const path = findPath(g, { col: 0, row: 0 }, { col: 3, row: 2 });
    // optimal path visits |dx| + |dy| + 1 cells (4-neighbour)
    expect(path.length).toBe(3 + 2 + 1);
  });

  it("returns a single-cell path when start === goal", () => {
    const g = grid(4, 4);
    expect(findPath(g, { col: 2, row: 2 }, { col: 2, row: 2 })).toEqual([{ col: 2, row: 2 }]);
  });

  it("is deterministic — identical inputs yield identical paths", () => {
    const g = grid(8, 8);
    const a = findPath(g, { col: 0, row: 0 }, { col: 7, row: 5 });
    const b = findPath(g, { col: 0, row: 0 }, { col: 7, row: 5 });
    expect(a).toEqual(b);
  });

  it("routes around a blocking wall", () => {
    // a vertical wall in column 2 from row 0..2, leaving row 3 open as the gap
    const cols = 5;
    const blocked = [2, 7, 12]; // (2,0),(2,1),(2,2) → row*cols+col
    const g = grid(cols, 5, blocked);
    const path = findPath(g, { col: 0, row: 0 }, { col: 4, row: 0 });
    expect(path.length).toBeGreaterThan(0);
    // never steps onto a blocked cell
    for (const c of path) expect(isBlocked(g, c.col, c.row)).toBe(false);
    // it must detour through the open gap (row 3 or beyond) since the wall blocks the direct line
    expect(path.some((c: Cell) => c.row >= 3)).toBe(true);
  });

  it("returns empty when the goal is unreachable (fully walled off)", () => {
    // wall column 1 across every row → column 0 island can't reach column 2
    const cols = 3;
    const rows = 3;
    const blocked = [1, 4, 7]; // (1,0),(1,1),(1,2)
    const g = grid(cols, rows, blocked);
    expect(findPath(g, { col: 0, row: 0 }, { col: 2, row: 2 })).toEqual([]);
  });

  it("returns empty when start or goal is blocked or out of bounds", () => {
    const g = grid(4, 4, [5]); // (1,1) blocked
    expect(findPath(g, { col: 1, row: 1 }, { col: 3, row: 3 })).toEqual([]);
    expect(findPath(g, { col: 0, row: 0 }, { col: 1, row: 1 })).toEqual([]);
    expect(findPath(g, { col: -1, row: 0 }, { col: 2, row: 2 })).toEqual([]);
  });
});
