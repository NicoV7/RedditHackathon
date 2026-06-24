/**
 * React ↔ Phaser bridge (eng-review M-4). The single contract between the React
 * shell (owns the game-state FSM + data) and the Phaser scenes (own pixels +
 * input). Phaser NEVER owns game state — it emits intents back via handlers.
 * Both client agents build against THIS interface, not against each other.
 */
import type { ClientCaseView, NominationRole } from "../shared/api.js";

// ── Living-world scene (C10) ──
export interface WorldHandlers {
  onApproachNpc(npcId: string): void;
  onExamineItem(itemId: string): void;
}
export interface WorldHandle {
  setActiveZone(zoneId: string): void;
  /** freeze the living world (tick clock + tweens) — state held in place */
  pause(): void;
  /** resume the living world from the frozen state */
  resume(): void;
  destroy(): void;
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
}

export interface PhaserBridge {
  mountWorld(el: HTMLElement, view: ClientCaseView, handlers: WorldHandlers): WorldHandle;
  mountBoard(el: HTMLElement, data: BoardData, handlers: BoardHandlers): BoardHandle;
}
