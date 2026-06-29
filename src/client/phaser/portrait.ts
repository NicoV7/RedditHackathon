/**
 * src/client/phaser/portrait.ts — Pillar 1, the HERO Phaser mechanic.
 *
 * A lightweight Phaser layer that renders the principal NPC's portrait inside the
 * Disco-Elysium dialogue panel and, on a server-authoritative `statedLie` tell,
 * stacks the lie-tell Filter (cold posterize + crimson Glow + crimson tint pulse +
 * a non-color edge-pulse). Reading that filter is the game's read→prove core loop.
 *
 * COSMETIC-FX GUARD (Part 4.2): the tell shown here is a DETERMINISTIC,
 * SERVER-AUTHORITATIVE signal (RevealedClue.tell, surfaced as a TellSignal). This
 * layer ONLY renders it — it never feeds anything back into game logic, and game
 * logic never reads the portrait's visual state. `intensity` is cosmetic.
 *
 * GRACEFUL FALLBACK: if the portrait PNG is missing, WebGL/filters are unavailable,
 * or any Phaser API is absent, we degrade — first to a plain tint, then to a flat
 * placeholder rectangle — so the dialogue always renders and the build stays green.
 *
 * Phaser 4 APIs used (verified against node_modules/phaser/types @ 4.2.0):
 *  - `scene.load.image(key,url)` + `scene.load.start()` for late portrait loading.
 *  - `image.enableFilters()` + `image.filters.internal.add*` for the tell stack
 *    (the FX live in fx.ts; this file owns the portrait object + lifecycle).
 */
import Phaser from "phaser";
import type { TellSignal } from "../../shared/api.js";
import type { PortraitHandle } from "../bridge.js";
import { portraitFor } from "../ui/portraits.js";
import { loadAssets } from "./assets.js";
import { createFx, type ParlorFx } from "./fx.js";

const COL_BG = 0x14_1d_20; // dialogue-panel backdrop
const COL_PLACEHOLDER = 0x22_31_36; // flat card when art is missing
const COL_PLACEHOLDER_STROKE = 0x39_53_5a;

/** Resolve an npcId to a portrait URL. We key portraits by display name in the UI,
 *  but the dialogue passes an npcId; the name often *is* embedded, and unknown ids
 *  fall back deterministically inside portraitFor — so this never renders blank. */
function portraitUrlFor(npcId: string): string {
  return portraitFor(npcId);
}

class PortraitScene extends Phaser.Scene {
  private readonly npcId: string;
  private readonly fx: ParlorFx;
  private portrait?: Phaser.GameObjects.Image;
  private placeholder?: Phaser.GameObjects.Rectangle;
  private pendingTell: TellSignal | null = null;
  private ready = false;
  private readonly textureKey: string;

  constructor(npcId: string, fx: ParlorFx) {
    super(`portrait-${npcId}`);
    this.npcId = npcId;
    this.fx = fx;
    // unique per npc so re-mounts don't collide in the global texture cache
    this.textureKey = `portrait_${npcId.replace(/[^a-z0-9]/gi, "_")}`;
  }

  preload(): void {
    try {
      const url = portraitUrlFor(this.npcId);
      if (url && !this.textures.exists(this.textureKey)) {
        this.load.image(this.textureKey, url);
      }
    } catch {
      /* loader unavailable / bad url — create() falls back to a placeholder */
    }
    // SOUND: pull the global SFX (incl. the lie-sting) into this scene's audio cache
    // so showTell() can play it. A safe no-op for every clip whose `src` is absent
    // today (assets.ts skips it); zone art is irrelevant to the portrait → deferred.
    try {
      loadAssets(this, { zones: false });
    } catch {
      /* loader unavailable — the tell stays a purely visual filter */
    }
    // never let a missing asset abort the scene — swallow loader errors
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      /* handled by the create() fallback */
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COL_BG);
    const w = this.scale.width || 240;
    const h = this.scale.height || 320;
    const cx = w / 2;
    const cy = h / 2;

    if (this.textures.exists(this.textureKey)) {
      this.portrait = this.add.image(cx, cy, this.textureKey);
      // fit the portrait into the panel while preserving aspect
      const src = this.portrait;
      const scale = Math.min(w / src.width, h / src.height);
      src.setScale(scale).setDepth(2);
    } else {
      // flat placeholder so the panel is never blank
      this.placeholder = this.add
        .rectangle(cx, cy, w - 12, h - 12, COL_PLACEHOLDER, 1)
        .setStrokeStyle(2, COL_PLACEHOLDER_STROKE, 1)
        .setDepth(2);
      this.add
        .text(cx, cy, this.npcId, {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#6f8c92",
          align: "center",
          wordWrap: { width: w - 24 },
        })
        .setOrigin(0.5, 0.5)
        .setDepth(3);
    }

    this.ready = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    // flush a tell that arrived before the scene booted
    if (this.pendingTell) {
      const t = this.pendingTell;
      this.pendingTell = null;
      this.showTell(t);
    }
  }

  /** The filter target — the portrait image if present, else the placeholder. */
  private fxTarget(): Phaser.GameObjects.GameObject | undefined {
    return this.portrait ?? this.placeholder;
  }

  showTell(tell: TellSignal): void {
    if (!this.ready) {
      this.pendingTell = tell;
      return;
    }
    const target = this.fxTarget();
    if (!target) return;
    // The deterministic trigger came from the SERVER (RevealedClue.tell); this layer
    // only RENDERS it. The fx surface stacks Glow + cold posterize + crimson pulse.
    this.fx.applyTellFilter(target, tell.faculty, tell.intensity);
    // SOUND: the crimson lie-tell sting (silent no-op until sfx-lie-sting.mp3 lands).
    this.fx.playSfx(this, "lieSting");
  }

  clearTell(): void {
    const target = this.fxTarget();
    if (target) this.fx.clearTellFilter(target);
    this.pendingTell = null;
  }

  private teardown(): void {
    this.clearTell();
  }
}

/**
 * Mount an NPC portrait into the dialogue panel. Returns a `PortraitHandle` the
 * dialogue uses to drive the lie-tell filter. Tolerant of an unsized element (uses
 * the 240×320 portrait aspect) and of a Phaser/WebGL failure (the returned handle
 * stays a valid no-op so the dialogue still renders).
 */
export function mountPortrait(el: HTMLElement, npcId: string): PortraitHandle {
  const fx = createFx();
  const scene = new PortraitScene(npcId, fx);

  const width = el.clientWidth || 240;
  const height = el.clientHeight || 320;

  let game: Phaser.Game | null = null;
  try {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      width,
      height,
      backgroundColor: COL_BG,
      transparent: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene,
    });
  } catch {
    // Phaser failed to construct (no WebGL/canvas) — return an inert handle.
    return {
      showTell(): void {
        /* no-op fallback */
      },
      clearTell(): void {
        /* no-op fallback */
      },
      destroy(): void {
        /* no-op fallback */
      },
    };
  }

  return {
    showTell(tell: TellSignal): void {
      try {
        scene.showTell(tell);
      } catch {
        /* no-op */
      }
    },
    clearTell(): void {
      try {
        scene.clearTell();
      } catch {
        /* no-op */
      }
    },
    destroy(): void {
      try {
        game?.destroy(true);
      } catch {
        /* no-op */
      }
    },
  };
}
