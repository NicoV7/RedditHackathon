/**
 * Per-run persona overlay — a guilt-blind "daily disposition" so a character feels
 * different day-to-day without breaking the anti-spoiler invariant.
 *
 * GUILT-BLINDNESS IS STRUCTURAL: `pickDailyMood` is seeded by (runSalt, npcId) ONLY
 * — it has no access to killer identity or the slice, and every principal gets a
 * mood, so the overlay can never single out the killer. Integer-pure (mulberry32).
 */
import { seededPick } from "../../../shared/prng.js";
import type { PersonaSkill } from "./types.js";

/** Deterministically choose tonight's disposition for this NPC. `runSalt` is the
 *  per-instance seed (killer-independent). Returns undefined if the skill has no
 *  mood pool. */
export function pickDailyMood(skill: PersonaSkill, runSalt: string): string | undefined {
  return seededPick(`mood:${runSalt}:${skill.npcId}`, skill.dailyMoods);
}
