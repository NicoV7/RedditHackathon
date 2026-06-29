/**
 * React ↔ Phaser bridge (eng-review M-4). The single contract between the React
 * shell (owns the game-state FSM + data) and the Phaser scenes (own pixels +
 * input). Phaser NEVER owns game state — it emits intents back via handlers.
 * Both client agents build against THIS interface, not against each other.
 */
import type { ClientCaseView, NominationRole, TellSignal } from "../shared/api.js";

// ── Living-world scene (C10) ──
export interface WorldHandlers {
  onApproachNpc(npcId: string): void;
  onExamineItem(itemId: string): void;
  /** the walkable avatar arrived in a zone — drives the perception model (Part 2.3) */
  onMovePlayer?(zoneId: string): void;
  /** player walked through a door A→B (optionally gated) */
  onEnterDoor?(fromZoneId: string, toZoneId: string): void;
  /** present a collected item to an NPC (the "gotcha"); fires presentReactions */
  onPresentItem?(itemId: string, npcId: string): void;
}
export interface WorldHandle {
  setActiveZone(zoneId: string): void;
  /** freeze the living world (tick clock + tweens) — state held in place */
  pause(): void;
  /** resume the living world from the frozen state */
  resume(): void;
  destroy(): void;
  /** walk the avatar to a zone (A* path); cosmetic tween, logical zone snaps */
  movePlayerTo?(zoneId: string): void;
  /** Perception faculty → light radius that reveals dark-zone items (cosmetic) */
  setPlayerLight?(radius: number): void;
  /** FX quality toggle; "low" is the weak-device fallback (Part 4.4) */
  setQuality?(level: "high" | "low"): void;
}

// ── Deduction Board scene (C9) ──
export type BoardCardKind = "npc" | "clue" | "item";
export interface BoardCard {
  id: string;
  label: string;
  kind: BoardCardKind;
}
export interface BoardData {
  cards: BoardCard[];
}
export interface BoardHandlers {
  /** player tags an NPC card with a hypothesis role (emits a nomination) */
  onTagNpc(npcId: string, role: NominationRole): void;
  /** tap-to-link two cards (not drag — mobile-first) */
  onLink(aId: string, bId: string): void;
  /** commit the accusation */
  onAccuse(npcId: string): void;
}
export interface BoardHandle {
  addCard(card: BoardCard): void;
  /** deduction-strength meter, 0..1 */
  setStrength(npcId: string, value: number): void;
  destroy(): void;
  /** draw a red-string link (server-confirmed or player-asserted) */
  addLink?(aId: string, bId: string): void;
  /** Pillar 4 — animate the "snap taut" glow when a link lands (cosmetic) */
  snapString?(aId: string, bId: string): void;
  /** gate the Accuse action until the confidence threshold is met (Part 1.5) */
  setAccuseEnabled?(enabled: boolean): void;
  /**
   * pin a notetaker note onto the board (a server-authored `noteText` clue),
   * optionally drawing an edge back to the NPC that surfaced it. The note card's
   * id is the clueId, so subsequent links/strength can reference it.
   */
  addNote?(clueId: string, noteText: string, sourceNpcId?: string): void;
}

// ── NPC portrait in the dialogue panel (C8) ──
/**
 * A live portrait rendered in the Disco-Elysium dialogue panel. The dialogue UI
 * drives the lie-tell filter through this handle: `showTell` applies the
 * faculty-keyed cosmetic FX (filter/light/particle) at the tell's `intensity`.
 *
 * COSMETIC-FX GUARD (Part 4.2): the tell shown here is a deterministic,
 * SERVER-AUTHORITATIVE signal (RevealedClue.tell). The portrait only RENDERS it
 * — it never feeds anything back into game logic, and game logic never reads the
 * portrait's visual state.
 */
export interface PortraitHandle {
  /** render the faculty-keyed lie-tell filter (cosmetic; driven by a TellSignal). */
  showTell(tell: TellSignal): void;
  /** clear any active tell filter (e.g. on the next line / dialogue exit). */
  clearTell(): void;
  destroy(): void;
}

export interface PhaserBridge {
  mountWorld(el: HTMLElement, view: ClientCaseView, handlers: WorldHandlers): WorldHandle;
  mountBoard(el: HTMLElement, data: BoardData, handlers: BoardHandlers): BoardHandle;
  /**
   * mount an NPC portrait into the dialogue panel. Returns a handle the dialogue
   * uses to render the lie-tell filter for that NPC (cosmetic, server-driven).
   * `npcId` selects the portrait art (graceful fallback when the asset is absent).
   *
   * OPTIONAL like the other post-core capabilities (`addLink?`, `addNote?`, …):
   * a partial bridge (the no-op fallback, an in-progress concrete bridge) stays a
   * valid `PhaserBridge`. Callers MUST guard (`bridge.mountPortrait?.(…)`) so the
   * dialogue still renders when no portrait layer is mounted.
   */
  mountPortrait?(el: HTMLElement, npcId: string): PortraitHandle;
}
