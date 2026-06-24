/**
 * src/client/phaser/assets.ts — the build-time asset pipeline (PLAN Part 4.4, job
 * J-ASSETS). One typed manifest + one safe loader, consumed by world.ts (tilesets,
 * normal maps, avatar/NPC sheets, ambience), board.ts (corkboard, string-snap SFX),
 * and portrait.ts (the lie-sting). This module is the SINGLE source of asset keys.
 *
 * ── Design contract ──────────────────────────────────────────────────────────
 * • Vite resolves `import x from "../assets/…png"` to a served URL string at BUILD
 *   time (no runtime fetch cost; respects the R4 4 MB payload budget). Files that
 *   don't exist yet have a `src` of `undefined` — a DOCUMENTED slot for real art.
 * • `loadAssets(scene)` preloads ONLY entries whose `src` is present and is a SAFE
 *   NO-OP for absent ones. The game therefore runs today on the low-FX Graphics
 *   fallback (world.ts draws rectangles) and silently upgrades the moment a real
 *   tileset / sprite sheet / audio file lands at the documented path. Nothing here
 *   throws if Phaser, the loader, or any file is missing.
 * • Lazy per-zone loading: `loadZoneAssets(scene, zoneId)` pulls just one zone's
 *   tileset + ambience, so we never ship the whole world up front.
 *
 * ── HARD INVARIANT (CLAUDE.md / PLAN 4.2) ────────────────────────────────────
 * Assets are COSMETIC. No key, source, or load result is ever read by game logic;
 * logical state stays integer/tick-based and server-authoritative. Missing art only
 * changes how the scene LOOKS, never what is true. Asset keys are stable strings so
 * the cosmetic-FX layer (fx.ts) can address a texture without coupling to logic.
 *
 * ── Locked palette (Cold Lovecraftian-Noir, PLAN 1.6 / 4.3) ──────────────────
 * Real 1920s pixel art (PixelLab / CC0) MUST sit inside this palette so the world,
 * portraits, and board read as one piece:
 *   #12_1C_1F  deep backdrop        #1B_2A_2E  teal-charcoal room floor
 *   #2C_44_4A  cold room stroke     #E8_B8_6D  amber lamplight / NPC key
 *   #7E_A8_B0  cool slate (items)   #D4_32_2A  crimson tell (NON-color edge-pulse too)
 * Gaslight is warm-amber point lights over a cold ambient; crimson is reserved for
 * the lie-tell ONLY (and always paired with a non-color cue for colorblind safety).
 */
import type { ZoneId } from "../../shared/case.js";

// ── Placeholder assets that ACTUALLY exist on disk today ──────────────────────
// These keep `loadAssets` exercised end-to-end and let imports resolve. They are
// CC0/programmatic (generated, transparent / flat teal). Real art replaces the
// FILE at the same path; no code change needed (see ../assets/README.md).
import placeholderTileUrl from "../assets/tilesets/placeholder-tile.png";
import placeholderLightUrl from "../assets/normals/placeholder-light.png";

// ─────────────────────────── Manifest value types ────────────────────────────

/** A single still image (tileset image, normal map, corkboard, light cookie). */
export interface ImageAsset {
  readonly key: string;
  /** Vite URL string, or `undefined` for a documented-but-not-yet-authored slot. */
  readonly src?: string;
  /** Documented intent + target dimensions for whoever draws the real art. */
  readonly note: string;
}

/** A fixed-frame sprite sheet (avatar idle/walk cycles, NPC sheets). */
export interface SpriteSheetAsset {
  readonly key: string;
  readonly src?: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly note: string;
}

/** An audio clip. Phaser accepts multiple sources for codec fallback; we keep a
 *  single URL per clip for payload thrift and document the alt-codec slot. */
export interface AudioAsset {
  readonly key: string;
  readonly src?: string;
  readonly note: string;
}

/** Per-zone art bundle, keyed by the generator's ZONE_DEFS ids (procedural.ts). */
export interface ZoneAssets {
  readonly tileset: ImageAsset;
  /** optional cold normal-map for the same tileset (drives self-shadows, Pillar 2). */
  readonly normal?: ImageAsset;
  /** looping ambience for the zone (jazz murmur, kitchen clatter, alley rain…). */
  readonly ambience?: AudioAsset;
}

