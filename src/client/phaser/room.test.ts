/**
 * Pure-logic tests for the ROOM-BASED overworld selectors (src/client/phaser/room.ts).
 *
 * Every tested function is a deterministic f(args) — no Phaser, no DOM, no clocks,
 * no Math.random. Tests cover:
 *   - npcsInRoom: filters by homeZone, preserves input order, empty on no match
 *   - itemsInRoom: filters by zone, preserves input order
 *   - doorsFromRoom: filters by `from`, tolerates undefined door list
 *   - doorEntryCell: mirror-across-wall entry, inward nudge, on-grid clamping
 */
import { describe, it, expect } from "vitest";
import { npcsInRoom, itemsInRoom, doorsFromRoom, doorEntryCell } from "./room.js";
import type { Door, NavGrid } from "../../shared/case.js";

// ─────────────────────────── Fixture helpers ───────────────────────────

function makeGrid(opts?: Partial<NavGrid>): NavGrid {
  return { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25, ...opts };
}

function door(from: string, to: string, x: number, y: number): Door {
  return { from, to, coords: { x, y } };
}

// ───────────────────────────── npcsInRoom ─────────────────────────────

describe("npcsInRoom", () => {
  const npcs = [
    { id: "a", homeZone: "bar" },
    { id: "b", homeZone: "cellar" },
    { id: "c", homeZone: "bar" },
  ];

  it("returns only the NPCs whose homeZone is the active room, in input order", () => {
    const got = npcsInRoom(npcs, "bar");
    expect(got.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array when no NPC lives in the room", () => {
    expect(npcsInRoom(npcs, "attic")).toEqual([]);
  });

  it("returns an empty array for an empty roster", () => {
    expect(npcsInRoom([], "bar")).toEqual([]);
  });
});

// ───────────────────────────── itemsInRoom ─────────────────────────────

describe("itemsInRoom", () => {
  const items = [
    { id: "key", zone: "bar" },
    { id: "glass", zone: "cellar" },
    { id: "note", zone: "bar" },
  ];

  it("returns only the items whose zone is the active room, in input order", () => {
    const got = itemsInRoom(items, "bar");
    expect(got.map((i) => i.id)).toEqual(["key", "note"]);
  });

  it("returns an empty array when no item is in the room", () => {
    expect(itemsInRoom(items, "attic")).toEqual([]);
  });
});

// ──────────────────────────── doorsFromRoom ────────────────────────────

describe("doorsFromRoom", () => {
  const doors: Door[] = [
    door("bar", "cellar", 24, 12),
    door("cellar", "bar", 0, 12),
    door("bar", "attic", 12, 0),
  ];

  it("returns only the doors leaving the active room (from === zoneId)", () => {
    const got = doorsFromRoom(doors, "bar");
    expect(got.map((d) => d.to)).toEqual(["cellar", "attic"]);
  });

  it("returns an empty array when no door leaves the room", () => {
    expect(doorsFromRoom(doors, "attic")).toEqual([]);
  });

  it("tolerates an undefined door list", () => {
    expect(doorsFromRoom(undefined, "bar")).toEqual([]);
  });
});

// ──────────────────────────── doorEntryCell ────────────────────────────

describe("doorEntryCell", () => {
  const grid = makeGrid(); // 25×25 → max col/row = 24

  it("a FROM right-wall door (x=24) drops the avatar near the LEFT wall (col=1)", () => {
    const cell = doorEntryCell(grid, door("bar", "cellar", 24, 12));
    expect(cell.col).toBe(1);
    expect(cell.row).toBe(12);
  });

  it("a FROM left-wall door (x=0) drops the avatar near the RIGHT wall (col=23)", () => {
    const cell = doorEntryCell(grid, door("cellar", "bar", 0, 12));
    expect(cell.col).toBe(23); // maxC - 1
    expect(cell.row).toBe(12);
  });

  it("a FROM top-wall door (y=0) drops the avatar near the BOTTOM wall (row=23)", () => {
    const cell = doorEntryCell(grid, door("bar", "attic", 12, 0));
    expect(cell.col).toBe(12);
    expect(cell.row).toBe(23);
  });

  it("a FROM bottom-wall door (y=24) drops the avatar near the TOP wall (row=1)", () => {
    const cell = doorEntryCell(grid, door("bar", "attic", 12, 24));
    expect(cell.col).toBe(12);
    expect(cell.row).toBe(1);
  });

  it("never returns an off-grid cell, even for out-of-range coords", () => {
    const cell = doorEntryCell(grid, door("bar", "x", 999, -7));
    expect(cell.col).toBeGreaterThanOrEqual(0);
    expect(cell.col).toBeLessThanOrEqual(24);
    expect(cell.row).toBeGreaterThanOrEqual(0);
    expect(cell.row).toBeLessThanOrEqual(24);
  });

  it("rounds fractional coords and keeps an interior door one cell off the wall", () => {
    // An interior (non-wall) door: coords stay (rounded), only nudged off walls.
    const cell = doorEntryCell(grid, door("bar", "y", 6.4, 18.6));
    expect(cell).toEqual({ col: 6, row: 19 });
  });

  it("handles a corner door (top-left) by mirroring both axes", () => {
    const cell = doorEntryCell(grid, door("bar", "z", 0, 0));
    expect(cell).toEqual({ col: 23, row: 23 });
  });
});
