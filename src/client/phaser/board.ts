/**
 * src/client/phaser/board.ts — C9 "Deduction Board" Phaser scene.
 *
 * The hero surface. Cards (npc / clue / item) auto-lay into a snap grid. The
 * signature interaction is TAP-TO-LINK (mobile-first, never drag): tap card A,
 * then tap card B → a crimson "red string" is drawn and `handlers.onLink(a, b)`
 * fires. Per-NPC role tagging cycles a role badge → `handlers.onTagNpc`. A
 * deduction-strength meter is set via the handle's `setStrength`. Committing fires
 * `handlers.onAccuse`.
 *
 * FRANCHISE SIGNATURE: the red string is crimson #D4322A and is the ONLY
 * fully-saturated red anywhere in the product. Everything else stays in the
 * desaturated Lamplight Noir palette.
 *
 * No killer knowledge: the board only knows card ids/labels/kinds the shell hands
 * it; "killer" is just one selectable hypothesis role like any other.
 */
import Phaser from "phaser";
import type { NominationRole } from "../../shared/api.js";
import type { BoardCard, BoardData, BoardHandle, BoardHandlers } from "../bridge.js";
import { CORKBOARD_KEY, loadAssets } from "./assets.js";
import { createFx, type ParlorFx } from "./fx.js";

// ── Crimson red string — the ONLY saturated red ──
const COL_STRING = 0xd4_32_2a;

// ── Lamplight Noir (desaturated) ──
const COL_BG = 0x14_1d_20;
const COL_CARD = 0x22_31_36;
const COL_CARD_STROKE = 0x39_53_5a;
const COL_CARD_SEL = 0x3a_55_5d; // selected (link source) fill
const COL_CARD_SEL_STROKE = 0xe8_b8_6d; // amber selection ring
const COL_KIND_NPC = 0xe8_b8_6d; // amber
const COL_KIND_CLUE = 0x7e_a8_b0; // slate
const COL_KIND_ITEM = 0x9a_8a_b0; // muted violet
const COL_METER_BG = 0x1a_26_2a;
const COL_METER_FILL = 0xe8_b8_6d;
const COL_PIN = 0x0e_15_17;

// ── Layout ──
const CARD_W = 150;
const CARD_H = 92; // ≥44px tap target with room for badges
const GAP_X = 30;
const GAP_Y = 34;
const MARGIN = 40;
const BADGE_H = 30; // ≥30; combined with padding gives ≥44px effective target

const ROLE_CYCLE: NominationRole[] = ["unknown", "suspect", "bystander", "killer"];
const ROLE_LABEL: Record<NominationRole, string> = {
  unknown: "?",
  suspect: "SUSPECT",
  bystander: "BYSTANDER",
  killer: "KILLER",
};
const ROLE_COLOR: Record<NominationRole, number> = {
  unknown: 0x39_53_5a,
  suspect: 0xc8_8a_3a,
  bystander: 0x55_7a_5a,
  killer: 0x8a_2e_2a, // dark — NOT the saturated string red
};

function kindColor(kind: BoardCard["kind"]): number {
  if (kind === "npc") return COL_KIND_NPC;
  if (kind === "clue") return COL_KIND_CLUE;
  return COL_KIND_ITEM;
}

interface CardView {
  card: BoardCard;
  container: Phaser.GameObjects.Container;
  cx: number; // center x in board space
  cy: number;
  role: NominationRole; // local hypothesis (npc cards only)
  roleBadge?: Phaser.GameObjects.Container;
  meterFill?: Phaser.GameObjects.Rectangle;
  strength: number;
}

interface LinkView {
  aId: string;
  bId: string;
}

class BoardScene extends Phaser.Scene {
  private readonly boardData: BoardData;
  private readonly handlers: BoardHandlers;
  private readonly fx: ParlorFx;

  private cards: CardView[] = [];
  private cardById = new Map<string, CardView>();
  private links: LinkView[] = [];
  private linkGraphics?: Phaser.GameObjects.Graphics;
  private selectedId: string | null = null;
  /** the Part 1.5 confidence gate — when false, naming a killer is suppressed. */
  private accuseEnabled = true;

  // pinch-zoom state
  private pinchStartDist = 0;
  private pinchStartZoom = 1;