export interface AssetManifest {
  /** One bundle per zone id. Unknown zones fall back to `defaultZone`. */
  readonly zones: Readonly<Record<string, ZoneAssets>>;
  /** Used for any zone id not present in `zones` (keeps the loader total). */
  readonly defaultZone: ZoneAssets;
  /** Walkable detective avatar (Pillar 3). */
  readonly avatar: SpriteSheetAsset;
  /** Generic animated NPC sheet (Pillar 3); per-character art can override later. */
  readonly npc: SpriteSheetAsset;
  /** Radial light cookie for the Perception radius + gaslight (Pillar 2). */
  readonly lightCookie: ImageAsset;
  /** Cork texture behind the deduction board (Pillar 4, board.ts). */
  readonly corkboard: ImageAsset;
  /** Global SFX, keyed by stable name. */
  readonly sfx: Readonly<Record<SfxName, AudioAsset>>;
  /** Looping music bed (noir jazz). */
  readonly music: AudioAsset;
}

/** Stable SFX names — fx.ts / board.ts / portrait.ts reference these by key. */
export type SfxName =
  | "footstep"
  | "lieSting" // the crimson lie-tell sting (Pillar 1)
  | "stringSnap" // red-string "snap taut" (Pillar 4)
  | "gotcha" // caught-in-lie camera shake cue (Pillar 4)
  | "accuse" // zoom-punch accusation hit (Pillar 4)
  | "doorOpen"; // zone transition (System 2 doors)

// ─────────────────────────── Key helpers (pure) ──────────────────────────────
// Deterministic, allocation-light key derivations. world/board/portrait import
// THESE rather than hand-writing strings, so a key can never drift between the
// manifest and a `scene.add.image(key)` call.

export function tilesetKey(zoneId: ZoneId): string {
  return `tileset:${zoneId}`;
}
export function zoneNormalKey(zoneId: ZoneId): string {
  return `normal:${zoneId}`;
}
export function ambienceKey(zoneId: ZoneId): string {
  return `ambience:${zoneId}`;
}
export const AVATAR_KEY = "avatar" as const;
export const NPC_KEY = "npc" as const;
export const LIGHT_COOKIE_KEY = "lightCookie" as const;
export const CORKBOARD_KEY = "corkboard" as const;
export function sfxKey(name: SfxName): string {
  return `sfx:${name}`;
}
export const MUSIC_KEY = "music" as const;

// ─────────────────────────── The manifest ────────────────────────────────────
// Every zone id below mirrors src/server/case/procedural.ts ZONE_DEFS. A zone with
// no bespoke art points its tileset at the shared placeholder so the loader stays
// total; the `note` is the build instruction for the real 64×… 1920s tileset.

function zone(zoneId: ZoneId, note: string, ambienceNote: string): ZoneAssets {
  return {
    tileset: { key: tilesetKey(zoneId), src: placeholderTileUrl, note },
    normal: {
      key: zoneNormalKey(zoneId),
      // Real normal maps are an optional Pillar-2 upgrade; slot documented, src absent.
      note: `Normal map for ${zoneId} tileset (same dimensions, tangent-space). Optional — lighting falls back to flat. Drop at src/client/assets/normals/${zoneId}-normal.png and import it here.`,
    },
    ambience: {
      key: ambienceKey(zoneId),
      // Audio is a documented slot; no placeholder bytes shipped (payload thrift).
      note: ambienceNote,
    },
  };
}

