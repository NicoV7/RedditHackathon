/**
 * Pure-logic tests for the Phaser-free SOUND layer (src/client/phaser/sound.ts).
 *
 * Like assets.test.ts these use STUB scenes (plain objects) and never touch a real
 * DOM/WebGL/audio context — the layer is duck-typed exactly so this is unit-testable
 * WITHOUT importing Phaser (which touches `window` at load under the node test env).
 *
 * We assert the HARD guards (Part 4.2 — sound is render-only, never read by logic):
 * a one-shot SFX plays ONLY when the clip loaded AND the manager can emit AND it
 * isn't muted; the looping ambience starts once, won't restart the same zone, swaps
 * cleanly on a zone change, stops cleanly, and is suppressed on "low" quality; and
 * everything is a silent no-op when audio is absent.
 */
import { describe, it, expect, vi } from "vitest";
import { SoundLayer } from "./sound.js";
import { sfxKey, ambienceKey } from "./assets.js";

/** A duck-typed Scene stub with a recording sound manager + audio cache. */
function makeAudioScene(opts?: {
  loadedClips?: string[];
  mute?: boolean;
  noAudioManager?: boolean; // simulate a NoAudioSoundManager (no play method)
  noManager?: boolean; // simulate scene.sound entirely absent
}) {
  const loaded = new Set(opts?.loadedClips ?? []);
  const play = vi.fn((_key: string, _extra?: unknown) => true);
  const made: Array<{
    key: string;
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    isPlaying: boolean;
  }> = [];
  const add = vi.fn((key: string, _cfg?: unknown) => {
    const snd = {
      key,
      isPlaying: false,
      play: vi.fn(function (this: { isPlaying: boolean }) {
        this.isPlaying = true;
        return true;
      }),
      stop: vi.fn(function (this: { isPlaying: boolean }) {
        this.isPlaying = false;
        return true;
      }),
      destroy: vi.fn(),
    };
    made.push(snd as never);
    return snd;
  });

  const sound = opts?.noManager
    ? undefined
    : opts?.noAudioManager
      ? { mute: false } // present but no `play` → not audible
      : { play, add, mute: opts?.mute ?? false };

  const scene = {
    cache: { audio: { exists: (k: string) => loaded.has(k) } },
    sound,
  };
  return { scene, play, add, made };
}

describe("SoundLayer.playSfx (one-shot)", () => {
  it("plays a loaded clip through the manager", () => {
    const layer = new SoundLayer();
    const { scene, play } = makeAudioScene({ loadedClips: [sfxKey("gotcha")] });
    layer.playSfx(scene, "gotcha");
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(sfxKey("gotcha"), expect.objectContaining({ volume: expect.any(Number) }));
  });

  it("is a silent no-op when the clip never loaded (absent src)", () => {
    const layer = new SoundLayer();
    const { scene, play } = makeAudioScene({ loadedClips: [] });
    layer.playSfx(scene, "lieSting");
    expect(play).not.toHaveBeenCalled();
  });

  it("is a silent no-op when the manager is muted", () => {
    const layer = new SoundLayer();
    const { scene, play } = makeAudioScene({ loadedClips: [sfxKey("accuse")], mute: true });
    layer.playSfx(scene, "accuse");
    expect(play).not.toHaveBeenCalled();
  });

  it("is a silent no-op for a NoAudio-style manager (no play method)", () => {
    const layer = new SoundLayer();
    const { scene } = makeAudioScene({ loadedClips: [sfxKey("footstep")], noAudioManager: true });
    expect(() => layer.playSfx(scene, "footstep")).not.toThrow();
  });

  it("is a silent no-op when there is no sound manager at all", () => {
    const layer = new SoundLayer();
    const { scene } = makeAudioScene({ loadedClips: [sfxKey("footstep")], noManager: true });
    expect(() => layer.playSfx(scene, "footstep")).not.toThrow();
  });

  it("is a silent no-op for a null/undefined scene", () => {
    const layer = new SoundLayer();
    expect(() => layer.playSfx(null, "gotcha")).not.toThrow();
    expect(() => layer.playSfx(undefined, "gotcha")).not.toThrow();
  });

  it("plays a quieter beat on low quality but still emits", () => {
    const layer = new SoundLayer();
    const { scene, play } = makeAudioScene({ loadedClips: [sfxKey("accuse")] });
    layer.setQuality("low");
    layer.playSfx(scene, "accuse");
    // SFX is a beat, not a heavy effect → still plays (quieter), unlike ambience.
    expect(play).toHaveBeenCalledTimes(1);
    const cfg = play.mock.calls[0]![1] as { volume: number };
    expect(cfg.volume).toBeLessThan(0.85);
  });
});

