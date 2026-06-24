/**
 * src/client/phaser/world.ts — C10 "living world" Phaser scene.
 *
 * Renders a coordinate map from `view.map` (zones + navGrid), places NPC sprites
 * by `homeZone`, and animates ambient routine movement. Tapping an NPC emits
 * `handlers.onApproachNpc(id)`; tapping an item emits `handlers.onExamineItem(id)`.
 *
 * DETERMINISM (CLAUDE.md hard rule): all *logical* motion is integer-pure. An
 * NPC's logical cell at a given tick is a PURE function f(seed, tick) computed
 * with mulberry32 over discrete ticks — no Math.random / Date.now / float
 * accumulation in logical state. The tween between two logical cells is COSMETIC
 * only and is never read back by any logic. No killer knowledge is present here:
 * the scene only consumes the sanitized ClientCaseView.
 *
 * Palette — "Lamplight Noir":
 *   #1B2A2E teal-charcoal rooms · #E8B86D amber NPCs.
 */
import Phaser from "phaser";
import type { ClientCaseView, ClientNpcView } from "../../shared/api.js";
import type { MapDef, NavGrid, RoutineStep, Zone } from "../../shared/case.js";
import { hashSeed, mulberry32 } from "../../shared/prng.js";
import type { WorldHandle, WorldHandlers } from "../bridge.js";

// ── Lamplight Noir palette ──
const COL_BG = 0x12_1c_1f; // deep backdrop behind rooms
const COL_ROOM = 0x1b_2a_2e; // teal-charcoal rooms
const COL_ROOM_STROKE = 0x2c_44_4a; // room outline
const COL_ROOM_ACTIVE = 0x24_3a_40; // highlighted active zone fill
const COL_NPC = 0xe8_b8_6d; // amber NPC body
const COL_NPC_STROKE = 0xa8_82_46; // amber NPC outline
const COL_ITEM = 0x7e_a8_b0; // cool slate item glyph
const COL_ITEM_STROKE = 0x3d_5a_61;

const NPC_RADIUS = 13;
const ITEM_SIZE = 18;

/** Logical motion advances one tick per this many ms. Cosmetic cadence only. */
const MS_PER_TICK = 2200;

/** Cell at which an NPC's routine "covers" a given tick — pure over the routine. */
function zoneAtTick(routine: readonly RoutineStep[], tick: number, homeZone: string): string {
  for (const step of routine) {
    if (tick >= step.fromTick && tick < step.toTick) return step.zoneId;
  }
  // Outside any scheduled window the NPC idles at home.
  return homeZone;
}

interface ZoneRect {
  zone: Zone;
  px: number; // pixel left
  py: number; // pixel top
  pw: number;
  ph: number;
}

/** Resolve a navGrid cell index (col,row) to a world-pixel center. */
function cellCenter(grid: NavGrid, col: number, row: number): { x: number; y: number } {
  const cs = grid.cellSize;
  return {
    x: grid.origin.x + col * cs + cs / 2,
    y: grid.origin.y + row * cs + cs / 2,
  };
}

/** Zone bounds (grid units) → integer cell range, clamped to the grid. */
function zoneCellRange(grid: NavGrid, zone: Zone): { c0: number; r0: number; c1: number; r1: number } {
  const c0 = Math.max(0, Math.floor(zone.bounds.x));
  const r0 = Math.max(0, Math.floor(zone.bounds.y));
  const c1 = Math.min(grid.cols - 1, Math.floor(zone.bounds.x + zone.bounds.w) - 1);
  const r1 = Math.min(grid.rows - 1, Math.floor(zone.bounds.y + zone.bounds.h) - 1);
  return {
    c0,
    r0,
    c1: Math.max(c0, c1),
    r1: Math.max(r0, r1),
  };
}

/**
 * Pure logical cell for an NPC at a tick. Combines (dailySeed, npcId, tick) into
 * a deterministic mulberry32 draw, then maps it into the integer cell-range of the
 * NPC's scheduled zone. Identical inputs → identical cell on every device.
 */
