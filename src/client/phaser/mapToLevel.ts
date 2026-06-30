/**
 * src/client/phaser/mapToLevel.ts — PURE "tilemap → platformer level" deriver.
 *
 * The authored per-zone tilemap (a `ZoneMapSpec`: ground rows + solid platform runs +
 * spawn/door/item/NPC markers — see zoneMaps.ts) is "the map". This turns it into the
 * platformer geometry the scene needs: a solid grid (for rendering), **merged collision
 * rectangles** (Arcade static bodies — the platforms/ground/boundaries), the ground line,
 * the player spawn, and the door/item/NPC placements anchored on their floors. No Phaser,
 * no DOM, no clocks, no Math.random — a deterministic f(args), unit-testable in Node.
 *
 * DETERMINISM BOUNDARY (CLAUDE.md): all output is RENDER geometry. The tilemap is client-
 * render data; doors' `from→to` and item/NPC zone membership stay server-authoritative
 * (passed in via `entities`) — this only decides WHERE they stand. Never read by the
 * validator/solver/reachability; solvability is structural.
 */
import type { Door } from "../../shared/case.js";
import type { Placement } from "./roomLayout.js";

/** A horizontal run of solid tiles, 1 tile tall (ground extension / platform / ledge). */
export interface MapPlatform {
  col: number;
  row: number;
  len: number;
}
/** An anchor placed in an AIR cell; its feet rest on the nearest solid tile below it. */
export interface MapMarker {
  kind: "spawn" | "door" | "item" | "npc";
  col: number;
  row: number;
}
/** An authored room tilemap (coordinate-based so there's no fragile ASCII counting). */
export interface ZoneMapSpec {
  cols: number;
  rows: number;
  tileSize: number;
  groundRows: number; // the bottom N rows are solid floor
  platforms: MapPlatform[];
  markers: MapMarker[];
}

/** An axis-aligned collision/render rectangle in world pixels (integer). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A fully-derived side-scroll level. All fields are integer world pixels. */
export interface RoomLevel {
  tileSize: number;
  cols: number;
  rows: number;
  worldW: number;
  worldH: number;
  groundY: number; // top of the floor (the walk line)
  solid: boolean[][]; // [row][col] — for tile/placeholder rendering
  collisionRects: Rect[]; // merged solid runs — one Arcade static body each
  spawnX: number;
  spawnY: number; // top of the tile the player spawns on
  placements: Placement[]; // doors, then items, then NPCs — stable order
}

/** The server-authoritative entities to anchor into this room (membership is server-owned). */
export interface LevelEntities {
  doors: readonly Door[];
  items: readonly { readonly id: string }[];
  npcs: readonly { readonly id: string }[];
}

const EDGE_INSET_CELLS = 2;

/** Build the [row][col] solid grid: bottom `groundRows` rows + each platform run. */
function buildSolidGrid(spec: ZoneMapSpec): boolean[][] {
  const { cols, rows, groundRows } = spec;
  const groundTopRow = rows - groundRows;
  const solid: boolean[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => r >= groundTopRow),
  );
  for (const p of spec.platforms) {
    if (p.row < 0 || p.row >= rows) continue;
    for (let c = p.col; c < p.col + p.len; c++) {
      if (c >= 0 && c < cols) solid[p.row]![c] = true;
    }
  }
  return solid;
}

/** Merge each row's contiguous solid cells into rectangles (few static bodies, not per-cell). */
function mergeSolidRuns(solid: boolean[][], tileSize: number): Rect[] {
  const rects: Rect[] = [];
  for (let r = 0; r < solid.length; r++) {
    const row = solid[r]!;
    let start = -1;
    for (let c = 0; c <= row.length; c++) {
      const filled = c < row.length && row[c] === true;
      if (filled && start < 0) start = c;
      else if (!filled && start >= 0) {
        rects.push({ x: start * tileSize, y: r * tileSize, w: (c - start) * tileSize, h: tileSize });
        start = -1;
      }
    }
  }
  return rects;
}

/** The pixel Y of the surface a marker stands on: top of the nearest solid at/below it. */
function surfaceYAt(solid: boolean[][], col: number, row: number, tileSize: number, groundY: number): number {
  for (let r = Math.max(0, row); r < solid.length; r++) {
    if (solid[r]?.[col] === true) return r * tileSize;
  }
  return groundY;
}

const cellCenterX = (col: number, tileSize: number): number => col * tileSize + Math.floor(tileSize / 2);

/** Even-spread X for an entity that has no authored marker (deterministic). */
function spreadX(index: number, count: number, worldW: number, tileSize: number): number {
  const inset = EDGE_INSET_CELLS * tileSize;
  const span = Math.max(0, worldW - inset * 2);
  return Math.round(inset + ((index + 1) / (count + 1)) * span);
}

/** Anchor `count` entities onto the marker cells in order; extras even-spread on the ground. */
function anchorXY(
  index: number,
  count: number,
  markers: readonly MapMarker[],
  solid: boolean[][],
  tileSize: number,
  worldW: number,
  groundY: number,
): { x: number; surfaceY: number } {
  const marker = markers[index];
  if (marker) {
    return { x: cellCenterX(marker.col, tileSize), surfaceY: surfaceYAt(solid, marker.col, marker.row, tileSize, groundY) };
  }
  return { x: spreadX(index, count, worldW, tileSize), surfaceY: groundY };
}

export function mapToLevel(spec: ZoneMapSpec, entities: LevelEntities): RoomLevel {
  const { cols, rows, tileSize, groundRows } = spec;
  const worldW = cols * tileSize;
  const worldH = rows * tileSize;
  const groundY = (rows - groundRows) * tileSize;

  const solid = buildSolidGrid(spec);
  const collisionRects = mergeSolidRuns(solid, tileSize);

  const spawn = spec.markers.find((m) => m.kind === "spawn");
  const spawnX = spawn ? cellCenterX(spawn.col, tileSize) : Math.round(worldW * 0.12);
  const spawnY = spawn ? surfaceYAt(solid, spawn.col, spawn.row, tileSize, groundY) : groundY;

  const doorMarkers = spec.markers.filter((m) => m.kind === "door");
  const itemMarkers = spec.markers.filter((m) => m.kind === "item");
  const npcMarkers = spec.markers.filter((m) => m.kind === "npc");

  const doorPlacements: Placement[] = entities.doors.map((d, i) => {
    const at = anchorXY(i, entities.doors.length, doorMarkers, solid, tileSize, worldW, groundY);
    return { id: `${d.from}->${d.to}`, kind: "door", x: at.x, surfaceY: at.surfaceY, toZone: d.to };
  });
  const itemPlacements: Placement[] = entities.items.map((it, i) => {
    const at = anchorXY(i, entities.items.length, itemMarkers, solid, tileSize, worldW, groundY);
    return { id: it.id, kind: "item", x: at.x, surfaceY: at.surfaceY };
  });
  const npcPlacements: Placement[] = entities.npcs.map((n, i) => {
    const at = anchorXY(i, entities.npcs.length, npcMarkers, solid, tileSize, worldW, groundY);
    return { id: n.id, kind: "npc", x: at.x, surfaceY: at.surfaceY };
  });

  return {
    tileSize,
    cols,
    rows,
    worldW,
    worldH,
    groundY,
    solid,
    collisionRects,
    spawnX,
    spawnY,
    placements: [...doorPlacements, ...itemPlacements, ...npcPlacements],
  };
}
