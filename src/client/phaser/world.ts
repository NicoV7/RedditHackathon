/**
 * src/client/phaser/world.ts — C10 "living world" Phaser scene, SIDE-SCROLL PLATFORMER.
 *
 * Renders ONE room at a time as a 2D side-scroller: an Arcade-physics avatar with
 * gravity + run + jump, a camera that follows the avatar across a world wider than the
 * viewport, a ground line + cosmetic platforms, and NPC/item/door glyphs standing along
 * the ground (placed by the pure `roomLayout` deriver). Tapping an NPC emits
 * `handlers.onApproachNpc(id)`; tapping an item emits `handlers.onExamineItem(id)`;
 * walking up to / tapping a door runs `enterDoor` → `handlers.onEnterDoor(from,to)` and
 * `handlers.onMovePlayer(to)` (the perception model). Proximity prompts + touch controls
 * land in the next slice; this slice keeps tap-to-interact so the world stays playable.
 *
 * DETERMINISM (CLAUDE.md hard rule): the avatar's FLOAT physics position is COSMETIC and
 * is never read by game logic. The only LOGICAL state is the active ZONE (room) — changed
 * ONLY by a door (never by x-position) and reported via onMovePlayer — plus the integer
 * tick. NPCs idle at a deterministic spawn-X (no float-in-logic). No Math.random /
 * Date.now / float accumulation in any logical state. No killer knowledge: sanitized view.
 *
 * PHASER PILLARS (Part 4) — all COSMETIC, never read back by logic (Part 4.2):
 *  - Pillar 2: cold ambient + per-zone gaslight + a player-follow light (setPlayerLight).
 *  - Pillar 3: Arcade-physics avatar (gravity/jump), ground/platform colliders, doors.
 *  - Pillar 4: camera fade on transitions, footstep/door SFX, ambience bed.
 * A setQuality('low') path disables filters/lights/particles (Part 4.4).
 *
 * Palette — "Lamplight Noir": #1B2A2E teal-charcoal rooms · #E8B86D amber NPCs.
 */
import Phaser from "phaser";
import type { ClientCaseView } from "../../shared/api.js";
import type { Door, MapDef } from "../../shared/case.js";
import { hashSeed } from "../../shared/prng.js";
import { portraitFor } from "../ui/portraits.js";
import type { WorldHandle, WorldHandlers } from "../bridge.js";
import {
  loadAssets,
  loadZoneAssets,
  PLAYER_SPRITE_SLUG,
  spriteFrameKey,
  spriteFrameUrl,
  spriteSlugPresent,
  npcSpriteSlugForIndex,
  OVERWORLD_CLIPS,
  overworldFrameKey,
  overworldFrameUrl,
  type OverworldClip,
  mapTilesetKey,
  mapTilesetUrl,
  mapTilesetMeta,
} from "./assets.js";
import { buildWangAtlas, wangRectForCorners, type WangAtlas, type WangTilesetMeta } from "./wang.js";
import { createFx, type FxQuality, type ParlorFx } from "./fx.js";
import { npcsInRoom, itemsInRoom, doorsFromRoom, doorEntryCell } from "./room.js";
import { roomLayout, cellToWorldX, type Placement } from "./roomLayout.js";
import { mapToLevel, type RoomLevel } from "./mapToLevel.js";
import { ZONE_MAPS } from "./zoneMaps.js";
import { inputVector } from "./movement.js";
import { nearestInteractable, type InteractCandidate, type InteractHit } from "./interact.js";

// ── Lamplight Noir palette ──
const COL_BG = 0x12_1c_1f; // deep backdrop behind rooms
const COL_BACKDROP_TOP = 0x10_18_1b; // dark top of the room wall
const COL_BACKDROP_BOT = 0x1b_2a_2e; // teal-charcoal toward the floor
const COL_GROUND = 0x16_24_27; // ground slab
const COL_GROUND_EDGE = 0x2c_44_4a; // ground top edge highlight
const COL_PLATFORM = 0x24_3a_40; // floating platform
const COL_PLATFORM_EDGE = 0x3d_5a_61;
const COL_NPC = 0xe8_b8_6d; // amber NPC body (circle fallback)
const COL_NPC_STROKE = 0xa8_82_46;
const COL_ITEM = 0x7e_a8_b0; // cool slate item glyph
const COL_ITEM_STROKE = 0x3d_5a_61;
const COL_AVATAR = 0xcf_dd_df; // pale lamplit detective (blob fallback)
const COL_AVATAR_STROKE = 0x8f_a8_ac;
const COL_DOOR = 0x9a_8a_b0; // muted violet door glyph
const COL_DOOR_STROKE = 0x5a_4a_70;

// ── Platformer feel (all COSMETIC — never read by logic) ──
const GRAVITY_Y = 900; // px/s²
const MOVE_SPEED = 170; // px/s horizontal run
const JUMP_VELOCITY = 430; // px/s launch (≈ 6 cells of rise — clears the platforms)
/** How close (px) the avatar must be to an interactable to surface its prompt. */
const INTERACT_RANGE = 46;