  /** fired at the end of create() so the mount handle can flush queued calls */
  private readonly onReady?: () => void;

  constructor(data: BoardData, handlers: BoardHandlers, fx: ParlorFx, onReady?: () => void) {
    super("board");
    this.boardData = data;
    this.handlers = handlers;
    this.fx = fx;
    this.onReady = onReady;
  }

  preload(): void {
    // SOUND + ART: pull the global SFX (incl. the string-snap twang) and the cork
    // texture into this scene's caches. A safe no-op for every clip/image whose
    // `src` is absent today (assets.ts skips it); zone tilesets aren't used here.
    try {
      loadAssets(this, { zones: false });
    } catch {
      /* loader unavailable — the board keeps its flat noir backdrop, snaps stay silent */
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COL_BG);
    this.drawCorkBackdrop();
    this.linkGraphics = this.add.graphics().setDepth(1);

    for (const card of this.boardData.cards) this.addCardInternal(card);
    this.relayout();
    this.fitAll();

    this.setupZoom();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    // Cards/meters now exist — let the mount handle flush any queued addCard/
    // setStrength calls that arrived before the scene booted.
    this.onReady?.();
  }

  /**
   * Cosmetic cork/baize backdrop behind the cards (Pillar 4). Uses the loaded
   * corkboard texture when present (tiled to fill), ELSE bakes a subtle programmatic
   * cold-noir baize (vignette + faint speckle) so the board reads as a real corkboard
   * instead of a flat fill. Never read by logic; depth 0 (under links + cards).
   */
  private drawCorkBackdrop(): void {
    const w = this.scale.width || 800;
    const h = this.scale.height || 600;
    try {
      if (this.textures.exists(CORKBOARD_KEY)) {
        // Real cork texture: tile it across a generous area (board space, depth 0).
        this.add
          .tileSprite(0, 0, w * 3, h * 3, CORKBOARD_KEY)
          .setOrigin(0, 0)
          .setPosition(-w, -h)
          .setDepth(0)
          .setAlpha(0.9);
        return;
      }
    } catch {
      /* tileSprite unavailable — fall through to the programmatic baize */
    }
    // Programmatic fallback: a darker baize panel + speckle + a soft vignette ring.
    try {
      const g = this.add.graphics().setDepth(0);
      // baize panel slightly warmer than the camera bg so cards read as pinned ON it
      g.fillStyle(0x18_24_27, 1);
      g.fillRect(-w, -h, w * 3, h * 3);
      // faint deterministic speckle (cork grain) — fixed grid, never RNG in logic
      g.fillStyle(0x20_2e_31, 0.5);
      for (let sx = -w; sx < w * 2; sx += 26) {
        for (let sy = -h; sy < h * 2; sy += 26) {
          // checker offset keeps it from looking like a hard grid
          const off = ((sx / 26 + sy / 26) & 1) === 0 ? 0 : 13;
          g.fillCircle(sx + off, sy + 7, 1.5);
        }
      }
      // soft vignette: concentric darkening rings toward the edges (cold noir)
      g.fillStyle(0x10_18_1a, 0.06);
      for (let r = 0; r < 5; r++) {
        g.fillRect(-w + r * 24, -h + r * 24, w * 3 - r * 48, h * 3 - r * 48);
      }
    } catch {
      /* graphics unavailable — the camera background color is the final fallback */
    }
  }

  // ── Card creation / layout ──

  addCardInternal(card: BoardCard): CardView {
    const accent = kindColor(card.kind);

    const bg = this.add
      .rectangle(0, 0, CARD_W, CARD_H, COL_CARD, 1)
      .setStrokeStyle(2, COL_CARD_STROKE, 1);
    // top accent bar by kind
    const accentBar = this.add.rectangle(0, -CARD_H / 2 + 4, CARD_W, 6, accent, 1);
    // pin dot (cork-board affordance for the string anchor)
    const pin = this.add.circle(0, -CARD_H / 2 + 4, 4, COL_PIN, 1).setStrokeStyle(1, accent, 1);

    const kindText = this.add
      .text(-CARD_W / 2 + 8, -CARD_H / 2 + 12, card.kind.toUpperCase(), {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#7e8c8f",
      })
      .setOrigin(0, 0);

    const label = this.add
      .text(0, -4, card.label, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#cfdddf",
        align: "center",
        wordWrap: { width: CARD_W - 16 },
      })
      .setOrigin(0.5, 0.5);

