/**
 * src/client/phaser/world.ts — C10 "living world" Phaser scene (Pillars 2, 3, 4).
 *
 * Renders a coordinate map from `view.map` (zones + navGrid), places NPC sprites
 * by `homeZone`, animates ambient routine movement, and gives the player a WALKABLE
 * sprite avatar with hybrid input (WASD/arrows + tap-to-path via A*). Tapping an NPC
 * emits `handlers.onApproachNpc(id)`; tapping an item emits `handlers.onExamineItem(id)`;
 * walking through a door emits `handlers.onEnterDoor(from,to)`; arriving in a zone
 * emits `handlers.onMovePlayer(zoneId)` (the perception model, Part 2.3).
 *
 * DETERMINISM (CLAUDE.md hard rule): all *logical* motion is integer-pure. An NPC's
 * logical cell at a tick is a PURE f(seed, tick) over mulberry32. The PLAYER's
 * LOGICAL position is the ZONE it snaps into — reported via onMovePlayer — never the
 * cosmetic pixel tween along the A* path. No Math.random / Date.now / float
 * accumulation in any logical state. No killer knowledge: only the sanitized view.
 *
 * PHASER PILLARS (Part 4) — all COSMETIC, each rendering a server-authoritative or
 * deterministic signal, never read back by logic (Part 4.2):
 *  - Pillar 2: dynamic lighting — cold ambient + per-zone gaslight + a player-follow
 *    light whose radius = the Perception faculty (setPlayerLight).
 *  - Pillar 3: walkable avatar + A* + doors; TilemapGPULayer zones when a tileset is
 *    present, else the Graphics-rectangle fallback (kept intact).
 *  - Pillar 4: particles (smoke/rain/dust), camera fade on transitions, footstep dust.
 * A setQuality('low') path disables filters/lights/particles (Part 4.4).
 *
 * Palette — "Lamplight Noir": #1B2A2E teal-charcoal rooms · #E8B86D amber NPCs.
 */
import Phaser from "phaser";
import type { ClientCaseView, ClientNpcView } from "../../shared/api.js";
import type { Door, MapDef, NavGrid, RoutineStep, Zone } from "../../shared/case.js";
import { hashSeed, mulberry32 } from "../../shared/prng.js";
import { portraitFor } from "../ui/portraits.js";
import type { WorldHandle, WorldHandlers } from "../bridge.js";
import {
  loadAssets,
  loadZoneAssets,
  tilesetKey,
  PLAYER_SPRITE_SLUG,
  SPRITE_DIRS,
  type SpriteDir,
  spriteFrameKey,
  spriteFrameUrl,
  spriteSlugPresent,
  npcSpriteSlugForIndex,
  tilesetSlugForZoneIndex,
  wangTilesetKey,
  wangTilesetUrl,
  wangTilesetMeta,
} from "./assets.js";
import { createFx, type FxQuality, type ParlorFx } from "./fx.js";
import { findPath, type Cell } from "./pathfind.js";
import { npcsInRoom, itemsInRoom, doorsFromRoom, doorEntryCell } from "./room.js";
import {
  buildWangAtlas,
  cornersAt,
  flatLowerField,
  wangRectForCorners,
  type WangAtlas,
  type WangTilesetMeta,
} from "./wang.js";

// ── Lamplight Noir palette ──
const COL_BG = 0x12_1c_1f; // deep backdrop behind rooms
const COL_ROOM = 0x1b_2a_2e; // teal-charcoal rooms
const COL_ROOM_STROKE = 0x2c_44_4a; // room outline
const COL_ROOM_ACTIVE = 0x24_3a_40; // highlighted active zone fill
const COL_NPC = 0xe8_b8_6d; // amber NPC body
const COL_NPC_STROKE = 0xa8_82_46; // amber NPC outline
const COL_ITEM = 0x7e_a8_b0; // cool slate item glyph
const COL_ITEM_STROKE = 0x3d_5a_61;
const COL_AVATAR = 0xcf_dd_df; // pale lamplit detective
const COL_AVATAR_STROKE = 0x8f_a8_ac;
const COL_DOOR = 0x9a_8a_b0; // muted violet door glyph
const COL_DOOR_STROKE = 0x5a_4a_70;

const NPC_RADIUS = 13;
const ITEM_SIZE = 18;
const AVATAR_RADIUS = 11;
const DOOR_SIZE = 16;

/** Render an NPC/avatar portrait sprite at roughly this tall (px); width follows the
 *  source aspect. Cosmetic only — the logical position stays the container's cell. */
const NPC_SPRITE_H = 56;
const AVATAR_SPRITE_H = 52;

/** Per-character portrait texture key (cosmetic art cache; never read by logic). */
function npcPortraitKey(npcId: string): string {
  return `worldportrait_${npcId.replace(/[^a-z0-9]/gi, "_")}`;
}
const AVATAR_PORTRAIT_KEY = "worldportrait_avatar";

/** Target on-floor height (px) for a directional PixelLab character sprite (canvas
 *  68×68, character ~40px). Cosmetic; the logical position is the container's cell. */
const NPC_DIR_SPRITE_H = 46;
const AVATAR_DIR_SPRITE_H = 44;

/**
 * Map an integer movement heading (dcol, drow) to the nearest of the 8 PixelLab
 * facing directions. Screen-space: +row is DOWN (south), +col is RIGHT (east). A
 * still actor (0,0) faces south (idle). Pure & integer-only — purely cosmetic frame
 * selection, never read by logic.
 */
function headingToDir(dcol: number, drow: number): SpriteDir {
  const c = Math.sign(dcol);
  const r = Math.sign(drow);
  if (c === 0 && r === 0) return "south"; // idle faces the camera
  if (c === 0) return r > 0 ? "south" : "north";
  if (r === 0) return c > 0 ? "east" : "west";
  if (c > 0 && r > 0) return "south-east";
  if (c > 0 && r < 0) return "north-east";
  if (c < 0 && r > 0) return "south-west";
  return "north-west";
}

