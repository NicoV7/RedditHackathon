/**
 * Pure-logic tests for the side-scroll room deriver (src/client/phaser/roomLayout.ts).
 *
 * Every assertion is on a deterministic f(args) — no Phaser, no DOM, no clocks, no
 * Math.random. Coverage:
 *   - roomLayout: world wider than the viewport, ground line, platforms in-bounds,
 *     coords-driven door/item X (wall side preserved), even-spread NPCs, stable order,
 *     integer pixels, determinism, seed-driven cosmetic variation, edge clamping, no stack.
 *   - cellToWorldX: cell→world mapping endpoints + out-of-range clamp.
 */
import { describe, it, expect } from "vitest";
import { roomLayout, cellToWorldX, type RoomLayoutInput } from "./roomLayout.js";
import type { Door, NavGrid, Zone } from "../../shared/case.js";

// ─────────────────────────── Fixture helpers ───────────────────────────

function makeGrid(opts?: Partial<NavGrid>): NavGrid {
  return { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25, ...opts };
}
function makeZone(id: string): Zone {
  return { id, name: id, tags: [], bounds: { x: 0, y: 0, w: 25, h: 25 } };
}
function door(from: string, to: string, x: number, y: number): Door {
  return { from, to, coords: { x, y } };
}
function makeInput(opts?: Partial<RoomLayoutInput>): RoomLayoutInput {
  return {
    zone: makeZone("bar"),
    grid: makeGrid(),
    doors: [door("bar", "cellar", 24, 12), door("bar", "attic", 0, 12)],
    items: [
      { id: "glass", coords: { x: 6, y: 10 } },
      { id: "note", coords: { x: 18, y: 4 } },
    ],
    npcs: [{ id: "lola" }, { id: "vito" }, { id: "frankie" }],
    dailySeed: "seed-1",
    ...opts,
  };
}

const isInt = (n: number): boolean => Number.isInteger(n);

// ─────────────────────────────── roomLayout ───────────────────────────────

describe("roomLayout — world dimensions", () => {
  it("makes the world strictly wider than the viewport (camera can scroll)", () => {
    const l = roomLayout(makeInput());
    expect(l.worldW).toBeGreaterThan(l.worldH); // 25-wide viewport, world ≥ ×2
    expect(l.worldW).toBeGreaterThan(makeGrid().cols * makeGrid().cellSize);
  });

  it("sets worldH to the grid height and a ground line inside the world", () => {
    const l = roomLayout(makeInput());
    expect(l.worldH).toBe(25 * 16);
    expect(l.groundY).toBeGreaterThan(0);
    expect(l.groundY).toBeLessThan(l.worldH);
  });

  it("emits only integer world pixels", () => {
    const l = roomLayout(makeInput());
    expect([l.worldW, l.worldH, l.groundY].every(isInt)).toBe(true);
    expect(l.platforms.every((p) => [p.x, p.y, p.w, p.h].every(isInt))).toBe(true);
    expect(l.placements.every((p) => isInt(p.x) && isInt(p.surfaceY))).toBe(true);
  });
});

describe("roomLayout — platforms", () => {
  it("places every platform inside the world and above the ground", () => {
    const l = roomLayout(makeInput());
    expect(l.platforms.length).toBeGreaterThanOrEqual(2);
    for (const p of l.platforms) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(l.worldW);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(l.groundY); // floats above the walk line
    }
  });
});