    const children: Phaser.GameObjects.GameObject[] = [bg, accentBar, pin, kindText, label];

    const view: CardView = {
      card,
      container: this.add.container(0, 0, children),
      cx: 0,
      cy: 0,
      role: "unknown",
      strength: 0,
    };

    // NPC cards get a role badge + strength meter.
    if (card.kind === "npc") {
      const badge = this.makeRoleBadge(view);
      view.roleBadge = badge;
      view.container.add(badge);

      const meterBg = this.add.rectangle(0, CARD_H / 2 - 8, CARD_W - 16, 5, COL_METER_BG, 1);
      const meterFill = this.add
        .rectangle(-(CARD_W - 16) / 2, CARD_H / 2 - 8, 0, 5, COL_METER_FILL, 1)
        .setOrigin(0, 0.5);
      view.meterFill = meterFill;
      view.container.add(meterBg);
      view.container.add(meterFill);
    }

    // Card body hit-area = tap-to-link. Sized to the full card (≥44px).
    bg.setInteractive({ useHandCursor: true });
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (p: Phaser.Input.Pointer) => {
      // Ignore the up that ends a pinch/drag-pan gesture.
      if (this.wasGesture(p)) return;
      this.onCardTap(view.card.id);
    });

    view.container.setDepth(3);
    this.cards.push(view);
    this.cardById.set(card.id, view);
    return view;
  }

  /** A cyclable role badge (mobile tap target ≥44px effective). */
  private makeRoleBadge(view: CardView): Phaser.GameObjects.Container {
    const bw = CARD_W - 16;
    const by = CARD_H / 2 - 26;
    const bg = this.add
      .rectangle(0, 0, bw, BADGE_H, ROLE_COLOR.unknown, 1)
      .setStrokeStyle(1, COL_CARD_STROKE, 1);
    const txt = this.add
      .text(0, 0, ROLE_LABEL.unknown, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#101a1c",
      })
      .setOrigin(0.5, 0.5);
    const badge = this.add.container(0, by, [bg, txt]);
    badge.setData("bg", bg);
    badge.setData("txt", txt);

    bg.setInteractive({ useHandCursor: true });
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (this.wasGesture(p)) return;
      this.cycleRole(view);
    });
    return badge;
  }

  private cycleRole(view: CardView): void {
    const idx = ROLE_CYCLE.indexOf(view.role);
    const next = ROLE_CYCLE[(idx + 1) % ROLE_CYCLE.length] ?? "unknown";
    view.role = next;
    const badge = view.roleBadge;
    if (badge) {
      const bg = badge.getData("bg") as Phaser.GameObjects.Rectangle | undefined;
      const txt = badge.getData("txt") as Phaser.GameObjects.Text | undefined;
      bg?.setFillStyle(ROLE_COLOR[next], 1);
      txt?.setText(ROLE_LABEL[next]);
    }
    this.handlers.onTagNpc(view.card.id, next);
    // Naming someone the killer is also the accusation commit point — but only when
    // the Part 1.5 confidence gate is met (server stays authoritative regardless).
    if (next === "killer" && this.accuseEnabled) this.handlers.onAccuse(view.card.id);
  }

  /** Snap-grid auto-layout. Columns chosen to stay roughly square. */
  private relayout(): void {
    const n = this.cards.length;
    if (n === 0) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    for (let i = 0; i < n; i++) {
      const view = this.cards[i];
      if (!view) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      view.cx = MARGIN + col * (CARD_W + GAP_X) + CARD_W / 2;
      view.cy = MARGIN + row * (CARD_H + GAP_Y) + CARD_H / 2;
      view.container.setPosition(view.cx, view.cy);
    }
    this.redrawLinks();
  }

  // ── Tap-to-link state machine ──

  private onCardTap(id: string): void {
    if (this.selectedId === null) {
      this.selectedId = id;
      this.setSelected(id, true);
      return;
    }
    if (this.selectedId === id) {
      // tapping the source again cancels the pending link
      this.setSelected(id, false);
      this.selectedId = null;
      return;
    }
    const aId = this.selectedId;
    const bId = id;
    this.setSelected(aId, false);
    this.selectedId = null;
    if (!this.hasLink(aId, bId)) {
      this.links.push({ aId, bId });
      this.redrawLinks();
      // Pillar 4: the red string "snaps taut" with a cosmetic glow burst + puff.
      this.snapBurst(aId, bId);
    }
    this.handlers.onLink(aId, bId);
  }

  private setSelected(id: string, on: boolean): void {
    const view = this.cardById.get(id);
    if (!view) return;
    const bg = view.container.list[0] as Phaser.GameObjects.Rectangle | undefined;
    if (!bg || !(bg instanceof Phaser.GameObjects.Rectangle)) return;
    bg.setFillStyle(on ? COL_CARD_SEL : COL_CARD, 1);
    bg.setStrokeStyle(on ? 3 : 2, on ? COL_CARD_SEL_STROKE : COL_CARD_STROKE, 1);
  }

  private hasLink(a: string, b: string): boolean {
    return this.links.some(
      (l) => (l.aId === a && l.bId === b) || (l.aId === b && l.bId === a),
    );
  }

  private redrawLinks(): void {
    const g = this.linkGraphics;
    if (!g) return;
    g.clear();
    g.lineStyle(3, COL_STRING, 1);
    for (const link of this.links) {
      const a = this.cardById.get(link.aId);
      const b = this.cardById.get(link.bId);
      if (!a || !b) continue;
      // Anchor at the pin near the top of each card.
      g.lineBetween(a.cx, a.cy - CARD_H / 2 + 4, b.cx, b.cy - CARD_H / 2 + 4);
    }
  }

  // ── Pinch-zoom + wheel-zoom + fit-all ──

  private setupZoom(): void {
    const input = this.input;

    // Wheel zoom (desktop / trackpad).
    input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.zoomBy(dy > 0 ? -0.1 : 0.1);
      },
    );

    // Two-finger pinch. We need a 2nd pointer beyond the default single one.
    input.addPointer(1);
    input.on(Phaser.Input.Events.POINTER_MOVE, () => this.onPinchMove());
  }

  private onPinchMove(): void {
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (!p1.isDown || !p2.isDown) {
      this.pinchStartDist = 0;
      return;
    }
    const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
    if (this.pinchStartDist === 0) {
      this.pinchStartDist = dist;
      this.pinchStartZoom = this.cameras.main.zoom;
      return;
    }
    const ratio = dist / this.pinchStartDist;
    this.setZoom(this.pinchStartZoom * ratio);
  }

  private zoomBy(delta: number): void {
    this.setZoom(this.cameras.main.zoom + delta);
  }

  private setZoom(z: number): void {
    const clamped = Phaser.Math.Clamp(z, 0.25, 2.5);
    this.cameras.main.setZoom(clamped);
  }

  /** Frame all cards within the viewport (fit-all). */
  private fitAll(): void {
    if (this.cards.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of this.cards) {
      minX = Math.min(minX, v.cx - CARD_W / 2);
      minY = Math.min(minY, v.cy - CARD_H / 2);
      maxX = Math.max(maxX, v.cx + CARD_W / 2);
      maxY = Math.max(maxY, v.cy + CARD_H / 2);
    }
    const w = maxX - minX + MARGIN * 2;
    const h = maxY - minY + MARGIN * 2;
    const cam = this.cameras.main;
    const zoom = Phaser.Math.Clamp(Math.min(cam.width / w, cam.height / h), 0.25, 1.5);
    cam.setZoom(zoom);
    cam.centerOn((minX + maxX) / 2, (minY + maxY) / 2);
  }

  /** Heuristic: a pointer that moved a lot, or a multi-touch, ended a gesture. */
  private wasGesture(p: Phaser.Input.Pointer): boolean {
    if (this.input.pointer2.isDown) return true;
    return Phaser.Math.Distance.Between(p.downX, p.downY, p.upX, p.upY) > 12;
  }

  // ── Public handle ops ──

  addCard(card: BoardCard): void {
    if (this.cardById.has(card.id)) return;
    this.addCardInternal(card);
    this.relayout();
    this.fitAll();
  }

  setStrength(npcId: string, value: number): void {
    const view = this.cardById.get(npcId);
    if (!view || !view.meterFill) return;
    const clamped = Phaser.Math.Clamp(value, 0, 1);
    view.strength = clamped;
    view.meterFill.width = (CARD_W - 16) * clamped;
  }

  /** Draw a server-confirmed or player-asserted link (idempotent). */
  addLink(aId: string, bId: string): void {
    if (this.hasLink(aId, bId)) return;
    if (!this.cardById.has(aId) || !this.cardById.has(bId)) return;
    this.links.push({ aId, bId });
    this.redrawLinks();
  }

  /** Pillar 4 — animate the "snap taut" glow burst on an existing/just-made link. */
  snapString(aId: string, bId: string): void {
    this.snapBurst(aId, bId);
  }

  /**
   * Pin a notetaker note onto the board (a server-authored `noteText` clue) as a
   * clue card whose id is the clueId. Optionally draws an edge back to the NPC that
   * surfaced it. Templated reformat — never untrusted prose injected as a highlight.
   */
  addNote(clueId: string, noteText: string, sourceNpcId?: string): void {
    if (!this.cardById.has(clueId)) {
      this.addCardInternal({ id: clueId, label: noteText, kind: "clue" });
      this.relayout();
      this.fitAll();
    }
    if (sourceNpcId && this.cardById.has(sourceNpcId)) {
      this.addLink(sourceNpcId, clueId);
      this.snapBurst(sourceNpcId, clueId);
    }
  }

  /** Gate the Accuse action (Part 1.5). When disabled, naming a killer is suppressed. */
  setAccuseEnabled(enabled: boolean): void {
    this.accuseEnabled = enabled;
  }

  /** Cosmetic snap glow + puff at the link midpoint. Never read by logic (Part 4.2). */
  private snapBurst(aId: string, bId: string): void {
    const a = this.cardById.get(aId);
    const b = this.cardById.get(bId);
    if (!a || !b) return;
    try {
      // glow the link graphics, then a particle puff at the midpoint of the string
      if (this.linkGraphics) this.fx.snapString(this.linkGraphics);
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy - CARD_H / 2 + 4 + (b.cy - CARD_H / 2 + 4)) / 2;
      this.fx.emit(this, "puff", mx, my);
    } catch {
      /* no-op fallback */
    }
  }

  private teardown(): void {
    this.linkGraphics?.destroy();
  }
}

