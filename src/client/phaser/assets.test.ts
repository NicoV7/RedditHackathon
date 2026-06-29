/**
 * Pure-logic tests for the asset pipeline (src/client/phaser/assets.ts).
 *
 * These intentionally use a STUB scene (a plain object) and never touch a real
 * DOM/WebGL canvas or Phaser — the manifest + loader are written `unknown`-typed
 * and duck-typed exactly so they're unit-testable. We assert: the manifest covers
 * every generator zone, keys are stable/unique, the loader is a safe no-op when art
 * is absent, it skips already-loaded assets, and it queues whatever DOES exist.
 */
import { describe, it, expect, vi } from "vitest";
import {
  manifest,
  loadAssets,
  loadZoneAssets,
  zoneBundle,
  tilesetKey,
  ambienceKey,
  zoneNormalKey,
  sfxKey,
  allAssetKeys,
  AVATAR_KEY,
  type SfxName,
  OVERWORLD_CLIPS,
  overworldFrameKey,
  overworldFrameUrl,
  overworldSlugPresent,
  availableOverworldSlugs,
  mapTilesetKey,
  mapTilesetUrl,
  mapTilesetPresent,
  mapTilesetMeta,
  mapPropKey,
  mapPropUrl,
} from "./assets.js";

// Zone ids must mirror src/server/case/procedural.ts ZONE_DEFS.
const GENERATOR_ZONES = ["bar", "lot", "backbar", "alley"] as const;
const SFX_NAMES: SfxName[] = ["footstep", "lieSting", "stringSnap", "gotcha", "accuse", "doorOpen"];

/** A loader stub that records every queue call and reports nothing pre-loaded. */
function makeScene(opts?: { hasAudioMethod?: boolean; existingTextures?: string[]; existingAudio?: string[] }) {
  const existingTex = new Set(opts?.existingTextures ?? []);
  const existingAud = new Set(opts?.existingAudio ?? []);
  const image = vi.fn((key: string, _url: string) => existingTex.add(key));
  const spritesheet = vi.fn((key: string, _url: string, _cfg: unknown) => existingTex.add(key));
  const audio = opts?.hasAudioMethod === false ? undefined : vi.fn((key: string, _url: string | string[]) => existingAud.add(key));
  return {
    scene: {
      load: { image, spritesheet, audio },
      textures: { exists: (k: string) => existingTex.has(k) },
      cache: { audio: { exists: (k: string) => existingAud.has(k) } },
    },
    image,
    spritesheet,
    audio,
  };
}

describe("asset manifest", () => {
  it("covers every generator zone with a tileset", () => {
    for (const z of GENERATOR_ZONES) {
      expect(manifest.zones[z]).toBeDefined();
      expect(manifest.zones[z]!.tileset.key).toBe(tilesetKey(z));
    }
  });

  it("falls back to the default bundle for an unmapped zone", () => {
    expect(zoneBundle("does-not-exist")).toBe(manifest.defaultZone);
    expect(zoneBundle("bar")).toBe(manifest.zones.bar);
  });

  it("defines all six stable SFX keys", () => {
    for (const name of SFX_NAMES) {
      expect(manifest.sfx[name]).toBeDefined();
      expect(manifest.sfx[name].key).toBe(sfxKey(name));
    }
  });

  it("derives stable, distinct keys per helper", () => {
    expect(tilesetKey("bar")).toBe("tileset:bar");
    expect(ambienceKey("bar")).toBe("ambience:bar");
    expect(zoneNormalKey("bar")).toBe("normal:bar");
    expect(tilesetKey("bar")).not.toBe(ambienceKey("bar"));
  });

  it("emits a fully unique key set", () => {
    const keys = allAssetKeys();
    expect(new Set(keys).size).toBe(keys.length);
    // sanity: globals + per-zone keys are all present
    expect(keys).toContain(AVATAR_KEY);
    expect(keys).toContain(tilesetKey("alley"));
    expect(keys).toContain(sfxKey("lieSting"));
  });

  it("ships the two placeholder images that actually exist on disk", () => {
    // These are the only `src`-present images today (loader must be exercised).
    expect(manifest.lightCookie.src).toBeTruthy();
    expect(manifest.zones.bar!.tileset.src).toBeTruthy();
  });

  it("documents every not-yet-authored slot with a note", () => {
    // Avatar/NPC/audio have no src yet but MUST carry a build instruction.
    expect(manifest.avatar.src).toBeUndefined();
    expect(manifest.avatar.note.length).toBeGreaterThan(10);
    expect(manifest.music.src).toBeUndefined();
    expect(manifest.music.note.length).toBeGreaterThan(10);
    for (const name of SFX_NAMES) {
      expect(manifest.sfx[name].note.length).toBeGreaterThan(10);
    }
  });
});

