/**
 * The Drowned Lily cast roster — single source of truth shared by the generator
 * (which draws suspects) and the persona registry (which authors a skill per
 * suspect-eligible principal). Keeping it here prevents the two from drifting.
 *
 * GUILT-BLIND: this is social/structural casting only. Who the killer is stays a
 * per-instance secret carried by `statedLie` slice entries, never by this list.
 */
import type { NpcId } from "../../../shared/case.js";

/**
 * Suspect-eligible principals. ANY of these may be drawn as a suspect on a given
 * run (the generator shuffles within this pool), so EACH must have a PersonaSkill.
 * Names must equal the `persona.name`/`id` the generator mints (npc.id === name).
 */
export const SUSPECT_NAMES: readonly NpcId[] = [
  "Lola Marsh",
  "Don Vittorio",
  "Frankie Conti",
  "Sil Greco",
  "Det. Halloran",
  "Nell Carraway",
  "Mr. Ash",
  "Augie Doyle",
];

/**
 * Witnesses — structurally NEVER suspects. The generator only ever places them as
 * supporting/ambient extras, so they ride the templated (scripted) harness paths
 * and need no agent skill.
 */
export const WITNESS_NAMES: readonly NpcId[] = ["Harlan", "Old Cobb", "Birdie"];