function logicalCell(
  grid: NavGrid,
  zone: Zone,
  dailySeed: string,
  npcId: string,
  tick: number,
): { col: number; row: number } {
  const range = zoneCellRange(grid, zone);
  const rng = mulberry32(hashSeed(`${dailySeed}|${npcId}|${tick}`));
  const cols = range.c1 - range.c0 + 1;
  const rows = range.r1 - range.r0 + 1;
  return {
    col: range.c0 + rng.int(cols),
    row: range.r0 + rng.int(rows),
  };
}

interface NpcSprite {
  view: ClientNpcView;
  container: Phaser.GameObjects.Container;
  /** last logical cell we tweened toward (integer; cosmetic target source). */
  lastCol: number;
  lastRow: number;
  tween?: Phaser.Tweens.Tween;
}

class WorldScene extends Phaser.Scene {
  private readonly view: ClientCaseView;
  private readonly handlers: WorldHandlers;
  private zoneRects = new Map<string, ZoneRect>();
  private zoneGraphics?: Phaser.GameObjects.Graphics;
  private npcSprites: NpcSprite[] = [];
  private activeZone: string | null = null;
  /** integer tick counter — the ONLY logical clock; never derived from wall-time. */
  private tick = 0;
  private tickTimer?: Phaser.Time.TimerEvent;

  constructor(view: ClientCaseView, handlers: WorldHandlers) {
    super("world");
    this.view = view;
    this.handlers = handlers;
  }

  create(): void {
    const map: MapDef = this.view.map;
    this.cameras.main.setBackgroundColor(COL_BG);

    this.computeZoneRects(map);
    this.zoneGraphics = this.add.graphics();
    this.drawZones();

    // Zone labels.
    for (const zr of this.zoneRects.values()) {
      this.add
        .text(zr.px + 6, zr.py + 4, zr.zone.name, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#6f8c92",
        })
        .setDepth(2);
    }

    this.placeItems(map);
    this.placeNpcs(map);

    // Advance the integer logical clock on a fixed cadence. The timer only ticks
    // an integer counter; positions for that tick are recomputed purely.
    this.tickTimer = this.time.addEvent({
      delay: MS_PER_TICK,
      loop: true,
      callback: () => this.advanceTick(),
    });
    // Seat everyone at tick 0 immediately (no tween).
    this.syncNpcsToTick(true);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  private computeZoneRects(map: MapDef): void {
    const grid = map.navGrid;
    for (const zone of map.zones) {
      this.zoneRects.set(zone.id, {
        zone,
        px: grid.origin.x + zone.bounds.x * grid.cellSize,
        py: grid.origin.y + zone.bounds.y * grid.cellSize,
        pw: zone.bounds.w * grid.cellSize,
        ph: zone.bounds.h * grid.cellSize,
      });
    }
  }

  private drawZones(): void {
    const g = this.zoneGraphics;
    if (!g) return;
    g.clear();
    for (const zr of this.zoneRects.values()) {
      const active = zr.zone.id === this.activeZone;
      g.fillStyle(active ? COL_ROOM_ACTIVE : COL_ROOM, 1);
      g.lineStyle(active ? 2 : 1, COL_ROOM_STROKE, 1);
      g.fillRect(zr.px, zr.py, zr.pw, zr.ph);
      g.strokeRect(zr.px, zr.py, zr.pw, zr.ph);
    }
  }

