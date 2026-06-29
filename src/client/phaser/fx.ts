/**
 * src/client/phaser/fx.ts — the cosmetic Phaser FX surface (Part 4, "Best Use of Phaser").
 *
 * FROZEN in Wave A so the world job (J4, implements) and the portrait/board job (J5,
 * consumes) build against one shared surface and can't collide. This file now also
 * SHIPS the concrete `createFx()` implementation (Part 4.3).
 *
 * HARD INVARIANT (Part 4.2): every function here renders a DETERMINISTIC,
 * SERVER-AUTHORITATIVE signal (a `statedLie` tell, a reachable item, a caught
 * contradiction). None of it is EVER read back by game logic — logical state stays
 * integer/tick-based. Targets are typed `unknown` on purpose to keep this surface
 * Phaser-version-agnostic; the implementation casts to the concrete Phaser types it
 * needs AND feature-detects every API so the build degrades gracefully (Part 4.4):
 * if an API or asset is missing the call is a silent no-op, never a throw.
 *
 * Phaser 4 notes (verified against node_modules/phaser/types/phaser.d.ts @ 4.2.0):
 *  - GameObject filters: `obj.enableFilters()` then `obj.filters.internal.addGlow(...)`
 *    / `.addGradientMap(...)` / `.addColorMatrix()`; `obj.filters.internal.clear()`.
 *    (Phaser 3's `setPostPipeline` / preFX/postFX are gone.)
 *  - Dynamic lighting: `scene.lights.enable()`, `.setAmbientColor(rgb)`,
 *    `.addLight(x,y,radius,rgb,intensity,z)`; `light.setRadius/.setIntensity/...`.
 *    Objects opt in with `obj.setLighting(true)`.
 *  - Camera FX live on `camera`: `.shake()`, `.zoomTo()`, `.flash()`, `.fade()`, `.pan()`.
 *  - Particles: `scene.add.particles(x,y,textureKey,config)` — needs a texture, so we
 *    bake tiny procedural textures via Graphics.generateTexture (no asset dependency).
 */
import Phaser from "phaser";
import type { FacultyId } from "../../shared/api.js";
import { type SfxName } from "./assets.js";
import { SoundLayer, type AudioSceneLike } from "./sound.js";

export type FxQuality = "high" | "low";
export type ParticleKind = "smoke" | "rain" | "dust" | "puff";

export interface ParlorFx {
  /** Pillar 1 — stack the lie-tell filter (glow + quantize + crimson shimmer + edge-pulse). */
  applyTellFilter(target: unknown, faculty: FacultyId, intensity: number): void;
  clearTellFilter(target: unknown): void;
  /** Pillar 2 — per-zone gaslight/moonlight + self-shadows. */
  setZoneLighting(scene: unknown, zoneId: string, mood?: string): void;
  /** Pillar 2 — the Perception light radius that surfaces items in dark zones. */
  playerLight(scene: unknown, x: number, y: number, radius: number): void;
  /** Pillar 4 — camera shake on a caught lie ("gotcha"). Plays the gotcha SFX. */
  cameraGotcha(scene: unknown): void;
  /** Pillar 4 — zoom-punch into the portrait on the accusation. Plays the accuse SFX. */
  cameraAccuse(scene: unknown, x: number, y: number): void;
  /** Pillar 4 — red-string "snap taut" glow burst on the board. */
  snapString(target: unknown): void;
  /** Pillar 4 — atmosphere/feedback particles. */
  emit(scene: unknown, kind: ParticleKind, x: number, y: number): void;
  /**
   * SOUND (Part 4) — fire a one-shot SFX by stable name. A silent no-op when audio
   * is unavailable, the clip never loaded (no `src` in the manifest yet), the sound
   * manager is the NoAudio stub, or quality is "low". COSMETIC: never read by logic.
   */
  playSfx(scene: unknown, name: SfxName): void;
  /**
   * SOUND — start (or keep) a single looping per-zone ambience bed. Swaps cleanly when
   * the zone changes; no-op when the clip is absent / audio is muted / quality is low.
   */
  playAmbience(scene: unknown, zoneId: string): void;
  /** SOUND — stop any looping ambience on a scene (teardown / quality drop). */
  stopAmbience(scene: unknown): void;
  /** Perf — toggle filter/light/particle/sound density; "low" is the weak-device fallback. */
  setQuality(q: FxQuality): void;
}