describe("roomLayout — placements", () => {
  it("emits one placement per door, item and NPC in a stable doors→items→NPCs order", () => {
    const input = makeInput();
    const l = roomLayout(input);
    expect(l.placements.length).toBe(
      input.doors.length + input.items.length + input.npcs.length,
    );
    const kinds = l.placements.map((p) => p.kind);
    expect(kinds).toEqual(["door", "door", "item", "item", "npc", "npc", "npc"]);
    expect(l.placements.filter((p) => p.kind === "npc").map((p) => p.id)).toEqual([
      "lola",
      "vito",
      "frankie",
    ]);
  });

  it("tags door placements with the destination zone", () => {
    const l = roomLayout(makeInput());
    const doors = l.placements.filter((p) => p.kind === "door");
    expect(doors.map((d) => d.toZone)).toEqual(["cellar", "attic"]);
  });

  it("stands every interactable on the ground line", () => {
    const l = roomLayout(makeInput());
    expect(l.placements.every((p) => p.surfaceY === l.groundY)).toBe(true);
  });

  it("preserves wall side: a left-wall door sits left of a right-wall door", () => {
    const l = roomLayout(
      makeInput({ doors: [door("bar", "L", 0, 12), door("bar", "R", 24, 12)] }),
    );
    const [left, right] = l.placements.filter((p) => p.kind === "door");
    expect(left!.x).toBeLessThan(right!.x);
  });

  it("spreads NPCs to strictly increasing, distinct X positions", () => {
    const l = roomLayout(makeInput({ doors: [], items: [] }));
    const xs = l.placements.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it("never stacks two interactables at the same X (min-gap spread)", () => {
    const l = roomLayout(
      makeInput({
        doors: [],
        npcs: [],
        items: [
          { id: "a", coords: { x: 10, y: 1 } },
          { id: "b", coords: { x: 10, y: 2 } }, // identical column → would collide
        ],
      }),
    );
    const [a, b] = l.placements;
    expect(a!.x).not.toBe(b!.x);
  });

  it("clamps out-of-range item coords into the world", () => {
    const l = roomLayout(
      makeInput({
        doors: [],
        npcs: [],
        items: [
          { id: "hi", coords: { x: 9999, y: 0 } },
          { id: "lo", coords: { x: -50, y: 0 } },
        ],
      }),
    );
    for (const p of l.placements) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(l.worldW);
    }
  });
});

describe("roomLayout — determinism", () => {
  it("is deterministic: identical input → byte-identical layout", () => {
    expect(roomLayout(makeInput())).toEqual(roomLayout(makeInput()));
  });

  it("varies the cosmetic layout across different rooms (seed = dailySeed|zoneId)", () => {
    const seen = new Set<string>();
    for (const id of ["bar", "cellar", "attic", "study", "garden"]) {
      seen.add(JSON.stringify(roomLayout(makeInput({ zone: makeZone(id) }))));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps interactable X fixed even when the seed changes (coords-driven, not RNG)", () => {
    const base = makeInput({ npcs: [], items: [{ id: "x", coords: { x: 12, y: 5 } }] });
    const a = roomLayout({ ...base, dailySeed: "A" });
    const b = roomLayout({ ...base, dailySeed: "B" });
    // Same world width bucket → the item's coords-driven X is identical despite the seed.
    if (a.worldW === b.worldW) {
      const ax = a.placements.find((p) => p.kind === "item")!.x;
      const bx = b.placements.find((p) => p.kind === "item")!.x;
      expect(ax).toBe(bx);
    }
  });
});

// ─────────────────────────────── cellToWorldX ───────────────────────────────

describe("cellToWorldX", () => {
  const cols = 25;
  const cellSize = 16;
  const worldW = 800;
  const inset = 2 * cellSize; // EDGE_INSET_CELLS × cellSize

  it("maps cell 0 to the left inset and the last cell to the right inset", () => {
    expect(cellToWorldX(0, cols, worldW, cellSize)).toBe(inset);
    expect(cellToWorldX(cols - 1, cols, worldW, cellSize)).toBe(worldW - inset);
  });

  it("clamps out-of-range cells to the insettable span", () => {
    expect(cellToWorldX(-5, cols, worldW, cellSize)).toBe(inset);
    expect(cellToWorldX(9999, cols, worldW, cellSize)).toBe(worldW - inset);
  });

  it("returns an integer for a mid cell", () => {
    expect(Number.isInteger(cellToWorldX(12, cols, worldW, cellSize))).toBe(true);
  });
});