// ── Glyph / body sizing ──
const AVATAR_BODY_W = 14;
const AVATAR_BODY_H = 26;
const AVATAR_ART_H = 46; // cosmetic sprite height
const NPC_ART_H = 46;
const ITEM_SIZE = 16;
const DOOR_W = 18;
const DOOR_H = 30;

// ── Render depths ──
const DEPTH_BACKDROP = -10;
const DEPTH_GROUND = 0;
const DEPTH_PLATFORM = 1;
const DEPTH_GLYPH = 4;
const DEPTH_NPC = 5;
const DEPTH_AVATAR = 6;
const DEPTH_UI = 20; // camera-pinned prompt + touch controls

// Cropped frame names registered on a zone's map-tileset texture (Wang fill + top edge).
const TILE_FRAME_FILL = "fill";
const TILE_FRAME_TOP = "top";

/** Per-character portrait texture key (cosmetic art cache; never read by logic). */
function npcPortraitKey(npcId: string): string {
  return `worldportrait_${npcId.replace(/[^a-z0-9]/gi, "_")}`;
}
const AVATAR_PORTRAIT_KEY = "worldportrait_avatar";
const AVATAR_BLOB_KEY = "avatar_blob";
const NPC_BLOB_KEY = "npc_blob";

type Facing = "l" | "r";

class WorldScene extends Phaser.Scene {
  private readonly view: ClientCaseView;
  private readonly handlers: WorldHandlers;
  private readonly fx: ParlorFx;
  private quality: FxQuality = "high";

  /** stable npcId → assigned PixelLab slug (cosmetic; computed once in preload). */
  private npcSlugs = new Map<string, string>();

  /** every room-scoped display object (backdrop, ground, platforms, glyphs) — destroyed on a room rebuild. */
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  /** the static ground/platform bodies the avatar collides with (subset of roomObjects). */
  private staticBlocks: Phaser.GameObjects.GameObject[] = [];
  private groundCollider?: Phaser.Physics.Arcade.Collider;

  private activeZone: string | null = null;
  private level?: RoomLevel;

  // ── avatar (Pillar 3) ──
  /** the physics body the camera follows + collides; its float (x,y) is COSMETIC. */
  private avatarBody?: Phaser.Physics.Arcade.Sprite;
  /** the cosmetic sprite art drawn standing on the body's feet (decoupled from physics). */
  private avatarArt?: Phaser.GameObjects.Image;
  private facing: Facing = "r";
  /** the avatar's LOGICAL zone — the only thing perception reads. */
  private avatarZoneId: string | null = null;

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: { left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key; up: Phaser.Input.Keyboard.Key };
  private jumpKey?: Phaser.Input.Keyboard.Key;
  private interactKey?: Phaser.Input.Keyboard.Key;
  /** Perception light radius (cosmetic). Defaults to a small reveal halo. */
  private playerLightRadius = 90;

  // ── proximity interaction + touch controls (PR2) ──
  /** the active room's interactables, recomputed on each room build. */
  private candidates: InteractCandidate[] = [];
  /** the interactable currently in range (drives the prompt + the interact action). */
  private currentHit: InteractHit | null = null;
  /** camera-pinned proximity prompt — persists across room rebuilds. */
  private promptLabel?: Phaser.GameObjects.Text;
  /** on-screen touch state (mobile); merged with the keyboard each frame. */
  private readonly touch = { left: false, right: false, jumpQueued: false };

  private readonly onReady?: () => void;

  constructor(view: ClientCaseView, handlers: WorldHandlers, fx: ParlorFx, onReady?: () => void) {
    super("world");
    this.view = view;
    this.handlers = handlers;
    this.fx = fx;
    this.onReady = onReady;
  }