export function mountBoard(
  el: HTMLElement,
  data: BoardData,
  handlers: BoardHandlers,
): BoardHandle {
  // Calls can arrive (App seeds the strength meters) before the Phaser scene has
  // booted — at which point `scene.events`/`scene.scene` don't exist yet. Queue
  // them and flush deterministically from the scene's create() via onReady,
  // rather than touching the not-yet-initialized scene systems.
  const pending: Array<() => void> = [];
  let booted = false;
  const fx = createFx();
  const scene = new BoardScene(data, handlers, fx, () => {
    booted = true;
    for (const fn of pending.splice(0)) fn();
  });
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: el,
    width: el.clientWidth || 800,
    height: el.clientHeight || 600,
    backgroundColor: COL_BG,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene,
  });

  const whenReady = (fn: () => void): void => {
    if (booted) fn();
    else pending.push(fn);
  };

  return {
    addCard(card: BoardCard): void {
      whenReady(() => scene.addCard(card));
    },
    setStrength(npcId: string, value: number): void {
      whenReady(() => scene.setStrength(npcId, value));
    },
    addLink(aId: string, bId: string): void {
      whenReady(() => scene.addLink(aId, bId));
    },
    snapString(aId: string, bId: string): void {
      whenReady(() => scene.snapString(aId, bId));
    },
    setAccuseEnabled(enabled: boolean): void {
      whenReady(() => scene.setAccuseEnabled(enabled));
    },
    addNote(clueId: string, noteText: string, sourceNpcId?: string): void {
      whenReady(() => scene.addNote(clueId, noteText, sourceNpcId));
    },
    destroy(): void {
      game.destroy(true);
    },
  };
}