/** Logical motion advances one tick per this many ms. Cosmetic cadence only. */
const MS_PER_TICK = 2200;
/** ms the avatar takes to traverse a single navGrid cell (cosmetic tween only). */
const MS_PER_STEP = 220;

/** Cell at which an NPC's routine "covers" a given tick — pure over the routine. */
function zoneAtTick(routine: readonly RoutineStep[], tick: number, homeZone: string): string {
  for (const step of routine) {
    if (tick >= step.fromTick && tick < step.toTick) return step.zoneId;
  }
  return homeZone;
}

interface ZoneRect {
  zone: Zone;
  px: number; // pixel left
  py: number; // pixel top
  pw: number;
  ph: number;
}

function cellCenter(grid: NavGrid, col: number, row: number): { x: number; y: number } {
  const cs = grid.cellSize;
  return {
    x: grid.origin.x + col * cs + cs / 2,
    y: grid.origin.y + row * cs + cs / 2,
  };
}

/**
 * Opt a game object into dynamic lighting if the renderer/version supports it.
 * `setLighting` is a Phaser-4 method on the Lighting component but is not present on
 * every GameObject's static type, so we feature-detect it (Part 4.4 graceful degrade).
 */
function enableLighting(obj: unknown): void {
  const lit = obj as { setLighting?: (b: boolean) => unknown };
  try {
    lit.setLighting?.(true);
  } catch {
    /* unlit fallback */
  }
}

/** Pixel → nearest integer navGrid cell. Used for tap-to-path targeting. */
function pixelToCell(grid: NavGrid, x: number, y: number): Cell {
  const cs = grid.cellSize;
  const col = Math.floor((x - grid.origin.x) / cs);
  const row = Math.floor((y - grid.origin.y) / cs);
  return {
    col: Phaser.Math.Clamp(col, 0, grid.cols - 1),
    row: Phaser.Math.Clamp(row, 0, grid.rows - 1),
  };
}

function zoneCellRange(grid: NavGrid, zone: Zone): { c0: number; r0: number; c1: number; r1: number } {
  const c0 = Math.max(0, Math.floor(zone.bounds.x));
  const r0 = Math.max(0, Math.floor(zone.bounds.y));
  const c1 = Math.min(grid.cols - 1, Math.floor(zone.bounds.x + zone.bounds.w) - 1);
  const r1 = Math.min(grid.rows - 1, Math.floor(zone.bounds.y + zone.bounds.h) - 1);
  return { c0, r0, c1: Math.max(c0, c1), r1: Math.max(r0, r1) };
}

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
  return { col: range.c0 + rng.int(cols), row: range.r0 + rng.int(rows) };
}

interface NpcSprite {
  view: ClientNpcView;
  container: Phaser.GameObjects.Container;
  lastCol: number;
  lastRow: number;
  tween?: Phaser.Tweens.Tween;
  /** the assigned PixelLab slug (cosmetic), or undefined when on the circle fallback. */
  slug?: string;
  /** the directional sprite Image (when a slug is assigned), for frame swaps. */
  dirImage?: Phaser.GameObjects.Image;
}

class WorldScene extends Phaser.Scene {
  private readonly view: ClientCaseView;
  private readonly handlers: WorldHandlers;
  private readonly fx: ParlorFx;
  private quality: FxQuality = "high";

  private zoneRects = new Map<string, ZoneRect>();
  private zoneGraphics?: Phaser.GameObjects.Graphics;
  /** ROOM-BASED: zone ids whose floor art is already baked (built once per room). */
  private floorBuiltZones = new Set<string>();
  /** stable npcId → assigned PixelLab slug (cosmetic; computed once in preload). */
  private npcSlugs = new Map<string, string>();
  private npcSprites: NpcSprite[] = [];
  /** ROOM-BASED: the active room's item glyphs (cleared on a door transition). */
  private itemSprites: Phaser.GameObjects.GameObject[] = [];
  /** ROOM-BASED: the active room's door glyphs (cleared on a door transition). */
  private doorSprites: Phaser.GameObjects.GameObject[] = [];
  private activeZone: string | null = null;
  private tick = 0;
  private tickTimer?: Phaser.Time.TimerEvent;

  // ── avatar (Pillar 3) ──
  private avatar?: Phaser.GameObjects.Container;
  /** the avatar's directional PixelLab sprite (when its art shipped), for frame swaps. */
  private avatarDirImage?: Phaser.GameObjects.Image;
  /** the avatar's current integer cell — the source we tween FROM (cosmetic). */
  private avatarCell: Cell = { col: 0, row: 0 };
  /** the avatar's LOGICAL zone — the only thing perception reads. */
  private avatarZoneId: string | null = null;
  private avatarTween?: Phaser.Tweens.Tween;
  private moveTimer?: Phaser.Time.TimerEvent;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: Record<string, Phaser.Input.Keyboard.Key>;
  /** Perception light radius (cosmetic). Defaults to a small reveal halo. */
  private playerLightRadius = 90;

  private readonly onReady?: () => void;

  constructor(view: ClientCaseView, handlers: WorldHandlers, fx: ParlorFx, onReady?: () => void) {
    super("world");
    this.view = view;
    this.handlers = handlers;
    this.fx = fx;
    this.onReady = onReady;
  }