// ── Palette (mirrors world.ts / board.ts / theme) ──
const COL_CRIMSON = 0xd4_32_2a; // the franchise tell-red — saturated only here
const COL_GASLIGHT = 0xe8_b8_6d; // amber gaslight point lights
const COL_AMBIENT_COLD = 0x26_30_3a; // cold noir ambient key
const COL_PUFF = 0xc9_d6_d8;

/** Faculty → tell accent. All cold/desaturated except the shared crimson pulse. */
const FACULTY_TINT: Record<FacultyId, number> = {
  logic: 0x7e_a8_b0,
  empathy: 0xd4_32_2a,
  drama: 0xc8_8a_3a,
  perception: 0x9a_8a_b0,
  authority: 0xb0_5a_3a,
  encyclopedia: 0x6f_8c_92,
};

/** Mood → ambient/gaslight intensity bias for per-zone lighting. */
const ZONE_MOOD: Record<string, { ambient: number; warm: boolean }> = {
  alley: { ambient: 0x14_18_22, warm: false },
  outside: { ambient: 0x12_16_20, warm: false },
  kitchen: { ambient: 0x22_26_22, warm: true },
  bar: { ambient: 0x2a_24_1c, warm: true },
  vip: { ambient: 0x26_1e_22, warm: true },
  coatcheck: { ambient: 0x1e_22_28, warm: false },
};

// ── feature-detect helpers (everything degrades gracefully, Part 4.4) ──

function isScene(o: unknown): o is Phaser.Scene {
  return !!o && typeof (o as Phaser.Scene).add === "object" && typeof (o as Phaser.Scene).sys === "object";
}

/** A GameObject we might attach filters to. We only touch methods we feature-detect. */
interface FilterableObj {
  enableFilters?: () => unknown;
  filters?: { internal?: FilterListLike } | null;
  setTint?: (c: number) => unknown;
  clearTint?: () => unknown;
  setLighting?: (b: boolean) => unknown;
  scene?: Phaser.Scene;
  x?: number;
  y?: number;
}
interface FilterListLike {
  addGlow?: (...a: number[]) => unknown;
  addGradientMap?: (cfg?: Phaser.Types.Filters.GradientMapConfig) => unknown;
  addBarrel?: (amount?: number) => unknown;
  clear?: () => unknown;
  list?: Array<{ outerStrength?: number }>;
}

function asFilterable(o: unknown): FilterableObj | null {
  return o && typeof o === "object" ? (o as FilterableObj) : null;
}

/** Bake a tiny soft-dot texture once per scene so particles never need an asset. */
function ensureDotTexture(scene: Phaser.Scene, key: string, color: number): string {
  try {
    if (scene.textures && scene.textures.exists(key)) return key;
    const g = scene.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture(key, 8, 8);
    g.destroy();
    return key;
  } catch {
    return key;
  }
}

class Fx implements ParlorFx {
  private quality: FxQuality = "high";
  /** lights we created per-scene, so setQuality('low') can disable cleanly. */
  private readonly litScenes = new Set<Phaser.Scene>();
  /** active tell pulse tweens keyed by target, so clearTellFilter can stop them. */
  private readonly tellTweens = new WeakMap<object, Phaser.Tweens.Tween>();
  /** the Phaser-free SOUND layer (one-shot SFX + the single looping ambience bed). */
  private readonly soundLayer = new SoundLayer();