export const manifest: AssetManifest = {
  zones: {
    // Cold Lovecraftian-Noir 1920s speakeasy "The Drowned Lily".
    parlor: zone(
      "parlor",
      "Bar-floor tileset: warm amber lamplight over teal-charcoal boards, brass rail, piano corner. 16px tiles, target sheet 256×256 (PixelLab/CC0). src/client/assets/tilesets/parlor.png",
      "Looping jazz murmur + glass clink, ~12s seamless loop, mono, ≤120 KB. src/client/assets/audio/ambience-parlor.mp3",
    ),
    kitchen: zone(
      "kitchen",
      "Kitchen tileset: tile floor, steel counters, hanging pots; cold steam haze. 16px, 256×256. src/client/assets/tilesets/kitchen.png",
      "Looping kitchen clatter + low boiler hum, ~10s, mono, ≤120 KB. src/client/assets/audio/ambience-kitchen.mp3",
    ),
    garden: zone(
      "garden",
      "Garden/alley exterior tileset: wet cobbles, iron fence, fog. Coldest palette skew. 16px, 256×256. src/client/assets/tilesets/garden.png",
      "Looping night rain + distant traffic, ~14s, mono, ≤140 KB. src/client/assets/audio/ambience-garden.mp3",
    ),
    study: zone(
      "study",
      "Study/back-room tileset: rugs, ledgers, a desk; tense low light. 16px, 256×256. src/client/assets/tilesets/study.png",
      "Looping clock tick + muffled music through a wall, ~10s, mono, ≤100 KB. src/client/assets/audio/ambience-study.mp3",
    ),
    cellar: zone(
      "cellar",
      "Cellar/storage tileset: brick, casks, single dim bulb; near-dark (Perception light shines here). 16px, 256×256. src/client/assets/tilesets/cellar.png",
      "Looping drip + electrical buzz, ~8s, mono, ≤90 KB. src/client/assets/audio/ambience-cellar.mp3",
    ),
  },
  defaultZone: zone(
    "default",
    "Fallback tileset for any unmapped zone — neutral teal-charcoal floor. 16px. src/client/assets/tilesets/default.png",
    "Generic low room-tone loop, ~10s, mono, ≤80 KB. src/client/assets/audio/ambience-default.mp3",
  ),
  avatar: {
    key: AVATAR_KEY,
    // Documented slot — until real art lands, world.ts keeps drawing the avatar
    // with Graphics; the loader skips this entry (src absent).
    frameWidth: 32,
    frameHeight: 48,
    note: "Detective avatar sprite sheet: 4 dirs × idle(1)+walk(4) = 20 frames, 32×48 each, transparent, amber key-light. Row-major, dirs N/E/S/W. src/client/assets/sprites/avatar.png",
  },
  npc: {
    key: NPC_KEY,
    frameWidth: 32,
    frameHeight: 48,
    note: "Generic NPC sprite sheet (same 4×5 layout/dims as avatar) for ambient cast; per-principal sheets can be added as sprites/npc-<id>.png and imported alongside. src/client/assets/sprites/npc.png",
  },
  lightCookie: {
    key: LIGHT_COOKIE_KEY,
    src: placeholderLightUrl, // tiny radial alpha — real glow can replace the file.
    note: "Radial light cookie (white center → transparent edge) multiplied for the Perception radius + gaslight pools. 128×128 recommended. src/client/assets/normals/light-cookie.png",
  },
  corkboard: {
    key: CORKBOARD_KEY,
    note: "Deduction-board cork/baize texture behind nodes + red string. Tileable, cold-noir tint, 512×512. src/client/assets/tilesets/corkboard.png",
  },
  sfx: {
    footstep: { key: sfxKey("footstep"), note: "Soft footstep on boards, ~150ms, mono, ≤8 KB. src/client/assets/audio/sfx-footstep.mp3" },
    lieSting: { key: sfxKey("lieSting"), note: "Crimson lie-tell sting (cold detuned stab), ~600ms, ≤24 KB. src/client/assets/audio/sfx-lie-sting.mp3" },
    stringSnap: { key: sfxKey("stringSnap"), note: "Red-string snap-taut twang, ~300ms, ≤12 KB. src/client/assets/audio/sfx-string-snap.mp3" },
    gotcha: { key: sfxKey("gotcha"), note: "Caught-in-lie impact (paired with camera shake), ~400ms, ≤16 KB. src/client/assets/audio/sfx-gotcha.mp3" },
    accuse: { key: sfxKey("accuse"), note: "Accusation zoom-punch hit, ~700ms, ≤28 KB. src/client/assets/audio/sfx-accuse.mp3" },
    doorOpen: { key: sfxKey("doorOpen"), note: "Door/zone transition creak, ~500ms, ≤18 KB. src/client/assets/audio/sfx-door.mp3" },
  },
  music: {
    key: MUSIC_KEY,
    note: "Noir-jazz music bed, seamless loop ~30s, stereo OK, ≤400 KB (largest single asset — keep within R4). src/client/assets/audio/music-noir.mp3",
  },
};

// ─────────────────────────── The loader ──────────────────────────────────────
// Phaser's Loader plugin is duck-typed (`unknown` scene) so this module never
// imports Phaser and stays version-agnostic + trivially unit-testable. Every call
// is guarded: a missing loader, a missing method, or a missing `src` is a no-op.

/** Minimal shape of the bits of Phaser's Scene loader we touch. All optional so a
 *  partial / stub / undefined loader degrades to a no-op instead of throwing. */
interface SceneLike {
  load?: LoaderLike;
  textures?: { exists(key: string): boolean };
  cache?: { audio?: { exists(key: string): boolean } };
  sys?: { game?: { device?: { audio?: Record<string, boolean> } } };
}
interface LoaderLike {
  image?(key: string, url: string): unknown;
  spritesheet?(key: string, url: string, cfg: { frameWidth: number; frameHeight: number }): unknown;
  audio?(key: string, url: string | string[]): unknown;
}

/** Result of a load pass — pure counts, handy for tests and a debug overlay.
 *  NEVER read by game logic (cosmetic accounting only). */
export interface LoadReport {
  images: number;
  spritesheets: number;
  audio: number;
  skipped: number;
}

function emptyReport(): LoadReport {
  return { images: 0, spritesheets: 0, audio: 0, skipped: 0 };
}

