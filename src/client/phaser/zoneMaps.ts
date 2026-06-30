/**
 * src/client/phaser/zoneMaps.ts — the authored speakeasy room tilemaps ("the map").
 *
 * One coordinate-based `ZoneMapSpec` per zone id (mirrors src/server/case/procedural.ts
 * ZONE_DEFS): the bottom `groundRows` are floor; `platforms` are 1-tall solid runs
 * (counters, shelves, crates, ledges); `markers` anchor the spawn + doors + item/NPC
 * stations in AIR cells (their feet snap to the solid below — see mapToLevel.ts).
 *
 * These are CLIENT RENDER DATA — hand-designed so each room reads as itself; the PixelLab
 * tileset/props skin them, and `mapToLevel` derives collision/doors/boundaries. Never read
 * by the validator/solver/reachability (solvability is structural).
 *
 * Grid: 48×25 tiles @ 16px → a 768×400 world. Height matches the side-scroll viewport
 * (no vertical scroll); width is wider, so the camera scrolls horizontally. Ground = the
 * bottom 3 rows (groundRows=3); the walk line is row 22 (y=352). Lower platforms sit
 * within a jump of the floor; high shelves/ledges climb the wall.
 */
import type { ZoneMapSpec } from "./mapToLevel.js";

const COLS = 48;
const ROWS = 25;
const TILE = 16;
const GROUND_ROWS = 3; // floor rows 22–24; walk line = row 22 (y = 352)

const base = { cols: COLS, rows: ROWS, tileSize: TILE, groundRows: GROUND_ROWS } as const;

export const ZONE_MAPS: Record<string, ZoneMapSpec> = {
  // The Bar — the speakeasy floor + start/hub. A long counter, a bottle shelf, a piano stage.
  bar: {
    ...base,
    platforms: [
      { col: 10, row: 20, len: 17 }, // the bar counter (patrons in front, barkeep on top)
      { col: 12, row: 14, len: 11 }, // bottle shelf behind the bar
      { col: 38, row: 20, len: 7 }, // piano stage
    ],
    markers: [
      { kind: "spawn", col: 4, row: 21 },
      { kind: "door", col: 1, row: 21 },
      { kind: "door", col: 46, row: 21 },
      { kind: "door", col: 30, row: 21 },
      { kind: "npc", col: 18, row: 19 }, // the barkeep, atop the counter
      { kind: "npc", col: 8, row: 21 },
      { kind: "npc", col: 34, row: 21 },
      { kind: "npc", col: 41, row: 19 }, // the piano man, on the stage
      { kind: "item", col: 14, row: 19 }, // a glass on the bar
      { kind: "item", col: 24, row: 21 },
    ],
  },
  // The Parking Lot — flat asphalt, a parked sedan, a crate stack.
  lot: {
    ...base,
    platforms: [
      { col: 6, row: 20, len: 8 }, // the sedan roof (jump onto it)
      { col: 30, row: 20, len: 4 }, // crate stack
      { col: 31, row: 19, len: 2 },
    ],
    markers: [
      { kind: "spawn", col: 3, row: 21 },
      { kind: "door", col: 1, row: 21 },
      { kind: "door", col: 46, row: 21 },
      { kind: "door", col: 24, row: 21 },
      { kind: "npc", col: 20, row: 21 },
      { kind: "npc", col: 40, row: 21 },
      { kind: "item", col: 31, row: 18 }, // atop the crates
      { kind: "item", col: 9, row: 19 }, // on the car roof
    ],
  },
  // Behind the Bar — back-room storage: shelves, casks, a bookkeeper's desk.
  backbar: {
    ...base,
    platforms: [
      { col: 4, row: 17, len: 7 }, // low shelf
      { col: 18, row: 12, len: 7 }, // high shelf
      { col: 32, row: 18, len: 9 }, // long shelf
      { col: 12, row: 20, len: 5 }, // oak casks
    ],
    markers: [
      { kind: "spawn", col: 2, row: 21 },
      { kind: "door", col: 1, row: 21 },
      { kind: "door", col: 46, row: 21 },
      { kind: "door", col: 26, row: 21 },
      { kind: "npc", col: 24, row: 21 },
      { kind: "item", col: 6, row: 16 }, // on the low shelf
      { kind: "item", col: 36, row: 17 }, // on the long shelf
    ],
  },
  // The Back Alley — wet cobbles, a dumpster, an iron fire escape.
  alley: {
    ...base,
    platforms: [
      { col: 8, row: 20, len: 6 }, // dumpster
      { col: 9, row: 19, len: 4 }, // dumpster lid
      { col: 30, row: 16, len: 5 }, // fire-escape ledge
      { col: 36, row: 11, len: 6 }, // upper fire-escape ledge
    ],
    markers: [
      { kind: "spawn", col: 3, row: 21 },
      { kind: "door", col: 1, row: 21 },
      { kind: "door", col: 46, row: 21 },
      { kind: "door", col: 22, row: 21 },
      { kind: "npc", col: 20, row: 21 },
      { kind: "item", col: 11, row: 18 }, // atop the dumpster
    ],
  },
};