  private placeItems(map: MapDef): void {
    for (const item of this.view.items) {
      const center = cellCenter(map.navGrid, item.coords.x, item.coords.y);
      const glyph = this.add
        .rectangle(center.x, center.y, ITEM_SIZE, ITEM_SIZE, COL_ITEM, 1)
        .setStrokeStyle(2, COL_ITEM_STROKE, 1)
        .setDepth(3)
        .setAngle(45) // diamond — reads as "interactable" vs round NPCs
        .setInteractive({ useHandCursor: true });
      glyph.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.handlers.onExamineItem(item.id);
      });
    }
  }

  private placeNpcs(map: MapDef): void {
    for (const npc of this.view.npcs) {
      const home = this.zoneRects.get(npc.homeZone);
      const grid = map.navGrid;
      // Initial seat: the home zone center (cosmetic; logical cell set on sync).
      const seat = home
        ? { x: home.px + home.pw / 2, y: home.py + home.ph / 2 }
        : cellCenter(grid, 0, 0);

      const body = this.add
        .circle(0, 0, NPC_RADIUS, COL_NPC, 1)
        .setStrokeStyle(2, COL_NPC_STROKE, 1);
      const label = this.add
        .text(0, NPC_RADIUS + 2, npc.name, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#e8b86d",
        })
        .setOrigin(0.5, 0);

      const container = this.add.container(seat.x, seat.y, [body, label]).setDepth(5);
      // The circle hit-area keeps a ≥44px tap target regardless of art size.
      container.setSize(NPC_RADIUS * 2, NPC_RADIUS * 2);
      container.setInteractive(
        new Phaser.Geom.Circle(0, 0, Math.max(NPC_RADIUS, 22)),
        Phaser.Geom.Circle.Contains,
      );
      container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.handlers.onApproachNpc(npc.id);
      });

      this.npcSprites.push({ view: npc, container, lastCol: -1, lastRow: -1 });
    }
  }

  /** Integer clock advance — pure logical step, then a cosmetic re-sync. */
  private advanceTick(): void {
    this.tick += 1;
    this.syncNpcsToTick(false);
  }

  /**
   * For each NPC, recompute its PURE logical cell for the current tick and start
   * a cosmetic tween toward that cell's pixel center. The integer cell is the
   * source of truth; the tween is decoration and never read by logic.
   */
  private syncNpcsToTick(instant: boolean): void {
    const grid = this.view.map.navGrid;
    for (const sprite of this.npcSprites) {
      const zoneId = zoneAtTick(sprite.view.routine, this.tick, sprite.view.homeZone);
      const zr = this.zoneRects.get(zoneId);
      // If a routine references a zone we can't resolve, fall back to home.
      const zone =
        zr?.zone ??
        this.zoneRects.get(sprite.view.homeZone)?.zone ??
        this.view.map.zones[0];
      if (!zone) continue;

      const cell = logicalCell(grid, zone, this.view.dailySeed, sprite.view.id, this.tick);
      if (cell.col === sprite.lastCol && cell.row === sprite.lastRow) continue;
      sprite.lastCol = cell.col;
      sprite.lastRow = cell.row;

      const target = cellCenter(grid, cell.col, cell.row);
      sprite.tween?.remove();
      if (instant) {
        sprite.container.setPosition(target.x, target.y);
      } else {
        sprite.tween = this.tweens.add({
          targets: sprite.container,
          x: target.x,
          y: target.y,
          duration: Math.min(MS_PER_TICK - 200, 1600),
          ease: "Sine.easeInOut",
        });
      }
    }
  }

  setActiveZone(zoneId: string): void {
    this.activeZone = zoneId;
    if (this.zoneGraphics) this.drawZones();
    const zr = this.zoneRects.get(zoneId);
    if (zr) {
      this.cameras.main.pan(zr.px + zr.pw / 2, zr.py + zr.ph / 2, 350, "Sine.easeInOut");
    }
  }

  private teardown(): void {
    this.tickTimer?.remove();
    for (const s of this.npcSprites) s.tween?.remove();
  }
}

export function mountWorld(
  el: HTMLElement,
  view: ClientCaseView,
  handlers: WorldHandlers,
): WorldHandle {
  const grid = view.map.navGrid;
  const worldW = grid.origin.x * 2 + grid.cols * grid.cellSize;
  const worldH = grid.origin.y * 2 + grid.rows * grid.cellSize;

  const scene = new WorldScene(view, handlers);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: el,
    width: worldW,
    height: worldH,
    backgroundColor: COL_BG,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene,
  });

  return {
    setActiveZone(zoneId: string): void {
      // Defer until the scene has booted; calling early is a no-op-safe guard.
      if (scene.scene && scene.scene.isActive()) scene.setActiveZone(zoneId);
      else scene.events.once(Phaser.Scenes.Events.CREATE, () => scene.setActiveZone(zoneId));
    },
    destroy(): void {
      game.destroy(true);
    },
  };
}
