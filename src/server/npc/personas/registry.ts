/**
 * PersonaSkill registry — keyed by npc.id (= persona.name). The thin harness looks
 * a skill up generically from here; there is NO per-character code anywhere. Adding
 * a character = author a <slug>.ts and add one import + one row below.
 *
 * The registry-completeness eval hard-fails if any suspect-eligible principal
 * (SUSPECT_NAMES) lacks a skill.
 */
import type { NpcId } from "../../../shared/case.js";
import type { PersonaSkill } from "./types.js";
import { lolaMarsh } from "./lola-marsh.js";
import { donVittorio } from "./don-vittorio.js";
import { frankieConti } from "./frankie-conti.js";
import { silGreco } from "./sil-greco.js";
import { detHalloran } from "./det-halloran.js";
import { nellCarraway } from "./nell-carraway.js";
import { mrAsh } from "./mr-ash.js";
import { augieDoyle } from "./augie-doyle.js";

export const personaSkillById: Record<NpcId, PersonaSkill> = {
  [lolaMarsh.npcId]: lolaMarsh,
  [donVittorio.npcId]: donVittorio,
  [frankieConti.npcId]: frankieConti,
  [silGreco.npcId]: silGreco,
  [detHalloran.npcId]: detHalloran,
  [nellCarraway.npcId]: nellCarraway,
  [mrAsh.npcId]: mrAsh,
  [augieDoyle.npcId]: augieDoyle,
};

/** Resolve a character's fat skill, or undefined → harness uses the legacy path. */
export function getPersonaSkill(npcId: NpcId): PersonaSkill | undefined {
  return personaSkillById[npcId];
}