  /**
   * Preload world art + audio (Pillar 4). Pulls the global manifest + every zone's
   * ambience via the safe loaders, plus each character's side (east) directional frame
   * and portrait so they render as SPRITES rather than blobs. Every queue is a documented
   * no-op when the file is absent (assets.ts), so the scene always boots on the fallback.
   *
   * COSMETIC-FX GUARD (Part 4.2): nothing loaded here is ever read by game logic.
   */
  preload(): void {
    try {
      loadAssets(this);
      for (const zone of this.view.map.zones) loadZoneAssets(this, zone.id);
    } catch {
      /* loader unavailable — the world renders on the programmatic fallback */
    }
    this.assignPixelArt();
    const slugs = new Set<string>(this.npcSlugs.values());
    slugs.add(PLAYER_SPRITE_SLUG);
    try {
      // PREFER the new overworld set (idle/run/jump); FALL BACK to the dialogue east
      // frame as a side-view placeholder. Both queues are no-ops when the file is absent.
      for (const slug of slugs) {
        for (const clip of OVERWORLD_CLIPS) {
          const owKey = overworldFrameKey(slug, clip);
          const owUrl = overworldFrameUrl(slug, clip);
          if (owUrl && !this.textures.exists(owKey)) this.load.image(owKey, owUrl);
        }
        const dirKey = spriteFrameKey(slug, "east");
        if (spriteSlugPresent(slug) && !this.textures.exists(dirKey)) {
          const url = spriteFrameUrl(slug, "east");
          if (url) this.load.image(dirKey, url);
        }
      }
    } catch {
      /* loader/art unavailable — actors fall back to portraits / blobs */
    }
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
      /* loader/art unavailable — actors fall back to blobs */
    }
    try {
      // Per-zone sidescroller map TILESET (the ground/platform skin); absent → colored blocks.
      for (const zone of this.view.map.zones) {
        const key = mapTilesetKey(zone.id);
        const url = mapTilesetUrl(zone.id);
        if (url && !this.textures.exists(key)) this.load.image(key, url);
      }
    } catch {
      /* loader/art unavailable — terrain falls back to colored blocks */
    }
    try {
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
        /* handled by per-object create() fallbacks */
      });
    } catch {
      /* no-op */
    }
  }

  /**
   * Deterministically assign each NPC a PixelLab character slug (stable hash of npcId
   * over the project PRNG — never Math.random/Date.now), so within a run a given NPC
   * always shows the same sprite and `detective` stays reserved for the player.
   *
   * COSMETIC-FX GUARD: slug selection is decorative only — never read by game logic.
   */
  private assignPixelArt(): void {
    if (this.npcSlugs.size > 0) return; // idempotent
    const npcs = this.view.npcs;
    for (let i = 0; i < npcs.length; i++) {
      const npc = npcs[i];
      if (!npc) continue;
      const h = hashSeed(`${this.view.dailySeed}|sprite|${npc.id}`);
      const slug = npcSpriteSlugForIndex(h + i);
      if (slug) this.npcSlugs.set(npc.id, slug);
    }
  }

  create(): void {
    const map: MapDef = this.view.map;
    this.cameras.main.setBackgroundColor(COL_BG);

    // ROOM-BASED model: render ONE room at a time; the active room defaults to the
    // door-graph root (zones[0], always reachable). Doors transition between rooms.
    this.activeZone = map.zones[0]?.id ?? null;

    this.spawnAvatar();
    this.buildUi();
    this.buildRoom(this.activeZone ?? "");
    this.setupKeyboard();

    // LOGICAL: report the spawn zone to the (authoritative) shell once.
    this.avatarZoneId = this.activeZone;
    if (this.avatarZoneId) this.handlers.onMovePlayer?.(this.avatarZoneId);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.onReady?.();
  }

  // ── per-frame run/jump (cosmetic; the logical zone changes only via doors) ──
  override update(): void {
    const sprite = this.avatarBody;
    const body = sprite?.body as Phaser.Physics.Arcade.Body | undefined;
    if (!sprite || !body) return;

    const c = this.cursors;
    const w = this.wasdKeys;
    const left = Boolean(c?.left.isDown || w?.left.isDown) || this.touch.left;
    const right = Boolean(c?.right.isDown || w?.right.isDown) || this.touch.right;
    const v = inputVector({ left, right });
    body.setVelocityX(v.dx * MOVE_SPEED);

    if ((this.jumpPressed() || this.consumeTouchJump()) && body.blocked.down) {
      body.setVelocityY(-JUMP_VELOCITY);
    }

    if (v.dx < 0) this.facing = "l";
    else if (v.dx > 0) this.facing = "r";

    this.refreshNearest(body);
    if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) this.triggerInteract();

    this.updateAvatarClip(body);
    this.syncAvatarArt();
    try {
      this.fx.playerLight(this, sprite.x, sprite.y, this.playerLightRadius);
    } catch {
      /* unlit fallback */
    }
  }

  private jumpPressed(): boolean {
    const keys = [this.jumpKey, this.cursors?.up, this.wasdKeys?.up];
    return keys.some((k) => k !== undefined && Phaser.Input.Keyboard.JustDown(k));
  }

  /** One-shot read of a queued touch-jump (the on-screen ▲ button). */
  private consumeTouchJump(): boolean {
    if (!this.touch.jumpQueued) return false;
    this.touch.jumpQueued = false;
    return true;
  }

  // ── proximity interaction ──────────────────────────────────────────────────

  /** Recompute the in-range interactable and refresh the prompt. Cosmetic affordance. */
  private refreshNearest(body: Phaser.Physics.Arcade.Body): void {
    this.currentHit = nearestInteractable(body.x, body.y, this.candidates, INTERACT_RANGE);
    this.updatePrompt();
  }

  private updatePrompt(): void {
    const label = this.promptLabel;
    if (!label) return;
    if (!this.currentHit) {
      label.setVisible(false);
      return;
    }
    label.setText(this.promptText(this.currentHit)).setVisible(true);
  }

  private promptText(hit: InteractHit): string {
    if (hit.kind === "door") return `[E] Enter ${this.zoneName(hit.toZone)}`;
    if (hit.kind === "npc") return `[E] Talk to ${this.npcName(hit.id)}`;
    return "[E] Examine";
  }

  private zoneName(zoneId: string | undefined): string {
    return this.view.map.zones.find((z) => z.id === zoneId)?.name ?? "next room";
  }

  private npcName(npcId: string): string {
    return this.view.npcs.find((n) => n.id === npcId)?.name ?? "them";
  }

  /** Act on the in-range interactable (the E key, the ▲/E touch button, or a glyph tap). */
  private triggerInteract(): void {
    const hit = this.currentHit;
    if (!hit) return;
    if (hit.kind === "npc") {
      this.handlers.onApproachNpc(hit.id);
      return;
    }
    if (hit.kind === "item") {
      this.handlers.onExamineItem(hit.id);
      return;
    }
    const door = doorsFromRoom(this.view.map.doors, this.activeZone ?? "").find((d) => d.to === hit.toZone);
    if (door) this.enterDoor(door);
  }

  // ── room building ───────────────────────────────────────────────────────

  /**
   * Build (or rebuild) the active room: derive its side-scroll layout, draw the backdrop
   * + ground + platforms (static colliders), place the NPC/item/door glyphs, frame the
   * camera, and seat the avatar (at `entryCol` mapped to world-X when arriving via a door,
   * else a default left-side spawn). All cosmetic — re-deriving never touches solvability.
   */
  private buildRoom(zoneId: string, entryCol?: number): void {
    this.clearRoom();
    const zone = this.view.map.zones.find((z) => z.id === zoneId) ?? this.view.map.zones[0];
    const level = this.buildLevel(zoneId, entryCol);
    this.level = level;

    this.cameras.main.setBounds(0, 0, level.worldW, level.worldH);
    try {
      this.physics.world.setBounds(0, 0, level.worldW, level.worldH);
    } catch {
      /* physics unavailable — colliders simply won't engage */
    }

    this.drawBackdrop(level.worldW, level.worldH, zone?.name ?? zoneId);
    this.buildTerrain(level, zoneId);
    for (const p of level.placements) this.placeGlyph(p);
    this.candidates = level.placements.map((p) =>
      p.toZone !== undefined
        ? { id: p.id, kind: p.kind, x: p.x, y: p.surfaceY, toZone: p.toZone }
        : { id: p.id, kind: p.kind, x: p.x, y: p.surfaceY },
    );
    this.currentHit = null;
    this.updatePrompt();

    // Recreate the avatar↔terrain collider against this room's static blocks.
    this.groundCollider?.destroy();
    if (this.avatarBody) {
      try {
        this.groundCollider = this.physics.add.collider(this.avatarBody, this.staticBlocks);
      } catch {
        /* physics unavailable */
      }
    }

    this.seatAvatar(level.spawnX, level.spawnY);

    try {
      this.fx.setZoneLighting(this, zoneId);
    } catch {
      /* unlit fallback */
    }
    this.updateAmbience(zoneId);
  }

  /**
   * Build the room's platformer level. PREFER the authored speakeasy tilemap (collision/
   * doors/boundaries derived from the map); fall back to the procedural `roomLayout` for
   * any zone without an authored map. Both yield a uniform `RoomLevel`.
   */
  private buildLevel(zoneId: string, entryCol?: number): RoomLevel {
    const map = this.view.map;
    const entities = {
      doors: doorsFromRoom(map.doors, zoneId),
      items: itemsInRoom(this.view.items, zoneId),
      npcs: npcsInRoom(this.view.npcs, zoneId),
    };
    const spec = ZONE_MAPS[zoneId];
    if (spec) return mapToLevel(spec, entities);

    // Fallback: adapt the seeded roomLayout (ground slab + platforms) into a RoomLevel.
    const grid = map.navGrid;
    const zone = map.zones.find((z) => z.id === zoneId) ?? map.zones[0]!;
    const layout = roomLayout({ zone, grid, ...entities, dailySeed: this.view.dailySeed });
    const collisionRects = [
      { x: 0, y: layout.groundY, w: layout.worldW, h: layout.worldH - layout.groundY },
      ...layout.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    ];
    const spawnX =
      entryCol !== undefined
        ? cellToWorldX(entryCol, grid.cols, layout.worldW, grid.cellSize)
        : Math.round(layout.worldW * 0.12);
    return {
      tileSize: grid.cellSize,
      cols: grid.cols,
      rows: grid.rows,
      worldW: layout.worldW,
      worldH: layout.worldH,
      groundY: layout.groundY,
      solid: [],
      collisionRects,
      spawnX,
      spawnY: layout.groundY,
      placements: layout.placements,
    };
  }

  /** Destroy the previous room's display objects + collider before a rebuild. */
  private clearRoom(): void {
    this.groundCollider?.destroy();
    this.groundCollider = undefined;
    for (const o of this.roomObjects) o.destroy();
    this.roomObjects = [];
    this.staticBlocks = [];
  }

  /** Cold side-scroll backdrop: a vertical gradient wall + a room-name label. Cosmetic. */
  private drawBackdrop(worldW: number, worldH: number, zoneName: string): void {
    let g: Phaser.GameObjects.Graphics;
    try {
      g = this.add.graphics().setDepth(DEPTH_BACKDROP);
    } catch {
      return; // camera bg is the final fallback
    }
    const bands = 10;
    for (let i = 0; i < bands; i++) {
      const col = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(COL_BACKDROP_TOP),
        Phaser.Display.Color.ValueToColor(COL_BACKDROP_BOT),
        bands - 1,
        i,
      );
      g.fillStyle(Phaser.Display.Color.GetColor(col.r, col.g, col.b), 1);
      g.fillRect(0, Math.floor(worldH * (i / bands)), worldW, Math.ceil(worldH / bands) + 1);
    }
    this.roomObjects.push(g);

    try {
      const label = this.add
        .text(12, 10, zoneName, { fontFamily: "monospace", fontSize: "12px", color: "#6f8c92" })
        .setScrollFactor(0)
        .setDepth(DEPTH_BACKDROP + 1);
      this.roomObjects.push(label);
    } catch {
      /* text unavailable — backdrop alone is fine */
    }
  }

  /**
   * Render the level's merged collision rects as STATIC colliders the avatar stands on.
   * PREFER the generated PixelLab tileset (tiled fill, with a top-edge tile on the exposed
   * surface, via the Wang metadata); fall back to flat colored blocks when no tileset
   * shipped. Either way the rect IS the static collider, so collision matches the art.
   */
  private buildTerrain(level: RoomLevel, zoneId: string): void {
    const key = mapTilesetKey(zoneId);
    const atlas = this.mapAtlas(zoneId);
    const textured = atlas !== undefined && this.textures.exists(key);
    if (textured) this.ensureTileFrames(key, atlas);

    for (const r of level.collisionRects) {
      const elevated = r.y + r.h <= level.groundY; // entirely above the walk line → a platform
      const depth = elevated ? DEPTH_PLATFORM : DEPTH_GROUND;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      if (textured) {
        const row = Math.round(r.y / level.tileSize);
        const c0 = Math.round(r.x / level.tileSize);
        const len = Math.round(r.w / level.tileSize);
        const frame = this.isTopExposed(level, row, c0, len) ? TILE_FRAME_TOP : TILE_FRAME_FILL;
        this.addTexturedBlock(cx, cy, r.w, r.h, key, frame, depth);
      } else {
        this.addStaticBlock(
          cx,
          cy,
          r.w,
          r.h,
          elevated ? COL_PLATFORM : COL_GROUND,
          elevated ? COL_PLATFORM_EDGE : COL_GROUND_EDGE,
          depth,
        );
      }
    }
  }

  /** A rectangle with a STATIC Arcade body, tracked for both rendering and collision. */
  private addStaticBlock(
    cx: number,
    cy: number,
    w: number,
    h: number,
    fill: number,
    stroke: number,
    depth: number,
  ): Phaser.GameObjects.Rectangle {
    const rect = this.add.rectangle(cx, cy, w, h, fill, 1).setStrokeStyle(1, stroke, 1).setDepth(depth);
    try {
      this.physics.add.existing(rect, true);
    } catch {
      /* physics unavailable — the rect is still drawn */
    }
    this.roomObjects.push(rect);
    this.staticBlocks.push(rect);
    return rect;
  }

  /** A tiled sidescroller-tileset block with a STATIC body (the rect IS the collider). */
  private addTexturedBlock(cx: number, cy: number, w: number, h: number, key: string, frame: string, depth: number): void {
    try {
      const ts = this.add.tileSprite(cx, cy, w, h, key, frame).setDepth(depth);
      this.physics.add.existing(ts, true);
      this.roomObjects.push(ts);
      this.staticBlocks.push(ts);
    } catch {
      // Tile render unavailable — fall back to a colored static block so collision survives.
      this.addStaticBlock(cx, cy, w, h, COL_GROUND, COL_GROUND_EDGE, depth);
    }
  }

  /** Build the Wang atlas for a zone's map tileset metadata, or undefined if absent. */
  private mapAtlas(zoneId: string): WangAtlas | undefined {
    try {
      const meta = mapTilesetMeta(zoneId) as WangTilesetMeta | undefined;
      return meta ? buildWangAtlas(meta) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Register the cropped fill + top-edge frames once per texture. NOTE the sidescroller
   * convention is INVERTED from the top-down tilesets: here "lower" = SOLID material,
   * "upper" = transparent air. So fill = all-lower; the walk surface = air on top
   * (NW/NE upper), solid on the bottom (SW/SE lower).
   */
  private ensureTileFrames(key: string, atlas: WangAtlas): void {
    try {
      const tex = this.textures.get(key);
      if (!tex) return;
      const fill = wangRectForCorners(atlas, { NW: "lower", NE: "lower", SW: "lower", SE: "lower" });
      const top = wangRectForCorners(atlas, { NW: "upper", NE: "upper", SW: "lower", SE: "lower" });
      if (!tex.has(TILE_FRAME_FILL)) tex.add(TILE_FRAME_FILL, 0, fill.x, fill.y, fill.width, fill.height);
      if (!tex.has(TILE_FRAME_TOP)) tex.add(TILE_FRAME_TOP, 0, top.x, top.y, top.width, top.height);
    } catch {
      /* frame registration unavailable — addTexturedBlock falls back to colored blocks */
    }
  }

  /** True iff the row directly above a collision run has any air (so its top tile shows). */
  private isTopExposed(level: RoomLevel, row: number, c0: number, len: number): boolean {
    if (row <= 0) return true;
    const above = level.solid[row - 1];
    if (!above) return true;
    for (let c = c0; c < c0 + len; c++) if (above[c] !== true) return true;
    return false;
  }

  // ── glyphs (NPC / item / door) ───────────────────────────────────────────

  private placeGlyph(p: Placement): void {
    if (p.kind === "npc") this.placeNpc(p);
    else if (p.kind === "item") this.placeItem(p);
    else this.placeDoor(p);
  }

  /** Place an idle NPC standing on the ground at its deterministic spawn-X. */
  private placeNpc(p: Placement): void {
    const npc = this.view.npcs.find((n) => n.id === p.id);
    const slug = this.npcSlugs.get(p.id);
    const art = this.makeActorImage(slug, npcPortraitKey(p.id), NPC_ART_H, NPC_BLOB_KEY, COL_NPC, COL_NPC_STROKE);
    art.setPosition(p.x, p.surfaceY).setDepth(DEPTH_NPC);
    this.makeTappable(art, () => this.handlers.onApproachNpc(p.id));
    this.roomObjects.push(art);

    try {
      const label = this.add
        .text(p.x, p.surfaceY - NPC_ART_H - 2, npc?.name ?? p.id, {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#e8b86d",
        })
        .setOrigin(0.5, 0)
        .setDepth(DEPTH_NPC);
      this.roomObjects.push(label);
    } catch {
      /* label optional */
    }
  }

  /** Place an examinable item glyph (slate diamond) just above the ground. */
  private placeItem(p: Placement): void {
    const glyph = this.add
      .rectangle(p.x, p.surfaceY - ITEM_SIZE, ITEM_SIZE, ITEM_SIZE, COL_ITEM, 1)
      .setStrokeStyle(2, COL_ITEM_STROKE, 1)
      .setAngle(45)
      .setDepth(DEPTH_GLYPH);
    this.makeTappable(glyph, () => this.handlers.onExamineItem(p.id));
    this.roomObjects.push(glyph);
  }

  /** Place a door glyph standing on the ground; tap (or, later, walk-up) transitions rooms. */
  private placeDoor(p: Placement): void {
    const glyph = this.add
      .rectangle(p.x, p.surfaceY, DOOR_W, DOOR_H, COL_DOOR, 1)
      .setOrigin(0.5, 1)
      .setStrokeStyle(2, COL_DOOR_STROKE, 1)
      .setDepth(DEPTH_GLYPH);
    const door = this.doorForPlacement(p);
    this.makeTappable(glyph, () => {
      if (door) this.enterDoor(door);
    });
    this.roomObjects.push(glyph);
  }

  /** Resolve the Door object behind a door placement (from === active room, to === toZone). */
  private doorForPlacement(p: Placement): Door | undefined {
    return doorsFromRoom(this.view.map.doors, this.activeZone ?? "").find((d) => d.to === p.toZone);
  }

  private makeTappable(obj: Phaser.GameObjects.GameObject, fn: () => void): void {
    try {
      (obj as Phaser.GameObjects.GameObject & { setInteractive(c?: unknown): unknown }).setInteractive({
        useHandCursor: true,
      });
      obj.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, fn);
    } catch {
      /* input unavailable — the glyph is still drawn */
    }
  }

  // ── avatar ────────────────────────────────────────────────────────────────

  /** Spawn the persistent physics body (once) + its cosmetic art; the camera follows it. */
  private spawnAvatar(): void {
    const blob = this.ensureBlobTexture(AVATAR_BLOB_KEY, COL_AVATAR, COL_AVATAR_STROKE, AVATAR_BODY_W, AVATAR_BODY_H);
    try {
      this.avatarBody = this.physics.add.sprite(0, 0, blob).setDepth(DEPTH_AVATAR);
      const body = this.avatarBody.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(true);
    } catch {
      // Physics unavailable (e.g. headless) — fall back to a plain image so the scene boots.
      this.avatarBody = this.add.image(0, 0, blob).setDepth(DEPTH_AVATAR) as unknown as Phaser.Physics.Arcade.Sprite;
    }
    this.buildAvatarArt();
    try {
      this.cameras.main.startFollow(this.avatarBody, true, 0.12, 0.12);
    } catch {
      /* camera follow unavailable */
    }
  }

  /** Build the cosmetic avatar sprite (side art if present, else the blob shows through). */
  private buildAvatarArt(): void {
    this.avatarArt?.destroy();
    const key = this.resolveSideArtKey(PLAYER_SPRITE_SLUG, AVATAR_PORTRAIT_KEY);
    if (!key) {
      this.avatarBody?.setVisible(true); // the blob body IS the avatar
      this.avatarArt = undefined;
      return;
    }
    this.avatarBody?.setVisible(false);
    const img = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(DEPTH_AVATAR);
    this.fitImageHeight(img, AVATAR_ART_H);
    this.avatarArt = img;
  }

  /** Seat the avatar body on the ground at world-X `x`, zeroing velocity. */
  private seatAvatar(x: number, groundY: number): void {
    const y = groundY - AVATAR_BODY_H / 2 - 1;
    this.avatarBody?.setPosition(x, y);
    const body = this.avatarBody?.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setVelocity(0, 0);
    this.syncAvatarArt();
    try {
      this.fx.playerLight(this, x, y, this.playerLightRadius);
    } catch {
      /* unlit fallback */
    }
  }

  /**
   * Swap the avatar's overworld frame to match its movement state (airborne→jump,
   * moving→run, else idle). No-op unless the overworld set is bundled — the dialogue/
   * portrait fallback stays put. Cosmetic; never read by logic.
   */
  private updateAvatarClip(body: Phaser.Physics.Arcade.Body): void {
    const art = this.avatarArt;
    if (!art) return;
    const clip: OverworldClip = !body.blocked.down ? "jump" : Math.abs(body.velocity.x) > 5 ? "run" : "idle";
    const key = overworldFrameKey(PLAYER_SPRITE_SLUG, clip);
    if (this.textures.exists(key) && art.texture.key !== key) {
      art.setTexture(key);
      this.fitImageHeight(art, AVATAR_ART_H);
    }
  }

  /** Glue the cosmetic art to the body's feet + face it L/R. Cosmetic only. */
  private syncAvatarArt(): void {
    const sprite = this.avatarBody;
    if (!this.avatarArt || !sprite) return;
    const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
    const feetY = body ? body.bottom : sprite.y + AVATAR_BODY_H / 2;
    this.avatarArt.setPosition(sprite.x, feetY);
    this.avatarArt.setFlipX(this.facing === "l");
  }

  // ── art helpers ─────────────────────────────────────────────────────────

  /**
   * The texture key for an actor's side-view art: prefer its side (east) directional
   * frame, then its portrait, else null (caller uses a generated blob). Cosmetic only.
   */
  private resolveSideArtKey(slug: string | undefined, portraitKey: string): string | null {
    if (slug) {
      const ow = overworldFrameKey(slug, "idle");
      if (this.textures.exists(ow)) return ow; // PREFER the overworld set
      const dir = spriteFrameKey(slug, "east");
      if (this.textures.exists(dir)) return dir; // dialogue side-view placeholder
    }
    if (this.textures.exists(portraitKey)) return portraitKey;
    return null;
  }

  /** An actor Image standing on its feet (origin 0.5,1): art if present, else a blob. */
  private makeActorImage(
    slug: string | undefined,
    portraitKey: string,
    targetH: number,
    blobKey: string,
    fill: number,
    stroke: number,
  ): Phaser.GameObjects.Image {
    const key =
      this.resolveSideArtKey(slug, portraitKey) ??
      this.ensureBlobTexture(blobKey, fill, stroke, Math.round(targetH * 0.5), targetH);
    const img = this.add.image(0, 0, key).setOrigin(0.5, 1);
    this.fitImageHeight(img, targetH);
    return img;
  }

  private fitImageHeight(img: Phaser.GameObjects.Image, targetH: number): void {
    const h = img.height || targetH;
    img.setScale(targetH / h);
  }

  /** Generate (once) a rounded-rect blob texture for the actor fallback. Returns the key. */
  private ensureBlobTexture(key: string, fill: number, stroke: number, w: number, h: number): string {
    if (this.textures.exists(key)) return key;
    try {
      const g = this.add.graphics();
      const r = Math.min(4, Math.floor(Math.min(w, h) / 3));
      g.fillStyle(fill, 1);
      g.fillRoundedRect(0, 0, w, h, r);
      g.lineStyle(2, stroke, 1);
      g.strokeRoundedRect(1, 1, w - 2, h - 2, r);
      g.generateTexture(key, w, h);
      g.destroy();
    } catch {
      /* texture generation unavailable — sprite shows the engine default */
    }
    return key;
  }

  // ── doors / zone changes ──────────────────────────────────────────────────

  /**
   * The ONLY logical zone change: a cosmetic fade, swap the active room to `door.to`,
   * rebuild that room, seat the avatar at the destination's entry cell, then report the
   * crossing + the new zone to the (authoritative) shell.
   */
  private enterDoor(door: Door): void {
    try {
      if (this.quality !== "low") {
        this.cameras.main.fade(160, 18, 22, 30, false);
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          this.cameras.main.fadeIn(160, 18, 22, 30);
        });
      }
    } catch {
      /* no-op */
    }
    try {
      this.fx.playSfx(this, "doorOpen");
    } catch {
      /* no-op */
    }

    this.activeZone = door.to;
    const entry = doorEntryCell(this.view.map.navGrid, door);
    this.buildRoom(door.to, entry.col);

    this.handlers.onEnterDoor?.(door.from, door.to);
    this.setAvatarZone(door.to);
  }

  private setAvatarZone(zoneId: string): void {
    this.avatarZoneId = zoneId;
    this.handlers.onMovePlayer?.(zoneId);
    try {
      if (this.avatarBody) this.fx.emit(this, "puff", this.avatarBody.x, this.avatarBody.y);
    } catch {
      /* no-op */
    }
  }

  /** SOUND: keep one looping ambience bed matching the player's current zone (cosmetic). */
  private updateAmbience(zoneId: string | null | undefined): void {
    if (!zoneId) return;
    try {
      this.fx.playAmbience(this, zoneId);
    } catch {
      /* no-op */
    }
  }

  private setupKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    try {
      this.cursors = kb.createCursorKeys();
      this.wasdKeys = {
        left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      };
      this.jumpKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.interactKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    } catch {
      /* keyboard unavailable (mobile) — the on-screen touch controls drive play */
    }
  }

  // ── shell-driven controls (WorldHandle) ────────────────────────────────────

  /** Frame a room. ROOM-BASED — "framing" a zone IS entering that room. No-op if already active. */
  setActiveZone(zoneId: string): void {
    if (zoneId === this.activeZone || !this.view.map.zones.some((z) => z.id === zoneId)) return;
    this.activeZone = zoneId;
    this.buildRoom(zoneId);
    this.setAvatarZone(zoneId);
  }

  movePlayerTo(zoneId: string): void {
    this.setActiveZone(zoneId);
  }

  setPlayerLight(radius: number): void {
    this.playerLightRadius = Math.max(0, radius);
    const sprite = this.avatarBody;
    if (sprite) {
      try {
        this.fx.playerLight(this, sprite.x, sprite.y, this.playerLightRadius);
      } catch {
        /* no-op */
      }
    }
  }

  setQuality(level: FxQuality): void {
    this.quality = level;
    this.fx.setQuality(level);
  }

  // ── camera-pinned UI: proximity prompt + on-screen touch controls ──────────

  /** Build the (once-only) prompt label + touch buttons; they persist across rooms. */
  private buildUi(): void {
    try {
      this.promptLabel = this.add
        .text(this.scale.width / 2, this.scale.height - 70, "", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#e8e0cf",
          backgroundColor: "rgba(12,18,20,0.7)",
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI)
        .setVisible(false);
    } catch {
      /* text unavailable — proximity still works, just without the on-screen hint */
    }

    // On-screen controls (mobile-first; harmless alongside the keyboard on desktop).
    const y = this.scale.height - 28;
    this.makeTouchButton(30, y, "◄", () => (this.touch.left = true), () => (this.touch.left = false));
    this.makeTouchButton(82, y, "►", () => (this.touch.right = true), () => (this.touch.right = false));
    this.makeTouchButton(this.scale.width - 82, y, "E", () => this.triggerInteract());
    this.makeTouchButton(this.scale.width - 30, y, "▲", () => (this.touch.jumpQueued = true));
  }

  /** A camera-pinned touch button (rect + glyph) wired to press/release callbacks. */
  private makeTouchButton(x: number, y: number, label: string, onDown: () => void, onUp?: () => void): void {
    try {
      const size = 42;
      const bg = this.add
        .rectangle(x, y, size, size, 0x1b_2a_2e, 0.55)
        .setStrokeStyle(1, 0x3d_5a_61, 0.8)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(x, y, label, { fontFamily: "monospace", fontSize: "16px", color: "#cfdddf" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH_UI + 1);
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onDown);
      if (onUp) {
        bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, onUp);
        bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, onUp);
      }
    } catch {
      /* input/text unavailable — keyboard still drives play */
    }
  }

  private teardown(): void {
    this.groundCollider?.destroy();
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
  // The CANVAS is the viewport (one screen of the room); the camera scrolls within the
  // wider world the roomLayout deriver builds. Square viewport keyed to the grid.
  const viewportW = grid.cols * grid.cellSize;
  const viewportH = grid.rows * grid.cellSize;

  const fx = createFx();
  // Calls (movePlayerTo / setPlayerLight / setQuality / setActiveZone) can arrive before
  // the scene boots — queue and flush from create() via onReady.
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
    width: viewportW,
    height: viewportH,
    backgroundColor: COL_BG,
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: GRAVITY_Y }, debug: false },
    },
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