  setQuality(q: FxQuality): void {
    this.quality = q;
    this.soundLayer.setQuality(q);
    if (q === "low") {
      // Disable lighting on every scene we lit — the unlit path is the fallback.
      for (const scene of this.litScenes) {
        try {
          scene.lights?.disable?.();
        } catch {
          /* no-op */
        }
        // and silence the ambience bed (one-shot SFX are already gated on quality).
        this.soundLayer.stopAmbience(scene as unknown as AudioSceneLike);
      }
    } else {
      for (const scene of this.litScenes) {
        try {
          scene.lights?.enable?.();
        } catch {
          /* no-op */
        }
      }
    }
  }

  // ── Pillar 1: the lie-tell filter stack (the HERO mechanic) ──
  applyTellFilter(target: unknown, faculty: FacultyId, intensity: number): void {
    const obj = asFilterable(target);
    if (!obj) return;
    const amount = Phaser.Math.Clamp(intensity, 0, 1);
    const tint = FACULTY_TINT[faculty] ?? COL_CRIMSON;

    if (this.quality === "low") {
      // Weak-device fallback: a single tint, no filters, no pulse.
      try {
        obj.setTint?.(tint);
      } catch {
        /* no-op */
      }
      return;
    }

    // Stack Phaser-4 filters on the portrait: cold posterize (GradientMap) +
    // crimson Glow + a desaturating ColorMatrix. Each is feature-detected.
    let list: FilterListLike | undefined;
    try {
      obj.enableFilters?.();
      list = obj.filters?.internal ?? undefined;
    } catch {
      list = undefined;
    }
    if (list) {
      try {
        list.clear?.();
        // cold posterize: blend a crimson-biased gradient map over the portrait.
        // `colorFactor` weights brightness toward crimson; `alpha` scales the blend
        // with the tell intensity (a valid Phaser GradientMapConfig — see types).
        list.addGradientMap?.({
          colorFactor: [0.62, 0.2, 0.18],
          alpha: 0.35 + amount * 0.4,
        });
        // crimson glow whose strength scales with the tell intensity
        list.addGlow?.(COL_CRIMSON, 2 + amount * 6, amount * 2, 1, 0);
        // a non-color edge-pulse via a tiny barrel wobble (colorblind-safe motion)
        list.addBarrel?.(1 + amount * 0.04);
      } catch {
        /* a filter API was unavailable — fall through to the tint nudge below */
      }
    }

    // Always apply the crimson tint pulse (works with OR without filters; it is the
    // floor of the effect and the colorblind-safe motion is the edge-pulse above).
    try {
      obj.setTint?.(tint);
    } catch {
      /* no-op */
    }
    this.pulseTell(obj, amount);
  }

  /** Cosmetic crimson tint pulse — a tween on a scratch object, never read by logic. */
  private pulseTell(obj: FilterableObj, amount: number): void {
    const scene = obj.scene;
    if (!scene || !scene.tweens || !(obj as object)) return;
    try {
      this.tellTweens.get(obj as object)?.remove();
      // pulse a private cosmetic prop; we read it back only to re-tint (presentation).
      const carrier = obj as unknown as { _tellPulse?: number };
      carrier._tellPulse = 0;
      const tween = scene.tweens.add({
        targets: carrier,
        _tellPulse: 1,
        duration: 520 - amount * 220,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        onUpdate: () => {
          const t = carrier._tellPulse ?? 0;
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(
            Phaser.Display.Color.IntegerToColor(0xffffff),
            Phaser.Display.Color.IntegerToColor(COL_CRIMSON),
            100,
            Math.round(t * 100),
          );
          const hex = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
          obj.setTint?.(hex);
        },
      });
      this.tellTweens.set(obj as object, tween);
    } catch {
      /* tween system unavailable — the static tint above is the fallback */
    }
  }

  clearTellFilter(target: unknown): void {
    const obj = asFilterable(target);
    if (!obj) return;
    try {
      this.tellTweens.get(obj as object)?.remove();
      this.tellTweens.delete(obj as object);
    } catch {
      /* no-op */
    }
    try {
      obj.filters?.internal?.clear?.();
    } catch {
      /* no-op */
    }
    try {
      obj.clearTint?.();
    } catch {
      /* no-op */
    }
  }