/** True iff `key` is not already loaded — avoids redundant per-zone re-queues. */
function needsImage(scene: SceneLike, key: string): boolean {
  return !scene.textures?.exists(key);
}
function needsAudio(scene: SceneLike, key: string): boolean {
  const c = scene.cache?.audio;
  return c ? !c.exists(key) : true;
}

function queueImage(scene: SceneLike, asset: ImageAsset, report: LoadReport): void {
  if (!asset.src) {
    report.skipped++;
    return;
  }
  const loader = scene.load;
  if (!loader?.image) {
    report.skipped++;
    return;
  }
  if (!needsImage(scene, asset.key)) return;
  loader.image(asset.key, asset.src);
  report.images++;
}

function queueSheet(scene: SceneLike, asset: SpriteSheetAsset, report: LoadReport): void {
  if (!asset.src) {
    report.skipped++;
    return;
  }
  const loader = scene.load;
  if (!loader?.spritesheet) {
    report.skipped++;
    return;
  }
  if (!needsImage(scene, asset.key)) return;
  loader.spritesheet(asset.key, asset.src, {
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
  });
  report.spritesheets++;
}

function queueAudio(scene: SceneLike, asset: AudioAsset | undefined, report: LoadReport): void {
  if (!asset?.src) {
    report.skipped++;
    return;
  }
  const loader = scene.load;
  if (!loader?.audio) {
    report.skipped++;
    return;
  }
  if (!needsAudio(scene, asset.key)) return;
  loader.audio(asset.key, asset.src);
  report.audio++;
}

function queueZone(scene: SceneLike, bundle: ZoneAssets, report: LoadReport): void {
  queueImage(scene, bundle.tileset, report);
  if (bundle.normal) queueImage(scene, bundle.normal, report);
  queueAudio(scene, bundle.ambience, report);
}

/** Resolve a zone's bundle, falling back to the default for unmapped ids. */
export function zoneBundle(zoneId: ZoneId): ZoneAssets {
  return manifest.zones[zoneId] ?? manifest.defaultZone;
}

/**
 * Preload the GLOBAL assets (avatar, generic NPC, light cookie, corkboard, music,
 * all SFX) plus EVERY zone's tileset/ambience. Safe to call from a Scene's
 * `preload()`. Returns a cosmetic LoadReport. A no-op for whatever isn't authored
 * yet, so the world always boots on the Graphics fallback.
 *
 * For lazy per-zone loading instead, call `loadZoneAssets(scene, zoneId)` on entry.
 */
export function loadAssets(scene: SceneLike | undefined | null, opts?: { zones?: boolean }): LoadReport {
  const report = emptyReport();
  if (!scene) return report;

  // Globals.
  queueSheet(scene, manifest.avatar, report);
  queueSheet(scene, manifest.npc, report);
  queueImage(scene, manifest.lightCookie, report);
  queueImage(scene, manifest.corkboard, report);
  queueAudio(scene, manifest.music, report);
  for (const name of Object.keys(manifest.sfx) as SfxName[]) {
    queueAudio(scene, manifest.sfx[name], report);
  }

  // Zones (eager by default; pass { zones:false } to defer to loadZoneAssets).
  if (opts?.zones !== false) {
    for (const zoneId of Object.keys(manifest.zones)) {
      queueZone(scene, manifest.zones[zoneId]!, report);
    }
  }
  return report;
}

/**
 * Lazily preload ONE zone's art (tileset + optional normal + ambience). Call this
 * as the player crosses a door so we never ship the whole world up front (R4).
 * Falls back to the default-zone bundle for unmapped ids; total no-op for absent
 * files. If the loader isn't currently running, the caller should `scene.load.start()`.
 */
export function loadZoneAssets(scene: SceneLike | undefined | null, zoneId: ZoneId): LoadReport {
  const report = emptyReport();
  if (!scene) return report;
  queueZone(scene, zoneBundle(zoneId), report);
  return report;
}

/** Flat list of every key the manifest defines — for a debug overlay / preflight.
 *  Pure; never consumed by game logic. */
export function allAssetKeys(): string[] {
  const keys = new Set<string>();
  for (const zoneId of Object.keys(manifest.zones)) {
    const z = manifest.zones[zoneId]!;
    keys.add(z.tileset.key);
    if (z.normal) keys.add(z.normal.key);
    if (z.ambience) keys.add(z.ambience.key);
  }
  keys.add(manifest.defaultZone.tileset.key);
  keys.add(manifest.avatar.key);
  keys.add(manifest.npc.key);
  keys.add(manifest.lightCookie.key);
  keys.add(manifest.corkboard.key);
  keys.add(manifest.music.key);
  for (const name of Object.keys(manifest.sfx) as SfxName[]) keys.add(manifest.sfx[name].key);
  return [...keys];
}