describe("SoundLayer.playAmbience (looping bed)", () => {
  it("starts one looping bed for a loaded zone clip", () => {
    const layer = new SoundLayer();
    const { scene, add, made } = makeAudioScene({ loadedClips: [ambienceKey("parlor")] });
    layer.playAmbience(scene, "parlor");
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(ambienceKey("parlor"), expect.objectContaining({ loop: true }));
    expect(made[0]!.play).toHaveBeenCalled();
    expect(made[0]!.isPlaying).toBe(true);
  });

  it("does not restart the same zone's bed if already playing", () => {
    const layer = new SoundLayer();
    const { scene, add } = makeAudioScene({ loadedClips: [ambienceKey("parlor")] });
    layer.playAmbience(scene, "parlor");
    layer.playAmbience(scene, "parlor");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("swaps cleanly to a new zone's bed (stops the old, starts the new)", () => {
    const layer = new SoundLayer();
    const { scene, add, made } = makeAudioScene({
      loadedClips: [ambienceKey("parlor"), ambienceKey("cellar")],
    });
    layer.playAmbience(scene, "parlor");
    layer.playAmbience(scene, "cellar");
    expect(add).toHaveBeenCalledTimes(2);
    expect(made[0]!.stop).toHaveBeenCalled();
    expect(made[0]!.destroy).toHaveBeenCalled();
    expect(made[1]!.isPlaying).toBe(true);
  });

  it("is a silent no-op when the zone ambience clip is absent", () => {
    const layer = new SoundLayer();
    const { scene, add } = makeAudioScene({ loadedClips: [] });
    layer.playAmbience(scene, "garden");
    expect(add).not.toHaveBeenCalled();
  });

  it("is a silent no-op on low quality", () => {
    const layer = new SoundLayer();
    const { scene, add } = makeAudioScene({ loadedClips: [ambienceKey("parlor")] });
    layer.setQuality("low");
    layer.playAmbience(scene, "parlor");
    expect(add).not.toHaveBeenCalled();
  });

  it("stopAmbience halts and forgets the bed (idempotent)", () => {
    const layer = new SoundLayer();
    const { scene, made } = makeAudioScene({ loadedClips: [ambienceKey("parlor")] });
    layer.playAmbience(scene, "parlor");
    layer.stopAmbience(scene);
    expect(made[0]!.stop).toHaveBeenCalled();
    expect(made[0]!.destroy).toHaveBeenCalled();
    expect(() => layer.stopAmbience(scene)).not.toThrow();
  });

  it("setQuality('low') is a no-op for STARTING ambience but lets stop work", () => {
    const layer = new SoundLayer();
    const { scene, add, made } = makeAudioScene({ loadedClips: [ambienceKey("parlor")] });
    layer.playAmbience(scene, "parlor"); // starts on default high quality
    expect(made[0]!.isPlaying).toBe(true);
    layer.setQuality("low");
    layer.stopAmbience(scene); // the caller (fx.setQuality) drives this on a drop
    expect(made[0]!.stop).toHaveBeenCalled();
    // A subsequent low-quality start does nothing.
    layer.playAmbience(scene, "parlor");
    expect(add).toHaveBeenCalledTimes(1);
  });
});