  // ── Pillar 2: Lighting-as-Perception ──
  setZoneLighting(scene: unknown, zoneId: string, mood?: string): void {
    if (this.quality === "low" || !isScene(scene)) return;
    const lights = scene.lights;
    if (!lights || typeof lights.enable !== "function") return;
    try {
      lights.enable();
      this.litScenes.add(scene);
      const key = (mood ?? this.moodKey(zoneId)) || "bar";
      const m = ZONE_MOOD[key] ?? { ambient: COL_AMBIENT_COLD, warm: false };
      lights.setAmbientColor?.(m.ambient);
    } catch {
      /* lighting unsupported on this renderer — unlit fallback */
    }
  }

  private moodKey(zoneId: string): string {
    const z = zoneId.toLowerCase();
    for (const k of Object.keys(ZONE_MOOD)) if (z.includes(k)) return k;
    return "bar";
  }

  /**
   * Cosmetic player-follow light. Radius scales with the Perception faculty, so it
   * VISUALLY surfaces items in dark zones — examinability stays server-authoritative.
   * The light is cached on the scene so repeated calls reposition rather than leak.
   */
  playerLight(scene: unknown, x: number, y: number, radius: number): void {
    if (this.quality === "low" || !isScene(scene)) return;
    const lights = scene.lights;
    if (!lights || typeof lights.enable !== "function") return;
    try {
      lights.enable();
      this.litScenes.add(scene);
      const carrier = scene as unknown as { _playerLight?: Phaser.GameObjects.Light };
      if (!carrier._playerLight) {
        carrier._playerLight = lights.addLight(x, y, radius, COL_GASLIGHT, 1.1);
      } else {
        carrier._playerLight.x = x;
        carrier._playerLight.y = y;
        carrier._playerLight.setRadius?.(radius);
      }
    } catch {
      /* no-op */
    }
  }

  // ── Pillar 4: camera FX ──
  cameraGotcha(scene: unknown): void {
    if (this.quality === "low" || !isScene(scene)) return;
    try {
      const cam = scene.cameras?.main;
      cam?.shake?.(220, 0.012);
      cam?.flash?.(140, 0xd4, 0x32, 0x2a);
    } catch {
      /* no-op */
    }
    // SOUND: the "caught in a lie" impact, paired with the shake above.
    this.playSfx(scene, "gotcha");
  }

  cameraAccuse(scene: unknown, x: number, y: number): void {
    if (!isScene(scene)) return;
    try {
      const cam = scene.cameras?.main;
      if (this.quality === "low") {
        cam?.flash?.(160, 0xd4, 0x32, 0x2a);
        // SOUND plays even on low quality — it's a beat, not a heavy effect.
        this.playSfx(scene, "accuse");
        return;
      }
      cam?.pan?.(x, y, 380, "Sine.easeInOut");
      cam?.zoomTo?.(1.6, 420, "Cubic.easeOut");
      cam?.shake?.(260, 0.009);
    } catch {
      /* no-op */
    }
    this.playSfx(scene, "accuse");
  }

  // ── Pillar 4: board red-string snap glow burst ──
  snapString(target: unknown): void {
    if (this.quality === "low") return;
    const obj = asFilterable(target);
    if (!obj) return;
    // SOUND: the red string "snaps taut" — fire the twang from the target's scene.
    if (obj.scene) this.playSfx(obj.scene, "stringSnap");
    try {
      obj.enableFilters?.();
      const list = obj.filters?.internal;
      list?.clear?.();
      list?.addGlow?.(COL_CRIMSON, 6, 0, 1, 0);
      // ease the glow back down so the "snap" reads as a one-shot burst
      const scene = obj.scene;
      const glow = obj.filters?.internal?.list;
      if (scene?.tweens && glow && glow.length) {
        const ctrl = glow[glow.length - 1];
        if (ctrl) {
          scene.tweens.add({
            targets: ctrl,
            outerStrength: 0,
            duration: 480,
            ease: "Cubic.easeOut",
            onComplete: () => {
              try {
                obj.filters?.internal?.clear?.();
              } catch {
                /* no-op */
              }
            },
          });
        }
      }
    } catch {
      /* no-op */
    }
  }

