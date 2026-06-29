/**
 * World perception (B2a) — the PURE, integer-pure perception gate that decides
 * which NPCs could witness a player action at a given (zone, tick).
 *
 * Pinned rule (PLAN §2.6 / J1): an NPC witnesses an action IFF the NPC is in the
 * event's zone at the event's tick — i.e. `npcZoneAtTick(npc, tick) === event.zone`.
 * Each NPC's zone-at-tick is derived from its `routine[]` (RoutineStep
 * fromTick/toTick half-open windows). No RNG, no Date.now, no float math: same
 * inputs ⇒ same witness set on any engine. The result feeds
 * `metrics/events.logPlayerEvent(..., witnessedBy)` so an NPC's RAG memory slot
 * only ever sees events it could actually perceive.
 */
import type { Npc, RoutineStep, ZoneId } from "../../shared/case.js";

/**
 * The zone an NPC occupies at a logical `tick`, derived from its routine. Routine
 * windows are treated as HALF-OPEN [fromTick, toTick): a step covers ticks
 * `fromTick <= tick < toTick`. When several steps overlap a tick (shouldn't, with
 * well-formed routines) the FIRST matching step wins for determinism. When no step
 * covers the tick, the NPC falls back to its `homeZone` (it is "at home" off-shift).
 *
 * PURE + integer-pure: a plain scan over `npc.routine`, never reads a clock or RNG.
 */
export function npcZoneAtTick(npc: Npc, tick: number): ZoneId {
  for (const step of npc.routine) {
    if (tickInStep(step, tick)) return step.zoneId;
  }
  return npc.homeZone;
}

/** Half-open membership: fromTick <= tick < toTick. Integer comparison only. */
function tickInStep(step: RoutineStep, tick: number): boolean {
  return tick >= step.fromTick && tick < step.toTick;
}

/**
 * The perception gate: every NPC whose derived zone-at-tick equals `zoneId` at
 * `tick`. This is the canonical `witnessedBy` set for an event happening in
 * `zoneId` at `tick`. Order follows the input `npcs` order (deterministic).
 *
 * @returns the witnessing NPC ids (deduped by construction — one id per NPC).
 */
export function witnessesAt(npcs: readonly Npc[], zoneId: ZoneId, tick: number): string[] {
  const out: string[] = [];
  for (const npc of npcs) {
    if (npcZoneAtTick(npc, tick) === zoneId) out.push(npc.id);
  }
  return out;
}
