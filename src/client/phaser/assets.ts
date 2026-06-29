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
    // Cold Lovecraftian-Noir 1920s speakeasy "The Drowned Lily". Ids mirror
    // src/server/case/procedural.ts ZONE_DEFS (bar = the start/hub).
    bar: zone(
      "bar",
      "Bar-floor tileset: warm amber lamplight over polished oak boards, brass rail, mahogany bar-top, piano corner. 16px tiles, target sheet 256×256 (PixelLab/CC0). src/client/assets/tilesets/bar.png",
      "Looping jazz murmur + glass clink, ~12s seamless loop, mono, ≤120 KB. src/client/assets/audio/ambience-bar.mp3",
    ),
    lot: zone(
      "lot",
      "Parking-lot exterior tileset: cracked asphalt + concrete curb, a parked 1920s sedan, fog; cold palette. 16px, 256×256. src/client/assets/tilesets/lot.png",
      "Looping night wind + distant traffic + a far car horn, ~14s, mono, ≤140 KB. src/client/assets/audio/ambience-lot.mp3",
    ),
    backbar: zone(
      "backbar",
      "Behind-the-bar back room tileset: brick + oak casks, bottle shelves, a desk and ledgers; dim staff light (Perception light shines here). 16px, 256×256. src/client/assets/tilesets/backbar.png",
      "Looping clock tick + muffled music through the wall, ~10s, mono, ≤100 KB. src/client/assets/audio/ambience-backbar.mp3",
    ),
    alley: zone(
      "alley",
      "Back-alley exterior tileset: wet cobbles, brick, iron fire-escape, a dumpster, fog. Coldest palette skew. 16px, 256×256. src/client/assets/tilesets/alley.png",
      "Looping night rain + drip + distant traffic, ~14s, mono, ≤140 KB. src/client/assets/audio/ambience-alley.mp3",
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

// ═══════════════════════════════════════════════════════════════════════════════
// PixelLab pixel-art layer — "Best Use of Phaser" visual payoff (PLAN Part 4)
// ───────────────────────────────────────────────────────────────────────────────
// Freshly-generated 1920s noir art lives under src/client/assets/{sprites,tilesets}.
// This block is INDEPENDENT of the placeholder `manifest`/`loadAssets` above (those
// have pinned unit-test expectations) — it discovers ONLY files that exist on disk
// via Vite's `import.meta.glob`, so a missing slug/zone is simply absent from the map
// (graceful guard, never a build break). world.ts queues these into Phaser and
// degrades to the Graphics fallback for whatever's missing.
//
// COSMETIC-FX GUARD: sprite/tileset selection is deterministic (stable index over a
// named slug list) and purely decorative — never read by game logic (PLAN 4.2).

// Vite's build plugin statically rewrites `import.meta.glob(...)` calls that take
// LITERAL arguments — the member access `import.meta.glob` MUST appear verbatim at
// the call site (a cast-to-variable or a function-wrapped pattern is NOT analysed).
// So we declare the signature on ImportMeta via module augmentation (we don't pull
// `vite/client` into the single tsconfig) and call it directly. Eager + `?url`
// yields a `{ [path]: url }` map of present files ONLY; absent paths never appear —
// exactly the graceful-missing guard. Under vitest (no Vite transform) `glob` is
// absent, so each call is guarded and short-circuits to an empty map (loaders no-op).
type GlobUrlMap = Record<string, string>;
type GlobModMap = Record<string, { default?: unknown }>;

declare global {
  interface ImportMeta {
    readonly glob?: {
      (p: string, o: { eager: true; import: "default" }): GlobUrlMap;
      (p: string, o: { eager: true }): GlobModMap;
    };
  }
}

// Eagerly bundle every sprite-direction PNG and tileset PNG/JSON that EXISTS. The
// literal patterns below are what Vite analyses at build time; missing files are
// simply not in the resulting maps. For an image module the `default` export IS the
// build-emitted, content-hashed URL — so `{ eager, import:"default" }` (NOT a `?url`
// query, which Rollup may tree-shake when the map is only read dynamically) gives a
// `{ relativePath: url }` map that reliably emits every matched asset.
const SPRITE_URLS: GlobUrlMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/sprites/*/*.png", { eager: true, import: "default" })
  : {};
const TILESET_PNG_URLS: GlobUrlMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/tilesets/*.png", { eager: true, import: "default" })
  : {};
// JSON Wang-metadata: import the parsed object directly (not a URL) so world.ts can
// build the corner atlas synchronously without a fetch.
const TILESET_JSON: GlobModMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/tilesets/*.json", { eager: true })
  : {};
// OVERWORLD side-scroll sprite set — a SECOND set per character, SEPARATE from the
// 8-direction DIALOGUE sprites above (a sibling dir, so the 2-segment `sprites/*/*`
// glob never mis-ingests these 3-segment paths). One right-facing frame per movement
// state; the scene flips X for left. Absent files leave the dialogue/portrait fallback.
const OVERWORLD_URLS: GlobUrlMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/overworld/*/*.png", { eager: true, import: "default" })
  : {};
// MAP art (PixelLab): a sidescroller TILESET per zone (the ground/platform skin) +
// side-view PROP images. The tilemap layout + collision live in zoneMaps.ts/mapToLevel.ts;
// these only skin the solid cells / decorate the rooms. Absent files → the placeholder
// colored-block render (PR B) stays. Tilesets: maps/<zone>/tileset.png; props: maps/props/<id>.png.
const MAP_TILESET_URLS: GlobUrlMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/maps/*/tileset.png", { eager: true, import: "default" })
  : {};
const MAP_PROP_URLS: GlobUrlMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/maps/props/*.png", { eager: true, import: "default" })
  : {};
// Each map tileset ships a Wang-corner metadata JSON (PixelLab) parsed by wang.ts to
// pick fill/edge tiles. Imported as the parsed object (not a URL) so the scene autotiles
// synchronously — same idiom as the legacy top-down TILESET_JSON above.
const MAP_TILESET_META: GlobModMap = typeof document !== "undefined"
  ? import.meta.glob!("../assets/maps/*/tileset.json", { eager: true })
  : {};

/** The 8 PixelLab facing directions authored per character (canvas 68×68). */
export type SpriteDir =
  | "south"
  | "east"
  | "north"
  | "west"
  | "south-east"
  | "north-east"
  | "north-west"
  | "south-west";

export const SPRITE_DIRS: readonly SpriteDir[] = [
  "south",
  "east",
  "north",
  "west",
  "south-east",
  "north-east",
  "north-west",
  "south-west",
];

/**
 * The full character slug roster (PixelLab). `detective` is the PLAYER avatar; the
 * other 11 are the NPC pool. Order is STABLE — world.ts assigns NPC sprites by a
 * deterministic index over `NPC_SPRITE_SLUGS`, so a given NPC shows the same sprite
 * every run. Slugs whose art is absent are filtered out by `availableSpriteSlugs()`.
 */
export const PLAYER_SPRITE_SLUG = "detective" as const;
export const NPC_SPRITE_SLUGS: readonly string[] = [
  "lola-marsh",
  "don-vittorio",
  "frankie-conti",
  "sil-greco",
  "roy-halloran",
  "augie-doyle",
  "nell-carraway",
  "old-cobb",
  "birdie",
  "harlan",
  "mr-ash",
];

/** Zone tileset slugs (PixelLab Wang tilesets), assigned to zones by zone index. */
export const TILESET_SLUGS: readonly string[] = ["bar", "alley", "lot"];

/** Phaser texture key for one character-direction frame. Stable & collision-free. */
export function spriteFrameKey(slug: string, dir: SpriteDir): string {
  return `spr:${slug}:${dir}`;
}

/** Phaser texture key for a PixelLab Wang tileset image. */
export function wangTilesetKey(slug: string): string {
  return `wang:${slug}`;
}

/** Resolve the bundled URL for one sprite frame, or undefined if its file is absent.
 *  Glob keys are the import specifier paths; we match on the `/<slug>/<dir>.png` tail. */
export function spriteFrameUrl(slug: string, dir: SpriteDir): string | undefined {
  const tail = `/sprites/${slug}/${dir}.png`;
  for (const [path, url] of Object.entries(SPRITE_URLS)) {
    if (path.endsWith(tail)) return url;
  }
  return undefined;
}

/** True iff at least the south (idle) frame of a slug is bundled. */
export function spriteSlugPresent(slug: string): boolean {
  return spriteFrameUrl(slug, "south") !== undefined;
}

/** The NPC-pool slugs whose art actually shipped, in stable order (guard-filtered). */
export function availableNpcSpriteSlugs(): string[] {
  return NPC_SPRITE_SLUGS.filter(spriteSlugPresent);
}

// ── Overworld (side-scroll) sprite set ──
/** The movement states a character's overworld sprite renders (one frame each). */
export type OverworldClip = "idle" | "run" | "jump";
export const OVERWORLD_CLIPS: readonly OverworldClip[] = ["idle", "run", "jump"];

/** Phaser texture key for one overworld movement-state frame. Distinct from `spr:` keys. */
export function overworldFrameKey(slug: string, clip: OverworldClip): string {
  return `ow:${slug}:${clip}`;
}

/** Resolve the bundled URL for an overworld frame, or undefined if its file is absent. */
export function overworldFrameUrl(slug: string, clip: OverworldClip): string | undefined {
  const tail = `/overworld/${slug}/${clip}.png`;
  for (const [path, url] of Object.entries(OVERWORLD_URLS)) {
    if (path.endsWith(tail)) return url;
  }
  return undefined;
}

/** True iff at least the idle frame of a slug's overworld set is bundled. */
export function overworldSlugPresent(slug: string): boolean {
  return overworldFrameUrl(slug, "idle") !== undefined;
}

/** Every character (player + NPC pool) whose overworld art shipped, in stable order. */
export function availableOverworldSlugs(): string[] {
  return [PLAYER_SPRITE_SLUG, ...NPC_SPRITE_SLUGS].filter(overworldSlugPresent);
}

// ── Map art (per-zone sidescroller tileset + side-view props) ──
/** Phaser texture key for a zone's sidescroller tileset sheet. */
export function mapTilesetKey(zoneId: string): string {
  return `maptiles:${zoneId}`;
}
/** Resolve the bundled URL for a zone's map tileset, or undefined if its file is absent. */
export function mapTilesetUrl(zoneId: string): string | undefined {
  const tail = `/maps/${zoneId}/tileset.png`;
  for (const [path, url] of Object.entries(MAP_TILESET_URLS)) {
    if (path.endsWith(tail)) return url;
  }
  return undefined;
}
/** True iff a zone's map tileset shipped. */
export function mapTilesetPresent(zoneId: string): boolean {
  return mapTilesetUrl(zoneId) !== undefined;
}
/** Resolve the parsed Wang metadata for a zone's map tileset, or undefined if absent. */
export function mapTilesetMeta(zoneId: string): unknown {
  const tail = `/maps/${zoneId}/tileset.json`;
  for (const [path, mod] of Object.entries(MAP_TILESET_META)) {
    if (path.endsWith(tail)) {
      const m = mod as { default?: unknown };
      return m.default ?? mod;
    }
  }
  return undefined;
}

/** Phaser texture key for a side-view map prop image. */
export function mapPropKey(propId: string): string {
  return `mapprop:${propId}`;
}
/** Resolve the bundled URL for a map prop, or undefined if its file is absent. */
export function mapPropUrl(propId: string): string | undefined {
  const tail = `/maps/props/${propId}.png`;
  for (const [path, url] of Object.entries(MAP_PROP_URLS)) {
    if (path.endsWith(tail)) return url;
  }
  return undefined;
}

/** Resolve the bundled URL for a Wang tileset PNG, or undefined if absent. */
export function wangTilesetUrl(slug: string): string | undefined {
  const tail = `/tilesets/${slug}.png`;
  for (const [path, url] of Object.entries(TILESET_PNG_URLS)) {
    if (path.endsWith(tail)) return url;
  }
  return undefined;
}

/** Resolve the parsed Wang metadata JSON for a tileset slug, or undefined if absent. */
export function wangTilesetMeta(slug: string): unknown {
  const tail = `/tilesets/${slug}.json`;
  for (const [path, mod] of Object.entries(TILESET_JSON)) {
    if (path.endsWith(tail)) {
      // Vite's eager JSON glob wraps the parsed object under `default` (and spreads
      // named keys); prefer `.default`, fall back to the module object itself.
      const m = mod as { default?: unknown };
      return m.default ?? mod;
    }
  }
  return undefined;
}

/** The tileset slugs whose PNG actually shipped, in stable order (guard-filtered). */
export function availableTilesetSlugs(): string[] {
  return TILESET_SLUGS.filter((s) => wangTilesetUrl(s) !== undefined);
}

/**
 * Deterministically assign a tileset slug to a zone by its INDEX in the map's zone
 * list (stable across a run; never RNG). Returns undefined if no tileset art shipped,
 * so the caller keeps the programmatic noir floor. Cosmetic only.
 */
export function tilesetSlugForZoneIndex(zoneIndex: number): string | undefined {
  const avail = availableTilesetSlugs();
  if (avail.length === 0) return undefined;
  const i = ((zoneIndex % avail.length) + avail.length) % avail.length;
  return avail[i];
}

/**
 * Deterministically assign an NPC-pool sprite slug to an NPC by a STABLE index
 * (typically a hash of npcId, computed by the caller with the project PRNG, OR the
 * npc's array position). Reserves `detective` for the player. Returns undefined if no
 * NPC sprite art shipped, so the caller keeps the amber-circle fallback. Cosmetic.
 */
export function npcSpriteSlugForIndex(index: number): string | undefined {
  const avail = availableNpcSpriteSlugs();
  if (avail.length === 0) return undefined;
  const i = ((index % avail.length) + avail.length) % avail.length;
  return avail[i];
}

/** Counts of PixelLab art actually bundled — for a debug overlay / preflight only.
 *  Pure; never read by game logic. */
export function pixelArtReport(): { spriteSlugs: number; tilesets: number; player: boolean } {
  return {
    spriteSlugs: availableNpcSpriteSlugs().length,
    tilesets: availableTilesetSlugs().length,
    player: spriteSlugPresent(PLAYER_SPRITE_SLUG),
  };
}