  // ── Pillar 4: atmosphere / feedback particles ──
  emit(scene: unknown, kind: ParticleKind, x: number, y: number): void {
    if (this.quality === "low" || !isScene(scene)) return;
    try {
      const color =
        kind === "rain"
          ? 0x5a_74_82
          : kind === "smoke"
            ? 0x44_4c_52
            : kind === "puff"
              ? COL_PUFF
              : 0x7a_70_60; // dust
      const key = ensureDotTexture(scene, `fxdot_${color.toString(16)}`, color);
      const cfg = this.particleConfig(kind);
      const emitter = scene.add.particles(x, y, key, cfg);
      emitter.setDepth?.(20);
      // one-shot kinds explode once then clean themselves up; ambient kinds stream
      // until the scene ends.
      if (kind === "puff") {
        try {
          emitter.explode?.(12, x, y);
        } catch {
          /* no-op */
        }
        scene.time?.delayedCall?.(700, () => {
          try {
            emitter.destroy();
          } catch {
            /* no-op */
          }
        });
      }
    } catch {
      /* particle system unavailable — silent no-op */
    }
  }

  private particleConfig(kind: ParticleKind): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig {
    switch (kind) {
      case "rain":
        return {
          lifespan: 700,
          speedY: { min: 380, max: 460 },
          speedX: { min: -20, max: -8 },
          scale: { start: 0.5, end: 0.5 },
          alpha: { start: 0.35, end: 0 },
          frequency: 24,
          quantity: 2,
          blendMode: "ADD",
        };
      case "smoke":
        return {
          lifespan: 2600,
          speedY: { min: -22, max: -10 },
          speedX: { min: -6, max: 6 },
          scale: { start: 0.4, end: 1.6 },
          alpha: { start: 0.18, end: 0 },
          frequency: 420,
          quantity: 1,
        };
      case "dust":
        return {
          lifespan: 3200,
          speedX: { min: -8, max: 8 },
          speedY: { min: -6, max: 4 },
          scale: { start: 0.3, end: 0.9 },
          alpha: { start: 0.12, end: 0 },
          frequency: 600,
          quantity: 1,
        };
      case "puff":
      default:
        return {
          lifespan: 520,
          speed: { min: 40, max: 120 },
          scale: { start: 0.8, end: 0 },
          alpha: { start: 0.9, end: 0 },
          quantity: 12,
          // a single burst, not a stream
          frequency: -1,
          emitting: false,
        };
    }
  }

  // ── SOUND (Part 4): delegate to the Phaser-free SoundLayer ──
  // COSMETIC-FX GUARD (Part 4.2): no sound result is EVER read by game logic; this is
  // a render-only beat. The layer is a silent no-op when audio is unavailable, the
  // clip never loaded (the manifest slot has no `src` yet), the manager is muted, or
  // the manager is the NoAudio stub.

  playSfx(scene: unknown, name: SfxName): void {
    if (!isScene(scene)) return;
    this.soundLayer.playSfx(scene as unknown as AudioSceneLike, name);
  }

  playAmbience(scene: unknown, zoneId: string): void {
    if (!isScene(scene)) return;
    this.soundLayer.playAmbience(scene as unknown as AudioSceneLike, zoneId);
  }

  stopAmbience(scene: unknown): void {
    if (!isScene(scene)) return;
    this.soundLayer.stopAmbience(scene as unknown as AudioSceneLike);
  }
}

/** Construct the cosmetic FX surface. One per client (or one per scene-group). */
export function createFx(): ParlorFx {
  return new Fx();
}