  /**
   * Preload world art + audio (Pillar 4 — wires the dormant pipeline). Pulls the
   * global manifest (sfx, music, avatar/NPC sheets, light cookie) and EVERY zone's
   * tileset + ambience via the safe loaders, plus a per-character portrait PNG for
   * each NPC (and the detective avatar) so they can render as SPRITES rather than
   * circles. Every queue is a documented no-op when the file is absent (assets.ts),
   * so the scene always boots on the Graphics fallback.
   *
   * COSMETIC-FX GUARD (Part 4.2): nothing loaded here is ever read by game logic.
   */
  preload(): void {
    try {
      // Global SFX/music/sheets/cookie + all zone tilesets & ambience (safe no-ops
      // for absent files — only the placeholder tilesets + light cookie exist today).
      loadAssets(this);
      for (const zone of this.view.map.zones) loadZoneAssets(this, zone.id);
    } catch {
      /* loader unavailable — the world renders on the programmatic fallback */
    }
    // PixelLab directional CHARACTER sprites + Wang tilesets ("Best Use of Phaser"
    // payoff). Each NPC gets a STABLE, deterministic slug (hash of npcId over the
    // PRNG — never RNG/Date.now) so it shows the same sprite every run; `detective`
    // is reserved for the player. Tilesets map to zones by zone index. Every queue is
    // guarded: an absent slug/zone simply isn't loaded → circle/noir-floor fallback.
    this.assignPixelArt();
    try {
      // 8-direction frames for each assigned NPC slug + the player.
      const slugsToLoad = new Set<string>(this.npcSlugs.values());
      if (spriteSlugPresent(PLAYER_SPRITE_SLUG)) slugsToLoad.add(PLAYER_SPRITE_SLUG);
      for (const slug of slugsToLoad) {
        for (const dir of SPRITE_DIRS) {
          const key = spriteFrameKey(slug, dir);
          if (this.textures.exists(key)) continue;
          const url = spriteFrameUrl(slug, dir);
          if (url) this.load.image(key, url);
        }
      }
    } catch {
      /* loader/art unavailable — NPCs/avatar fall back to circle Graphics */
    }
    try {
      // Wang tileset PNGs for whichever zones got an assigned tileset slug.
      const tilesetSlugs = new Set<string>();
      this.view.map.zones.forEach((_, i) => {
        const slug = tilesetSlugForZoneIndex(i);
        if (slug) tilesetSlugs.add(slug);
      });
      for (const slug of tilesetSlugs) {
        const key = wangTilesetKey(slug);
        if (this.textures.exists(key)) continue;
        const url = wangTilesetUrl(slug);
        if (url) this.load.image(key, url);
      }
    } catch {
      /* loader/art unavailable — zones fall back to the programmatic noir floor */
    }
    // Per-character PORTRAITS (these PNGs also exist) — used as the secondary sprite
    // fallback when a character's directional art is absent (between circle & full).
    try {
      for (const npc of this.view.npcs) {
        const key = npcPortraitKey(npc.id);
        if (this.textures.exists(key)) continue;
        const url = portraitFor(npc.name);
        if (url) this.load.image(key, url);
      }
      if (!this.textures.exists(AVATAR_PORTRAIT_KEY)) {
        const url = portraitFor("Det. Halloran");
        if (url) this.load.image(AVATAR_PORTRAIT_KEY, url);
      }
    } catch {
      /* loader/art unavailable — NPCs/avatar fall back to circle Graphics */
    }
    // A missing art file must never abort the scene boot.
    try {
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
        /* handled by per-object create() fallbacks */
      });
    } catch {
      /* no-op */
    }
  }

  /**
   * Deterministically assign each NPC a PixelLab character slug. The index is a
   * STABLE hash of the npcId over the project PRNG (CLAUDE.md determinism invariant —
   * never Math.random/Date.now), so within a run a given NPC always shows the same
   * sprite, and `detective` stays reserved for the player. To reduce collisions we
   * derive a per-NPC base offset from the npcId hash, then walk the available pool;
   * if the pool is smaller than the cast, repeats are intentional and stable.
   *
   * COSMETIC-FX GUARD: slug selection is decorative only — never read by game logic.
   */
  private assignPixelArt(): void {
    if (this.npcSlugs.size > 0) return; // idempotent
    const npcs = this.view.npcs;
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (!npc) continue;
      // Stable index: hash(dailySeed|npcId) keeps it reproducible AND spreads the
      // assignment, falling back to array order inside npcSpriteSlugForIndex.
      const h = hashSeed(`${this.view.dailySeed}|sprite|${npc.id}`);
      const slug = npcSpriteSlugForIndex(h + i);
      if (slug) this.npcSlugs.set(npc.id, slug);
    }
  }

  create(): void {
    const map: MapDef = this.view.map;
    this.cameras.main.setBackgroundColor(COL_BG);

    // ROOM-BASED model: every zone is the FULL local room, so the scene renders ONE
    // active room at a time. The active room defaults to the door-graph root (zones[0],
    // always reachable); doors transition between rooms (enterDoor), walking never does.
    this.activeZone = map.zones[0]?.id ?? null;

    this.computeZoneRects(map);
    this.zoneGraphics = this.add.graphics();

    // Render the active room's floor + content + the avatar, then wire input.
    this.renderActiveRoom(map);
    this.spawnAvatar(map);

    // Pillar 2: cold ambient lighting for the whole scene (cosmetic noir mood).
    try {
      this.fx.setZoneLighting(this, this.activeZone ?? "bar");
    } catch {
      /* unlit fallback */
    }

    // SOUND: start the looping per-zone ambience bed (silent until an ambience clip
    // for the zone is authored). Keyed to the avatar's spawn zone (or the active one).
    this.updateAmbience(this.avatarZoneId ?? this.activeZone ?? this.view.map.zones[0]?.id);

    // Pillar 4: ambient atmosphere particles (cosmetic; degrades on low quality).
    try {
      const g = map.navGrid;
      this.fx.emit(this, "dust", g.origin.x + 40, g.origin.y + 40);
    } catch {
      /* no-op */
    }

    // Ambient NPC motion clock (the active room's NPCs are already seated by
    // renderActiveRoom → syncNpcsToTick; this just keeps them drifting per tick).
    this.tickTimer = this.time.addEvent({
      delay: MS_PER_TICK,
      loop: true,
      callback: () => this.advanceTick(),
    });

    this.setupKeyboard();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.onReady?.();
  }

  // ── per-frame WASD/arrow movement (cosmetic; logical zone snaps on arrival) ──
  override update(): void {
    if (!this.avatar) return;
    // While a tap-to-path tween is running, ignore key nudges (mutually exclusive).
    if (this.avatarTween && this.avatarTween.isPlaying()) return;

    let dc = 0;
    let dr = 0;
    const c = this.cursors;
    const w = this.wasdKeys;
    if (c?.left.isDown || w?.left?.isDown) dc -= 1;
    else if (c?.right.isDown || w?.right?.isDown) dc += 1;
    else if (c?.up.isDown || w?.up?.isDown) dr -= 1;
    else if (c?.down.isDown || w?.down?.isDown) dr += 1;
    if (dc === 0 && dr === 0) return;

    const next: Cell = { col: this.avatarCell.col + dc, row: this.avatarCell.row + dr };
    if (next.col < 0 || next.row < 0 || next.col >= this.view.map.navGrid.cols || next.row >= this.view.map.navGrid.rows)
      return;
    if (this.view.map.navGrid.blocked?.includes(next.row * this.view.map.navGrid.cols + next.col)) return;

    // Throttle to one cell per MS_PER_STEP using a short cosmetic tween.
    this.stepAvatarTo(next, true);
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

  /**
   * Draw the ACTIVE room's floor (tileset OR programmatic noir) + its wash/stroke.
   * ROOM-BASED: only the active zone is rendered, on the full local navGrid. The
   * shared `zoneGraphics` paints the active-room wash + stroke on top of the baked
   * floor. All cosmetic — never read by logic (Part 4.2).
   */
  private drawZones(): void {
    if (this.activeZone) this.drawZoneFloor(this.activeZone);
    const g = this.zoneGraphics;
    if (!g) return;
    g.clear();
    const zr = this.activeZone ? this.zoneRects.get(this.activeZone) : undefined;
    if (!zr) return;
    // active wash sits over the floor art as a subtle warm-amber tint, not an opaque
    // fill, so the richer floor stays visible underneath.
    g.fillStyle(COL_ROOM_ACTIVE, 0.22);
    g.fillRect(zr.px, zr.py, zr.pw, zr.ph);
    g.lineStyle(2, COL_ROOM_STROKE, 1);
    g.strokeRect(zr.px, zr.py, zr.pw, zr.ph);
  }

  /**
   * One-time floor render for ONE room (tileset OR programmatic noir). Built once per
   * zone at depth -1 so it sits UNDER the `zoneGraphics` stroke/active-wash layer
   * (depth 0); the per-frame `drawZones` repaints only that cheap stroke layer above
   * it. Idempotent per zone (skips if that room's floor is already built) so re-
   * entering a room never re-bakes its floor.
   */
  private drawZoneFloor(zoneId: string): void {
    if (this.floorBuiltZones.has(zoneId)) return;
    const zr = this.zoneRects.get(zoneId);
    if (!zr) return;
    this.floorBuiltZones.add(zoneId);
    // Stable zone-index lookup for deterministic tileset assignment (array order).
    const zoneIndex = this.view.map.zones.findIndex((z) => z.id === zoneId);
    let rendered = false;
    // 1) PREFERRED: real PixelLab Wang tileset, autotiled across the room floor.
    try {
      const slug = tilesetSlugForZoneIndex(zoneIndex < 0 ? 0 : zoneIndex);
      if (slug && this.textures.exists(wangTilesetKey(slug))) {
        rendered = this.drawWangFloor(zr, slug);
      }
    } catch {
      /* Wang render unavailable — fall through */
    }
    // 2) Legacy placeholder tileset (flat tiled fill) if a Wang floor didn't draw.
    if (!rendered) {
      const tileKey = tilesetKey(zr.zone.id);
      try {
        if (this.textures.exists(tileKey)) {
          this.add
            .tileSprite(zr.px, zr.py, zr.pw, zr.ph, tileKey)
            .setOrigin(0, 0)
            .setDepth(-1);
          rendered = true;
        }
      } catch {
        /* tileSprite unavailable — fall through to the programmatic floor */
      }
    }
    // 3) FALLBACK: programmatic Cold-Noir floor (always available).
    if (!rendered) this.drawNoirFloor(zr);
  }

  /**
   * ROOM-BASED render: draw the active room's floor + wash + name label, then place
   * ONLY that room's items, doors, and home NPCs (clearing any previous room's
   * sprites first). Called on boot and on every door transition. All cosmetic.
   */
  private renderActiveRoom(map: MapDef): void {
    // Clear the previous room's actors FIRST, then draw the new room on top.
    this.clearRoomActors();
    this.drawZones();
    // Room name label, repainted to the active room (tracked with the door sprites so
    // it's cleared on the next transition and never lingers from the previous room).
    const zr = this.activeZone ? this.zoneRects.get(this.activeZone) : undefined;
    if (zr) {
      const label = this.add
        .text(zr.px + 6, zr.py + 4, zr.zone.name, {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#6f8c92",
        })
        .setDepth(2);
      this.doorSprites.push(label);
    }
    this.placeItems(map);
    this.placeDoors(map);
    this.placeNpcs(map);
    this.syncNpcsToTick(true);
  }

  /** Destroy the previous room's npc/item/door (and label) sprites before a re-render. */
  private clearRoomActors(): void {
    for (const s of this.npcSprites) {
      s.tween?.remove();
      s.container.destroy();
    }
    this.npcSprites = [];
    for (const s of this.itemSprites) s.destroy();
    this.itemSprites = [];
    for (const s of this.doorSprites) s.destroy();
    this.doorSprites = [];
  }

  /**
   * Draw a zone's floor by AUTOTILING its assigned PixelLab Wang tileset. The
   * tileset PNG is a 4×4 grid of 16 corner-Wang tiles (16×16 each); the JSON metadata
   * pins each tile's source rect (wang.ts). We sample an all-lower terrain field
   * (the base floor) so every cell resolves to the base tile — the cheapest correct
   * autotiling — and blit each 16×16 source tile across the zone bounds via a
   * TileSprite whose frame is cropped to the base tile, plus a deterministic accent
   * row of the all-upper tile (rug/puddle) so the art reads richer than a flat fill.
   *
   * Returns true iff it drew something. Deterministic & integer-only; cosmetic only.
   */
  private drawWangFloor(zr: ZoneRect, slug: string): boolean {
    const key = wangTilesetKey(slug);
    let atlas: WangAtlas;
    try {
      atlas = buildWangAtlas(wangTilesetMeta(slug) as WangTilesetMeta | undefined);
    } catch {
      return false;
    }
    const tile = atlas.tileSize || 16;
    // Source rect for the all-lower (base) floor tile and the all-upper accent tile.
    const baseRect = wangRectForCorners(atlas, cornersAt(0, 0, flatLowerField));
    const upperField = (): "upper" => "upper";
    const accentRect = wangRectForCorners(atlas, cornersAt(0, 0, () => upperField()));

    // A cropped frame name per source rect so a TileSprite repeats just THAT 16×16
    // tile (Phaser frames are immutable once added; guard duplicate adds).
    const addFrame = (name: string, r: { x: number; y: number; width: number; height: number }): boolean => {
      try {
        const tex = this.textures.get(key);
        if (!tex) return false;
        if (!tex.has(name)) tex.add(name, 0, r.x, r.y, r.width, r.height);
        return tex.has(name);
      } catch {
        return false;
      }
    };
    const baseFrame = `${slug}:base`;
    if (!addFrame(baseFrame, baseRect)) return false;

    try {
      // Base floor: tile the all-lower frame across the whole zone (depth -1).
      this.add
        .tileSprite(zr.px, zr.py, zr.pw, zr.ph, key, baseFrame)
        .setOrigin(0, 0)
        .setDepth(-1);
    } catch {
      return false;
    }

    // Deterministic accent band of the upper tile (e.g. an art-deco rug strip down
    // the room) — purely decorative, integer-placed, never RNG. Drawn just above the
    // base (still under the stroke layer at depth 0).
    const accentFrame = `${slug}:accent`;
    if (accentRect !== baseRect && addFrame(accentFrame, accentRect)) {
      const bandH = Math.min(tile * 2, Math.floor(zr.ph / 3));
      const bandY = zr.py + Math.floor((zr.ph - bandH) / 2);
      try {
        this.add
          .tileSprite(zr.px + tile, bandY, Math.max(0, zr.pw - tile * 2), bandH, key, accentFrame)
          .setOrigin(0, 0)
          .setDepth(-1)
          .setAlpha(0.85);
      } catch {
        /* accent is optional — base floor already drew */
      }
    }
    return true;
  }

  /**
   * Programmatic Cold-Lovecraftian-Noir floor for one zone (the rich fallback that
   * replaces the old flat rectangle). Deep teal-charcoal base + cold vertical
   * gradient + faint board planks + a deterministic speckle + an inset vignette so
   * lamplight pools read against it. Deterministic & integer-keyed; cosmetic only.
   */
  private drawNoirFloor(zr: ZoneRect): void {
    let g: Phaser.GameObjects.Graphics;
    try {
      g = this.add.graphics().setDepth(-1);
    } catch {
      return; // graphics unavailable — camera bg is the final fallback
    }
    const { px, py, pw, ph } = zr;
    // base teal-charcoal floor
    g.fillStyle(COL_ROOM, 1);
    g.fillRect(px, py, pw, ph);
    // cold vertical gradient: darker toward the top of the room (gaslight falls down)
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const t = i / bands;
      g.fillStyle(0x10_18_1b, 0.16 * (1 - t));
      g.fillRect(px, py + (ph * i) / bands, pw, ph / bands + 1);
    }
    // faint floorboard planks (cold strokes), spaced by a fixed integer pitch
    g.lineStyle(1, 0x16_24_27, 0.55);
    const plankPitch = 22;
    for (let x = px + plankPitch; x < px + pw; x += plankPitch) {
      g.lineBetween(x, py, x, py + ph);
    }
    // deterministic dust speckle (fixed grid + checker offset — never RNG in logic)
    g.fillStyle(0x2a_3a_3e, 0.4);
    const sp = 18;
    for (let sx = px + 6; sx < px + pw; sx += sp) {
      for (let sy = py + 6; sy < py + ph; sy += sp) {
        const off = (((sx - px) / sp + (sy - py) / sp) & 1) === 0 ? 0 : 9;
        g.fillCircle(sx + off, sy, 1);
      }
    }
    // inset vignette: concentric darkening frames toward the room edges (noir mood)
    for (let r = 0; r < 4; r++) {
      g.fillStyle(0x0c_12_14, 0.07);
      const inset = r * 6;
      g.fillRect(px + inset, py + inset, pw - inset * 2, Math.max(0, 4));
      g.fillRect(px + inset, py + ph - inset - 4, pw - inset * 2, Math.max(0, 4));
      g.fillRect(px + inset, py + inset, Math.max(0, 4), ph - inset * 2);
      g.fillRect(px + pw - inset - 4, py + inset, Math.max(0, 4), ph - inset * 2);
    }
  }

  /** ROOM-BASED: place ONLY the active room's items (zone === activeZone). */
  private placeItems(map: MapDef): void {
    const roomItems = itemsInRoom(this.view.items, this.activeZone ?? "");
    for (const item of roomItems) {
      const center = cellCenter(map.navGrid, item.coords.x, item.coords.y);
      const glyph = this.add
        .rectangle(center.x, center.y, ITEM_SIZE, ITEM_SIZE, COL_ITEM, 1)
        .setStrokeStyle(2, COL_ITEM_STROKE, 1)
        .setDepth(3)
        .setAngle(45)
        .setInteractive({ useHandCursor: true });
      // Pillar 2: items opt into lighting so the Perception halo can surface them.
      enableLighting(glyph);
      glyph.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.handlers.onExamineItem(item.id);
      });
      this.itemSprites.push(glyph);
    }
  }

  /** Pillar 3 / ROOM-BASED: place ONLY the doors LEAVING the active room (from === activeZone). */
  private placeDoors(map: MapDef): void {
    const roomDoors = doorsFromRoom(map.doors, this.activeZone ?? "");
    for (const door of roomDoors) {
      const center = cellCenter(map.navGrid, door.coords.x, door.coords.y);
      const glyph = this.add
        .rectangle(center.x, center.y, DOOR_SIZE, DOOR_SIZE + 8, COL_DOOR, 1)
        .setStrokeStyle(2, COL_DOOR_STROKE, 1)
        .setDepth(3)
        .setInteractive({ useHandCursor: true });
      glyph.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.enterDoor(door);
      });
      this.doorSprites.push(glyph);
    }
  }

  /**
   * ROOM-BASED transition: a door is the ONLY thing that changes the active room.
   * Keep the cosmetic cold-veil fade, set the active zone to `door.to`, RE-RENDER the
   * destination room (clear old room sprites, redraw the floor, place the new room's
   * npcs/items/doors), reposition the avatar to the destination's entry cell, and
   * report the zone change to the (authoritative) shell.
   */
  private enterDoor(door: Door): void {
    // Cosmetic cold-veil fade on the transition (Pillar 4); the logical zone change
    // is reported to the shell, which remains authoritative over reachability.
    try {
      if (this.quality !== "low") this.cameras.main.fade(160, 18, 22, 30, false);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.cameras.main.fadeIn(160, 18, 22, 30);
      });
    } catch {
      /* no-op */
    }
    // SOUND: the door creak on a zone transition (silent until sfx-door.mp3 lands).
    try {
      this.fx.playSfx(this, "doorOpen");
    } catch {
      /* no-op */
    }
    // Snap the active room to the door's destination and rebuild that room.
    this.activeZone = door.to;
    this.renderActiveRoom(this.view.map);
    // Drop the avatar at the destination room's entry cell (mirror of the door edge).
    this.repositionAvatarToCell(doorEntryCell(this.view.map.navGrid, door));

    // LOGICAL: the door (never walking) drives the zone change. Report both the door
    // crossing and the new zone so the server logs perception for the destination.
    this.handlers.onEnterDoor?.(door.from, door.to);
    this.setAvatarZone(door.to);
  }

  /** Snap the avatar (cosmetic tween source) onto a cell in the active room. */
  private repositionAvatarToCell(cell: Cell): void {
    this.avatarCell = cell;
    this.moveTimer?.remove();
    this.avatarTween?.remove();
    if (!this.avatar) return;
    const center = cellCenter(this.view.map.navGrid, cell.col, cell.row);
    this.avatar.setPosition(center.x, center.y);
    try {
      this.fx.playerLight(this, center.x, center.y, this.playerLightRadius);
    } catch {
      /* unlit fallback */
    }
  }

  /**
   * Build an actor body: a portrait SPRITE (Image) scaled to `targetH` if its
   * texture loaded, ELSE the circle Graphics fallback. Cosmetic only — the actor's
   * logical position is its container's cell, never this visual. Returns a child
   * positioned at (0,0) for the container.
   */
  private makeActorBody(
    textureKey: string,
    targetH: number,
    radius: number,
    fill: number,
    stroke: number,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Arc {
    try {
      if (this.textures.exists(textureKey)) {
        const img = this.add.image(0, 0, textureKey);
        const h = img.height || targetH;
        const scale = targetH / h;
        img.setScale(scale);
        // anchor near the feet so sprites "stand" on the floor cell
        img.setOrigin(0.5, 0.78);
        return img;
      }
    } catch {
      /* texture/image unavailable — fall through to the circle */
    }
    return this.add.circle(0, 0, radius, fill, 1).setStrokeStyle(2, stroke, 1);
  }

  /**
   * Build a DIRECTIONAL PixelLab character sprite body (8-way). Returns the south
   * (idle) Image scaled to `targetH` if the slug's south frame loaded, ELSE null so
   * the caller falls back to a portrait sprite or the circle. Cosmetic only — the
   * actor's logical position stays its container cell; the facing frame is decorative.
   */
  private makeDirSpriteBody(slug: string | undefined, targetH: number): Phaser.GameObjects.Image | null {
    if (!slug) return null;
    try {
      const key = spriteFrameKey(slug, "south");
      if (!this.textures.exists(key)) return null;
      const img = this.add.image(0, 0, key);
      const h = img.height || targetH;
      img.setScale(targetH / h);
      img.setOrigin(0.5, 0.82); // feet near the cell
      return img;
    } catch {
      return null;
    }
  }

  /**
   * Swap a directional sprite to the frame nearest a movement heading (dcol, drow).
   * Idle (0,0) → south. Guarded: a missing frame leaves the current one. Cosmetic.
   */
  private faceDirSprite(img: Phaser.GameObjects.Image | undefined, slug: string | undefined, dcol: number, drow: number): void {
    if (!img || !slug) return;
    try {
      const dir = headingToDir(dcol, drow);
      const key = spriteFrameKey(slug, dir);
      if (this.textures.exists(key) && img.texture.key !== key) img.setTexture(key);
    } catch {
      /* keep current frame */
    }
  }

  /** ROOM-BASED: place ONLY the NPCs whose home is the active room (homeZone === activeZone). */
  private placeNpcs(map: MapDef): void {
    const grid = map.navGrid;
    for (const npc of npcsInRoom(this.view.npcs, this.activeZone ?? "")) {
      // Seat at the active room's centre until the first tick sync drops it on its cell.
      const seat = cellCenter(grid, Math.floor(grid.cols / 2), Math.floor(grid.rows / 2));

      // PREFER the 8-direction PixelLab sprite; else the portrait; else the amber circle.
      const slug = this.npcSlugs.get(npc.id);
      const dirBody = this.makeDirSpriteBody(slug, NPC_DIR_SPRITE_H);
      const body =
        dirBody ?? this.makeActorBody(npcPortraitKey(npc.id), NPC_SPRITE_H, NPC_RADIUS, COL_NPC, COL_NPC_STROKE);
      enableLighting(body);
      const labelY = body instanceof Phaser.GameObjects.Image ? body.displayHeight / 2 + 2 : NPC_RADIUS + 2;
      const label = this.add
        .text(0, labelY, npc.name, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#e8b86d",
        })
        .setOrigin(0.5, 0);

      const container = this.add.container(seat.x, seat.y, [body, label]).setDepth(5);
      container.setSize(NPC_RADIUS * 2, NPC_RADIUS * 2);
      container.setInteractive(
        new Phaser.Geom.Circle(0, 0, Math.max(NPC_RADIUS, 22)),
        Phaser.Geom.Circle.Contains,
      );
      container.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
        this.handlers.onApproachNpc(npc.id);
      });

      this.npcSprites.push({
        view: npc,
        container,
        lastCol: -1,
        lastRow: -1,
        ...(dirBody ? { slug, dirImage: dirBody } : {}),
      });
    }
  }

  // ── Pillar 3: the walkable avatar ──
  private spawnAvatar(map: MapDef): void {
    // ROOM-BASED: spawn in the active room near its centre — a deterministic on-grid
    // seat. The avatar walks freely WITHIN this room; doors move it between rooms.
    const grid = map.navGrid;
    this.avatarCell = { col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) };
    this.avatarZoneId = this.activeZone;

    const center = cellCenter(grid, this.avatarCell.col, this.avatarCell.row);
    // PREFER the detective's 8-direction PixelLab sprite; else the portrait; else disc.
    const dirBody = this.makeDirSpriteBody(PLAYER_SPRITE_SLUG, AVATAR_DIR_SPRITE_H);
    const body =
      dirBody ?? this.makeActorBody(AVATAR_PORTRAIT_KEY, AVATAR_SPRITE_H, AVATAR_RADIUS, COL_AVATAR, COL_AVATAR_STROKE);
    if (dirBody) this.avatarDirImage = dirBody;
    enableLighting(body);
    const ring = this.add.circle(0, 0, AVATAR_RADIUS + 5, COL_AVATAR, 0).setStrokeStyle(1, COL_AVATAR_STROKE, 0.5);
    this.avatar = this.add.container(center.x, center.y, [ring, body]).setDepth(6);

    // Pillar 2: the Perception player-follow light starts at the spawn point.
    try {
      this.fx.playerLight(this, center.x, center.y, this.playerLightRadius);
    } catch {
      /* unlit fallback */
    }

    // Tap-to-path: tapping empty world routes the avatar via A* (Pillar 3).
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (p.getDistance() > 14) return; // ignore drags
      const world = this.cameras.main.getWorldPoint(p.x, p.y);
      const goal = pixelToCell(grid, world.x, world.y);
      this.pathAvatarTo(goal);
    });

    if (this.avatarZoneId) this.handlers.onMovePlayer?.(this.avatarZoneId);
  }

  private setupKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    try {
      this.cursors = kb.createCursorKeys();
      this.wasdKeys = {
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      };
    } catch {
      /* keyboard unavailable (mobile) — tap-to-path still works */
    }
  }

  /** Route the avatar to a goal cell along the A* path (cosmetic tween chain). */
  private pathAvatarTo(goal: Cell): void {
    const path = findPath(this.view.map.navGrid, this.avatarCell, goal);
    if (path.length < 2) return;
    this.moveTimer?.remove();
    this.avatarTween?.remove();
    let i = 1; // path[0] is the current cell
    const stepNext = (): void => {
      if (i >= path.length) return;
      const cell = path[i];
      i += 1;
      if (cell) this.stepAvatarTo(cell, false);
    };
    stepNext();
    // chain remaining steps on a fixed cadence (cosmetic)
    this.moveTimer = this.time.addEvent({
      delay: MS_PER_STEP,
      repeat: Math.max(0, path.length - 2),
      callback: stepNext,
    });
  }

  /**
   * Move the avatar to an ADJACENT cell with a cosmetic tween. ROOM-BASED: walking
   * NEVER changes the logical zone — the avatar roams freely WITHIN the active room,
   * and only a door (enterDoor) transitions rooms. The tween is never read by logic.
   */
  private stepAvatarTo(cell: Cell, throttle: boolean): void {
    if (!this.avatar) return;
    if (throttle && this.avatarTween && this.avatarTween.isPlaying()) return;
    // Face the PixelLab sprite toward the movement heading (idle faces south).
    this.faceDirSprite(this.avatarDirImage, PLAYER_SPRITE_SLUG, cell.col - this.avatarCell.col, cell.row - this.avatarCell.row);
    this.avatarCell = cell;
    // SOUND: a soft footstep per cell step (silent no-op until sfx-footstep.mp3 lands).
    try {
      this.fx.playSfx(this, "footstep");
    } catch {
      /* no-op */
    }
    const target = cellCenter(this.view.map.navGrid, cell.col, cell.row);
    this.avatarTween?.remove();
    this.avatarTween = this.tweens.add({
      targets: this.avatar,
      x: target.x,
      y: target.y,
      duration: MS_PER_STEP,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        // keep the Perception light glued to the avatar (cosmetic)
        try {
          this.fx.playerLight(this, this.avatar!.x, this.avatar!.y, this.playerLightRadius);
        } catch {
          /* no-op */
        }
      },
    });
  }

  private setAvatarZone(zoneId: string): void {
    this.avatarZoneId = zoneId;
    this.handlers.onMovePlayer?.(zoneId);
    // a small cosmetic footstep puff at the avatar on a zone change
    try {
      if (this.avatar) this.fx.emit(this, "puff", this.avatar.x, this.avatar.y);
    } catch {
      /* no-op */
    }
    // SOUND: swap the looping ambience to the new zone's bed (no-op if absent).
    this.updateAmbience(zoneId);
  }

  /** SOUND: keep one looping ambience bed matching the player's current zone.
   *  Cosmetic only; a silent no-op until per-zone ambience clips are authored. */
  private updateAmbience(zoneId: string | null | undefined): void {
    if (!zoneId) return;
    try {
      this.fx.playAmbience(this, zoneId);
    } catch {
      /* no-op */
    }
  }

  private advanceTick(): void {
    this.tick += 1;
    this.syncNpcsToTick(false);
  }

  /** Deterministic per-tick ambient drift for the ACTIVE room's NPCs (npcSprites only
   *  ever holds the active room's cast — placeNpcs filters by homeZone). Each NPC's
   *  cell is a pure f(seed,id,tick) over the full room grid; the tween is cosmetic. */
  private syncNpcsToTick(instant: boolean): void {
    const grid = this.view.map.navGrid;
    for (const sprite of this.npcSprites) {
      const zoneId = zoneAtTick(sprite.view.routine, this.tick, sprite.view.homeZone);
      const zr = this.zoneRects.get(zoneId);
      const zone =
        zr?.zone ?? this.zoneRects.get(sprite.view.homeZone)?.zone ?? this.view.map.zones[0];
      if (!zone) continue;

      const cell = logicalCell(grid, zone, this.view.dailySeed, sprite.view.id, this.tick);
      if (cell.col === sprite.lastCol && cell.row === sprite.lastRow) continue;
      // Face the PixelLab sprite toward its heading; the initial placement (lastCol<0)
      // keeps the south idle frame rather than reading a bogus heading.
      const hadPrev = sprite.lastCol >= 0 && sprite.lastRow >= 0;
      this.faceDirSprite(
        sprite.dirImage,
        sprite.slug,
        hadPrev ? cell.col - sprite.lastCol : 0,
        hadPrev ? cell.row - sprite.lastRow : 0,
      );
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

  /**
   * Shell-driven: frame a room. ROOM-BASED — there is no off-screen pan; "framing" a
   * zone IS entering that room. Switches the active room, re-renders it, drops the
   * avatar at the room centre, and reports the zone (so perception logs it). No-op if
   * already the active room (avoids a spurious re-render/perception event).
   */
  setActiveZone(zoneId: string): void {
    if (!this.zoneRects.has(zoneId) || zoneId === this.activeZone) return;
    this.activeZone = zoneId;
    this.renderActiveRoom(this.view.map);
    const grid = this.view.map.navGrid;
    this.repositionAvatarToCell({ col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) });
    try {
      this.fx.setZoneLighting(this, zoneId);
    } catch {
      /* unlit fallback */
    }
    this.setAvatarZone(zoneId);
  }

  /** Public (shell): move the player INTO a zone — in the room model that's switching
   *  the active room (delegates to setActiveZone, which re-renders + reports). */
  movePlayerTo(zoneId: string): void {
    this.setActiveZone(zoneId);
  }

  setPlayerLight(radius: number): void {
    this.playerLightRadius = Math.max(0, radius);
    if (this.avatar) {
      try {
        this.fx.playerLight(this, this.avatar.x, this.avatar.y, this.playerLightRadius);
      } catch {
        /* no-op */
      }
    }
  }

  setQuality(level: FxQuality): void {
    this.quality = level;
    this.fx.setQuality(level);
  }

  private teardown(): void {
    this.tickTimer?.remove();
    this.moveTimer?.remove();
    this.avatarTween?.remove();
    for (const s of this.npcSprites) s.tween?.remove();
    // SOUND: stop the looping ambience bed so it doesn't outlive the scene.
    try {
      this.fx.stopAmbience(this);
    } catch {
      /* no-op */
    }
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

  const fx = createFx();
  // Calls (movePlayerTo / setPlayerLight / setQuality / setActiveZone) can arrive
  // before the scene boots — queue and flush from create() via onReady.
  const pending: Array<() => void> = [];
  let booted = false;
  const scene = new WorldScene(view, handlers, fx, () => {
    booted = true;
    for (const fn of pending.splice(0)) fn();
  });
  const whenReady = (fn: () => void): void => {
    if (booted) fn();
    else pending.push(fn);
  };

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
      whenReady(() => scene.setActiveZone(zoneId));
    },
    pause(): void {
      if (scene.scene && scene.scene.isActive()) scene.scene.pause();
    },
    resume(): void {
      if (scene.scene && scene.scene.isPaused()) scene.scene.resume();
    },
    movePlayerTo(zoneId: string): void {
      whenReady(() => scene.movePlayerTo(zoneId));
    },
    setPlayerLight(radius: number): void {
      whenReady(() => scene.setPlayerLight(radius));
    },
    setQuality(level: "high" | "low"): void {
      whenReady(() => scene.setQuality(level));
    },
    destroy(): void {
      game.destroy(true);
    },
  };
}
