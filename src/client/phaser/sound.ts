/**
 * src/client/phaser/sound.ts — the thin, Phaser-free SOUND layer (Part 4).
 *
 * Wires the dormant audio pipeline: a guarded one-shot SFX player + a single
 * looping per-zone ambience bed. Pulled OUT of fx.ts so it imports NO Phaser and is
 * trivially unit-testable (fx.ts can't be imported under the node test env — Phaser
 * touches `window` at module load). The scene/sound manager are duck-typed `unknown`
 * exactly so a NoAudioSoundManager, an unlocked HTML5 manager, or a plain test stub
 * all degrade to a SILENT no-op instead of throwing.
 *
 * COSMETIC-FX GUARD (Part 4.2): no sound key, result, or play state is EVER read by
 * game logic. This is a render-only beat that mirrors a deterministic, server-
 * authoritative or deterministic signal (a tell, a caught lie, a string snap, a
 * step, a zone). Logical state stays integer/tick-based and server-authoritative.
 *
 * Every call is a no-op when: audio is unavailable, the clip never loaded (the
 * manifest slot has no `src` yet → assets.ts skipped it), the manager is muted, the
 * manager is the NoAudio stub (no `play`), or `quality` is "low" (ambient/heavy use).
 */
import { ambienceKey, sfxKey, type SfxName } from "./assets.js";

export type SoundQuality = "high" | "low";

// ── Duck-typed surfaces (no Phaser import) ──────────────────────────────────
/** The bits of Phaser's BaseSoundManager we touch — all optional. */
export interface SoundManagerLike {
  play?: (key: string, extra?: { volume?: number; loop?: boolean }) => boolean;
  add?: (key: string, cfg?: { volume?: number; loop?: boolean }) => BaseSoundLike;
  mute?: boolean;
}
/** A single looping BaseSound handle. */
export interface BaseSoundLike {
  play?: (markerOrCfg?: unknown, cfg?: unknown) => boolean;
  stop?: () => boolean;
  destroy?: () => void;
  isPlaying?: boolean;
}
/** The bits of a Phaser.Scene we touch for audio. */
export interface AudioSceneLike {
  cache?: { audio?: { exists(key: string): boolean } };
  sound?: SoundManagerLike;
}

/** True iff `scene` carries a loaded audio clip under `key`. */
function hasClip(scene: AudioSceneLike, key: string): boolean {
  try {
    return !!scene.cache?.audio?.exists(key);
  } catch {
    return false;
  }
}

/** The scene's sound manager, only if it can actually emit (not the NoAudio stub). */
function audibleManager(scene: AudioSceneLike): SoundManagerLike | null {
  try {
    const mgr = scene.sound;
    if (!mgr || typeof mgr.play !== "function") return null;
    return mgr;
  } catch {
    return null;
  }
}

/**
 * The reusable sound layer. One instance is owned by each Fx (fx.ts). Holds the
 * single looping ambience bed per scene so it can swap cleanly on a zone change and
 * stop on teardown / a quality drop.
 */
export class SoundLayer {
  private quality: SoundQuality = "high";
  private readonly ambience = new WeakMap<object, { zoneId: string; sound: BaseSoundLike }>();

  setQuality(q: SoundQuality): void {
    this.quality = q;
  }

  /** Fire a one-shot SFX by stable name. Silent no-op per the guards above. */
  playSfx(scene: AudioSceneLike | null | undefined, name: SfxName): void {
    if (!scene) return;
    const key = sfxKey(name);
    if (!hasClip(scene, key)) return;
    const mgr = audibleManager(scene);
    if (!mgr || mgr.mute) return;
    try {
      // Quieter on low quality so a weak device still gets the beat without the wash.
      mgr.play?.(key, { volume: this.quality === "low" ? 0.5 : 0.85 });
    } catch {
      /* sound manager refused (locked/unsupported) — silent no-op */
    }
  }

  /** Start (or keep) the single looping per-zone ambience bed. */
  playAmbience(scene: AudioSceneLike | null | undefined, zoneId: string): void {
    if (this.quality === "low" || !scene) return;
    const key = ambienceKey(zoneId);
    if (!hasClip(scene, key)) return; // ambience clip not authored yet → stay silent
    const mgr = audibleManager(scene);
    if (!mgr || mgr.mute || typeof mgr.add !== "function") return;
    const current = this.ambience.get(scene as object);
    if (current && current.zoneId === zoneId && current.sound.isPlaying) return; // already running
    this.stopAmbience(scene);
    try {
      const sound = mgr.add(key, { loop: true, volume: 0.4 });
      sound.play?.();
      this.ambience.set(scene as object, { zoneId, sound });
    } catch {
      /* couldn't create the looping sound — silent no-op */
    }
  }

  /** Stop any looping ambience on a scene (teardown / quality drop). Idempotent. */
  stopAmbience(scene: AudioSceneLike | null | undefined): void {
    if (!scene) return;
    const current = this.ambience.get(scene as object);
    if (!current) return;
    try {
      current.sound.stop?.();
      current.sound.destroy?.();
    } catch {
      /* no-op */
    }
    this.ambience.delete(scene as object);
  }
}
