/**
 * Per-NPC OUTPUT guardrail (server-authoritative). Runs AFTER provider.complete and
 * BEFORE the reply reaches the player. Generic + parameterized entirely by the
 * skill — zero per-character code.
 *
 * DEFENCE-IN-DEPTH ONLY: the real anti-spoiler guarantee is STRUCTURAL (revealedClueIds
 * is computed server-side and never parsed from the reply). This guardrail reduces
 * spoiler/meta PROSE; it is not, and cannot be, a complete semantic classifier.
 *
 * Invariants:
 *  - No skill ⇒ NO-OP (byte-identical to the legacy path) — Wave-0 safe.
 *  - On a trip, the prose is swapped for the NPC's in-character deflection; the
 *    server's `revealedClueIds` is NEVER touched here.
 *  - Deterministic: deflection choice is integer-pure (mulberry32 over npc.id).
 */
import type { Npc } from "../../shared/case.js";
import { seededPick } from "../../shared/prng.js";
import type { PersonaSkill } from "./personas/types.js";
import { SUSPECT_NAMES } from "./personas/cast.js";

/**
 * Guilt / confession / meta denylist. STEM-based (\w* suffix) so plurals, tenses and
 * possessives are covered (killer/killers/killed, murder/murdering, guilt/guilty), plus
 * common guilt-attribution + AI-meta synonyms. Anchored with \b so "skill" ≠ "kill".
 * This is defence-in-depth, not the primary control (see module docstring).
 */
export const GUILT_META = new RegExp(
  [
    // High-signal guilt/confession nouns + verbs. Deliberately NOT the bare "kill"
    // stem (it false-positives on idioms like "my feet are killin' me"); named
    // accusations like "Sil did it" are caught by the name-token allowlist instead.
    "\\bkillers?\\b", "\\bmurder\\w*", "\\bguilt\\w*", "\\bculprit\\w*",
    "\\bperp(etrator)?s?\\b", "\\bassassins?\\b", "\\bconfess\\w*", "\\bstrangl\\w*",
    "\\bwhodun+it\\b", "\\bsolution\\b", "\\bkillerid\\b",
    // AI / meta self-disclosure.
    "\\bas an ai\\b", "\\bi'?m an ai\\b", "\\bi am an ai\\b", "\\bla?nguage model\\b",
    "\\bllm\\b", "\\bsystem prompt\\b", "\\bmy (instructions|prompt|programming)\\b",
    "\\bi was told to\\b",
  ].join("|"),
  "i",
);

/** Egregious-overflow backstop (capReply still trims to two sentences afterward). */
const MAX_REPLY_LEN = 400;

/** Honorifics dropped when tokenizing a cast name. */
const HONORIFICS = new Set(["det", "mr", "mrs", "ms", "dr", "the"]);
/** Name tokens that collide with everyday words ("don't", "ash(es)") — too noisy to
 *  use as a distinguishing token, so such suspects are matched by full name only. */
const COMMON_TOKENS = new Set(["don", "ash"]);

export interface GuardrailResult {
  reply: string;
  tripped: boolean;
  reason?: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Distinguishing lowercase name tokens (first name + surname), honorifics/short stripped. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\./g, "")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !HONORIFICS.has(t) && !COMMON_TOKENS.has(t));
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRe(word)}\\b`, "i").test(text);
}

/** Deterministic in-character deflection (or a neutral fallback when no skill). */
function pickDeflection(npc: Npc, skill: PersonaSkill | undefined): string {
  return seededPick(`deflect:${npc.id}`, skill?.boundaries.deflectionTemplates ?? []) ?? "They look away and say nothing of use.";
}

/**
 * Validate an LLM reply against the NPC's guardrails. When no skill is present the
 * call is a pure no-op so the legacy path is untouched.
 */
export function applyOutputGuardrail(raw: string, npc: Npc, skill?: PersonaSkill): GuardrailResult {
  if (!skill) return { reply: raw, tripped: false };
  const text = raw.trim();

  const trip = (reason: string): GuardrailResult => ({
    reply: pickDeflection(npc, skill),
    tripped: true,
    reason,
  });

  // 1. guilt / confession / meta / jailbreak-acknowledgement (stem-based)
  if (GUILT_META.test(text)) return trip("guilt_or_meta");

  // 2. relationship allowlist — may not NAME a suspect outside {self} ∪ relationships,
  //    by FULL name OR a distinguishing first-name / surname token. Tokens shared with
  //    an allowed name are ambiguous and do not trip (collision-safe).
  const allowedNames = new Set<string>([npc.id, ...skill.relationships.map((r) => r.npcId)]);
  const allowedTokens = new Set<string>();
  for (const n of allowedNames) for (const t of nameTokens(n)) allowedTokens.add(t);

  for (const name of SUSPECT_NAMES) {
    if (allowedNames.has(name)) continue;
    if (containsWord(text, name)) return trip("named_outside_relationships");
    for (const tok of nameTokens(name)) {
      if (allowedTokens.has(tok)) continue; // shared/ambiguous token — skip
      if (containsWord(text, tok)) return trip("named_outside_relationships");
    }
  }

  // 3. length backstop
  if (text.length > MAX_REPLY_LEN) return trip("overlong");

  return { reply: text, tripped: false };
}