describe("overworld sprite set (side-scroll)", () => {
  it("defines the three movement-state clips", () => {
    expect([...OVERWORLD_CLIPS]).toEqual(["idle", "run", "jump"]);
  });

  it("derives stable keys distinct from the dialogue `spr:` keys", () => {
    expect(overworldFrameKey("detective", "run")).toBe("ow:detective:run");
    expect(overworldFrameKey("lola-marsh", "idle")).toBe("ow:lola-marsh:idle");
    expect(overworldFrameKey("detective", "idle")).not.toBe(overworldFrameKey("detective", "run"));
  });

  it("resolves to undefined / absent when no overworld art is bundled (test env)", () => {
    // import.meta.glob is unavailable under vitest → the URL map is empty.
    expect(overworldFrameUrl("detective", "idle")).toBeUndefined();
    expect(overworldSlugPresent("detective")).toBe(false);
    expect(availableOverworldSlugs()).toEqual([]);
  });
});

describe("map art (per-zone tileset + props)", () => {
  it("derives stable, distinct keys for tilesets and props", () => {
    expect(mapTilesetKey("bar")).toBe("maptiles:bar");
    expect(mapPropKey("piano")).toBe("mapprop:piano");
    expect(mapTilesetKey("bar")).not.toBe(mapPropKey("bar"));
  });

  it("resolves to undefined / absent when no map art is bundled (test env)", () => {
    expect(mapTilesetUrl("bar")).toBeUndefined();
    expect(mapTilesetPresent("bar")).toBe(false);
    expect(mapTilesetMeta("bar")).toBeUndefined();
    expect(mapPropUrl("piano")).toBeUndefined();
  });
});

describe("loadAssets", () => {
  it("is a safe no-op for a null/undefined scene", () => {
    expect(loadAssets(null)).toEqual({ images: 0, spritesheets: 0, audio: 0, skipped: 0 });
    expect(loadAssets(undefined)).toEqual({ images: 0, spritesheets: 0, audio: 0, skipped: 0 });
  });

  it("queues only assets whose src exists, and skips authored-but-absent slots", () => {
    const { scene, image, spritesheet, audio } = makeScene();
    const report = loadAssets(scene);

    // The real placeholder images load eagerly: the 4 mapped zone tilesets +
    // the light cookie = 5. The default-zone bundle is a fallback for unmapped
    // ids (zoneBundle/loadZoneAssets), so it is NOT eager-preloaded here.
    expect(report.images).toBe(5);
    // No avatar/NPC sheet art exists yet → spritesheet never queued.
    expect(report.spritesheets).toBe(0);
    expect(spritesheet).not.toHaveBeenCalled();
    // No audio files exist yet → audio never queued, but each is counted skipped.
    expect(report.audio).toBe(0);
    expect(audio).not.toHaveBeenCalled();
    expect(report.skipped).toBeGreaterThan(0);

    // The light cookie was queued under its stable key.
    expect(image).toHaveBeenCalledWith(manifest.lightCookie.key, expect.any(String));
  });

  it("does not re-queue assets already present in the texture cache", () => {
    const { scene, image } = makeScene({ existingTextures: [tilesetKey("bar")] });
    loadAssets(scene);
    // bar tileset already cached → not re-queued; others still queue.
    const calledKeys = image.mock.calls.map((c) => c[0]);
    expect(calledKeys).not.toContain(tilesetKey("bar"));
    expect(calledKeys).toContain(tilesetKey("lot"));
  });

  it("can defer zone art via { zones:false } (lazy per-zone loading)", () => {
    const { scene, image } = makeScene();
    const report = loadAssets(scene, { zones: false });
    const calledKeys = image.mock.calls.map((c) => c[0]);
    // Globals (light cookie) still load; zone tilesets are deferred.
    expect(calledKeys).toContain(manifest.lightCookie.key);
    expect(calledKeys).not.toContain(tilesetKey("bar"));
    // Only the light cookie image is present today among globals.
    expect(report.images).toBe(1);
  });

  it("degrades to a no-op when the loader has no audio method (counts as skipped)", () => {
    const { scene } = makeScene({ hasAudioMethod: false });
    const report = loadAssets(scene);
    expect(report.audio).toBe(0);
    // Images still load even though audio is unavailable (4 tilesets + cookie).
    expect(report.images).toBe(5);
  });
});

describe("loadZoneAssets", () => {
  it("queues just one zone's tileset and is total for unmapped ids", () => {
    const a = makeScene();
    const r1 = loadZoneAssets(a.scene, "lot");
    expect(r1.images).toBe(1); // lot tileset (placeholder src present)
    expect(a.image).toHaveBeenCalledWith(tilesetKey("lot"), expect.any(String));

    const b = makeScene();
    const r2 = loadZoneAssets(b.scene, "nope-unmapped");
    // Falls back to default-zone tileset (still a real placeholder src).
    expect(r2.images).toBe(1);
    expect(b.image).toHaveBeenCalledWith(manifest.defaultZone.tileset.key, expect.any(String));
  });

  it("is a safe no-op for a null scene", () => {
    expect(loadZoneAssets(null, "bar")).toEqual({ images: 0, spritesheets: 0, audio: 0, skipped: 0 });
  });
});
