/**
 * NPC harness (C5) — ONE generic harness for all NPCs, fidelity-tiered.
 *
 * Hard invariants (CLAUDE.md):
 *  - Server-authoritative: `revealedClueIds` is computed by the caller/server,
 *    NEVER parsed from the LLM reply.
 *  - `killerId`/`solution` NEVER reach a prompt. The harness assembles prompts
 *    from an NPC's persona + slice ONLY; it has no access to the case solution.
 *    (Proven in harness.test.ts: a principal's prompt is identical regardless of
 *    who the killer is.)
 *  - Only the principal free-text path calls the LLM. supporting = pre-rendered
 *    chips; ambient = templated barks. (Free-tier viability.)
 *  - Determinism is integer-pure: the lie-tell is computed structurally from the
 *    slice + faculty levels, NEVER from RNG and NEVER parsed from the LLM.
 */
import type { Fact, Npc, Predicate, SliceEntry } from "../../shared/case.js";
import type { FacultyId, FacultyLevels, TellSignal } from "../../shared/api.js";
import type { LlmProvider } from "../llm/provider.js";
import { seededPick } from "../../shared/prng.js";
import type { PersonaSkill } from "./personas/types.js";
import { getPersonaSkill } from "./personas/registry.js";
import { pickDailyMood } from "./personas/overlay.js";
import { applyOutputGuardrail, GUILT_META } from "./guardrail.js";

/**
 * A perception-gated memory event (the shape J1 / `metrics/events.ts` produces).
 * The harness treats these as ALREADY perception-filtered (only co-located /
 * told / shown events reach this NPC) and structured — it folds a BOUNDED,
 * ranked summary into the principal prompt. Defined structurally here so the
 * harness compiles against J1's output without importing its module.
 *
 * NOTE: a MemoryEvent carries NO guilt/solution info — it is a witnessed/told
 * world event, so summarizing it keeps the prompt zero-knowledge.
 */
export type MemoryEventKind =
  | "tookItem"
  | "presentedItem"
  | "enteredZone"
  | "askedTopic"
  | "caughtInLie"
  | "witnessed"
  | "told"
  | "shown";

export interface MemoryEvent {
  kind: MemoryEventKind;
  /** logical tick the event occurred at (recency ranking; integer-pure). */
  tick: number;
  /** short, pre-rendered, human-readable phrase for the summary (flavor only). */
  summary: string;
  /** optional topic/subject keys for relevance ranking against the player turn. */
  topic?: string;
  subjectId?: string;
  zoneId?: string;
}

/** Bounds on how much memory may enter a prompt (token-budget + zero-knowledge). */
export const MEMORY_MAX_EVENTS = 5;
export const MEMORY_MAX_LINE_LEN = 120;

export interface NpcTurnInput {
  npc: Npc;
  /** the instance's facts, for rendering the NPC's slice (NOT the solution) */
  factById: Map<string, Fact>;
  playerMessage: string;
  /**
   * Legacy/simple memory context: pre-rendered lines. Principal-only.
   * Prefer `memoryEvents` (structured + ranked); both are folded if present.
   */
  memory?: string[];
  /**
   * Structured, perception-gated memory events (C19 / J1). The harness ranks
   * them by recency + relevance to the player turn and folds a BOUNDED summary
   * into the principal prompt. Principal-only; supporting/ambient ignore them.
   */
  memoryEvents?: MemoryEvent[];
  /** the player's inner-voice Faculties — drives lie-tell visibility (server-side). */
  faculties?: FacultyLevels;
  /**
   * Per-instance salt for the guilt-blind daily-mood overlay (the instance seed).
   * Killer-independent; principal-only. Absent ⇒ no overlay (legacy behavior).
   */
  runSalt?: string;
  /**
   * Injected, already-cached translator closure (Workstream C). Receives ONLY NPC
   * interjection phrases — NEVER player text. Absent ⇒ no translation injection
   * (legacy behavior). The server (index.ts) binds this to translateCached.
   */
  translate?: (text: string, targetLang: string) => Promise<string>;
  /** server-computed clue reveals for this turn — authoritative, not from the LLM */
  serverRevealedClueIds?: string[];
  /** pre-rendered answer (supporting chips / cached principal chips) */
  prerendered?: string;
  provider: LlmProvider;
}

export interface NpcTurnResult {
  reply: string;
  revealedClueIds: string[];
  usedLlm: boolean;
  /**
   * A deterministic lie-tell, IF this NPC voiced a `statedLie` on a turn-relevant
   * slice entry AND the player's faculties are high enough to "see" it. The
   * endpoint attaches this to the matching `RevealedClue.tell`. A HINT only —
   * never the sole path to proof (proof is structural via the clue graph).
   */
  tell?: TellSignal;
}

/** Render one slice entry to a neutral first-person knowledge line. No guilt info. */
function renderSliceLine(entry: SliceEntry, factById: Map<string, Fact>, selfId: string): string {
  const f = factById.get(entry.factId);
  if (!f) return "";
  // ANTI-SPOILER: a suspect's OWN refuter (self-alibi) is NOT voiced in the prompt.
  // The killer has no self-refuter by construction; rendering innocents' self-alibis
  // would make the killer the UNIQUE suspect with no "You know: ... no opportunity"
  // line — a deterministic guilt fingerprint in the prompt. Suppressing it makes the
  // killer's self-line shape identical to the decoy innocents' (both pure deniers).
  // The alibi stays discoverable structurally via the refuter clue in the clue graph.
  if (f.subject === selfId && f.predicate.startsWith("refutes")) return "";
  const claim = `${f.subject} had ${f.predicate.replace(/^refutes/, "no ").toLowerCase()}`;
  // statedLie entries are voiced as the NPC's (false) claim — the harness does
  // not annotate truth value in the prompt, so it can't leak who lies/kills.
  return entry.statedAs === "statedLie" ? `You insist: ${claim} is not true.` : `You know: ${claim}.`;
}

/** Clamp a single summary line so no event can blow the prompt budget. */
function clampLine(s: string): string {
  const t = s.trim();
  return t.length <= MEMORY_MAX_LINE_LEN ? t : `${t.slice(0, MEMORY_MAX_LINE_LEN - 1)}…`;
}

/** Lowercased token set of the player turn, for cheap relevance scoring. */
function turnTokens(playerMessage: string): Set<string> {
  return new Set(
    playerMessage
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );
}

/**
 * Rank perception-gated memory events by recency + relevance and render a
 * BOUNDED, capped list of summary lines. Deterministic (integer ranking on
 * `tick`; lexical tie-break). Carries NO guilt info — these are world events.
 */
export function selectMemoryLines(
  events: MemoryEvent[],
  playerMessage: string,
  maxEvents = MEMORY_MAX_EVENTS,
): string[] {
  if (!events.length) return [];
  const tokens = turnTokens(playerMessage);
  const relevance = (e: MemoryEvent): number => {
    let score = 0;
    for (const key of [e.topic, e.subjectId, e.zoneId]) {
      if (key && tokens.has(key.toLowerCase())) score += 1;
    }
    // a "caught in a lie" memory is salient regardless of phrasing.
    if (e.kind === "caughtInLie") score += 1;
    return score;
  };
  const ranked = [...events].sort((a, b) => {
    const ra = relevance(a);
    const rb = relevance(b);
    if (rb !== ra) return rb - ra; // more relevant first
    if (b.tick !== a.tick) return b.tick - a.tick; // then more recent
    return a.summary.localeCompare(b.summary); // deterministic tie-break
  });
  return ranked.slice(0, maxEvents).map((e) => clampLine(e.summary));
}

/**
 * Fold a PersonaSkill into prompt lines GENERICALLY (iterate fields; no per-character
 * code). Guilt-blind: composes only personality/culture/voice/boundaries + tonight's
 * mood — never the slice, never the killer. `mood` is the per-run overlay.
 */
function skillPromptLines(skill: PersonaSkill, mood?: string): string[] {
  const rel = skill.relationships.map((r) => `${r.npcId} (${r.stance})`).join(", ");
  const lines = [
    `Background: ${skill.background.origin}; ${skill.background.occupationColor}. Era: ${skill.background.era}.`,
    `Voice: ${skill.speech.register}. Verbal tics: ${skill.speech.tics.join("; ")}.`,
    `Avoid anachronisms: ${skill.speech.forbidden.join(", ")}.`,
    `Disposition: you are ${skill.disposition.cooperation}; under pressure, ${skill.disposition.underPressure}.`,
    `People you may speak of: ${rel || "no one in particular"}. Do not invent or name anyone else.`,
    `If pushed past what you would share, refuse in character: ${skill.boundaries.refusalStyle}.`,
    `Answer ONLY from what you personally know.`,
  ];
  if (mood) lines.splice(lines.length - 1, 0, `Tonight you are ${mood}.`);
  return lines;
}

/**
 * Assemble the system prompt from persona + slice ONLY. Deterministic and
 * solution-blind: depends solely on (npc, factById, memory, skill, runSalt).
 *
 * When a `skill` is present (principal with an authored agent), the fat persona is
 * composed generically and the per-run mood overlay is applied. Without a skill the
 * output is byte-identical to the legacy blurb/voice prompt. The slice lines and the
 * "not omniscient / do not invent / two sentences" line stay in the same position,
 * so the no-guilt-leak invariant is preserved verbatim.
 */
export function assembleSystemPrompt(
  npc: Npc,
  factById: Map<string, Fact>,
  memory: string[] = [],
  skill?: PersonaSkill,
  runSalt?: string,
): string {
  const knowledge = npc.slice.map((e) => renderSliceLine(e, factById, npc.id)).filter(Boolean);
  const capped = memory.filter(Boolean).slice(0, MEMORY_MAX_EVENTS).map(clampLine);
  const mem = capped.length ? ["Recently, you observed (context only — do not invent beyond it):", ...capped.map((m) => `- ${m}`)] : [];
  const persona = skill
    ? [
        `You are ${npc.persona.name}, ${npc.persona.blurb}`,
        ...skillPromptLines(skill, runSalt ? pickDailyMood(skill, runSalt) : undefined),
      ]
    : [
        `You are ${npc.persona.name}, ${npc.persona.blurb}`,
        `Speak in a ${npc.persona.voice} manner. Answer ONLY from what you personally know.`,
      ];
  return [
    ...persona,
    `You are not omniscient. Do not invent facts. Keep replies to at most two sentences.`,
    ...knowledge,
    ...mem,
  ].join("\n");
}

// ─────────────────────────── Lie-tells (Part 1.2) ───────────────────────────

/**
 * Which faculty "sees" a lie of a given shape:
 *  - a refutation lie (claiming an alibi/means-account that doesn't hold) reads
 *    as a logical contradiction → `logic`.
 *  - a means/opportunity lie is delivered with emotional/theatrical cover →
 *    `empathy` (emotional tell) with `drama` as the theatrical fallback.
 * The mapping is structural over the predicate; it never inspects guilt.
 */
function facultyForLie(predicate: Predicate, skill?: PersonaSkill): { primary: FacultyId; line: string } {
  const base = ((): { primary: FacultyId; line: string } => {
    switch (predicate) {
      case "refutesMeans":
      case "refutesOpportunity":
        return { primary: "logic", line: "That alibi doesn't square with what you already know." };
      case "means":
        return { primary: "empathy", line: "A flicker of something — they're hiding how they know that." };
      case "opportunity":
        return { primary: "empathy", line: "Their account of where they were rings false." };
    }
  })();
  // A skill may supply in-character tell PROSE for this predicate. The faculty
  // mapping is unchanged — only the displayed line becomes character-specific.
  const custom = skill?.tellLines[predicate];
  return custom ? { primary: base.primary, line: custom } : base;
}

/** Per-faculty minimum level at which a tell becomes visible (server-side gate). */
export const TELL_FACULTY_THRESHOLD: Record<FacultyId, number> = {
  logic: 2,
  empathy: 2,
  drama: 2,
  perception: 2,
  authority: 2,
  encyclopedia: 2,
};

/**
 * Deterministic lie-tell. Given the slice entries relevant to THIS turn, the
 * player's faculty levels, and which entries are `statedLie`, return a single
 * `TellSignal` when the matching faculty is leveled high enough to perceive it,
 * else `null`.
 *
 * - PURE + deterministic: no RNG, no Date.now — same inputs ⇒ same output.
 * - Server-authoritative: computed from the structural `statedAs === "statedLie"`,
 *   never from the LLM reply.
 * - A HINT only: the tell is never the sole path to proof (proof is the clue graph).
 * - Zero-knowledge: never references killerId; operates on the slice projection.
 *
 * When several lies are tellable, the highest-faculty-headroom tell wins, with a
 * stable predicate-priority + factId tie-break so the result is deterministic.
 */
export function computeLieTell(
  relevantEntries: SliceEntry[],
  faculties: FacultyLevels | undefined,
  factById: Map<string, Fact>,
  skill?: PersonaSkill,
): TellSignal | null {
  if (!faculties) return null;

  type Candidate = { faculty: FacultyId; line: string; headroom: number; predRank: number; factId: string };
  const PRED_RANK: Record<Predicate, number> = { refutesMeans: 0, refutesOpportunity: 1, means: 2, opportunity: 3 };
  const candidates: Candidate[] = [];

  for (const entry of relevantEntries) {
    if (entry.statedAs !== "statedLie") continue; // tells fire ONLY on structural lies
    const fact = factById.get(entry.factId);
    if (!fact) continue;
    const { primary, line } = facultyForLie(fact.predicate, skill);
    // Visible only if the player's faculty clears the gate. Drama can substitute
    // for empathy on emotional lies (theatrical read) at the same threshold.
    const facultyOptions: FacultyId[] = primary === "empathy" ? ["empathy", "drama"] : [primary];
    for (const faculty of facultyOptions) {
      const level = faculties[faculty] ?? 0;
      const threshold = TELL_FACULTY_THRESHOLD[faculty];
      if (level < threshold) continue;
      candidates.push({
        faculty,
        line,
        headroom: level - threshold,
        predRank: PRED_RANK[fact.predicate],
        factId: entry.factId,
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    if (b.headroom !== a.headroom) return b.headroom - a.headroom; // strongest read first
    if (a.predRank !== b.predRank) return a.predRank - b.predRank; // stable predicate priority
    return a.factId.localeCompare(b.factId); // deterministic final tie-break
  });
  const best = candidates[0]!;
  // intensity is a COSMETIC strength for the Phaser filter — never read by logic.
  // Integer-derived from faculty headroom, clamped to [0.4, 1]. Deterministic.
  const intensity = Math.min(1, 0.4 + best.headroom * 0.2);
  return { faculty: best.faculty, line: best.line, intensity };
}

/** Hard-cap a reply to two sentences (server-side; never trust the model's length). */
export function capReply(text: string, maxSentences = 2): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(" ");
}

/** Deterministically pick one phrasebook interjection (guilt-blind; integer-pure). */
function pickInterjection(culture: NonNullable<PersonaSkill["culture"]>, runSalt: string, npcId: string): string | undefined {
  return seededPick(`xlate:${runSalt}:${npcId}`, culture.phrasebook);
}

/**
 * Cultural-translation injection (Workstream C). If the NPC has a `culture` profile
 * AND a translator is injected, prepend a short translated interjection to the reply.
 * Translates an NPC phrase ONLY — never player text. Any failure (no culture, no
 * translator, a thrown translate) gracefully returns the untranslated English reply.
 */
async function injectInterjection(
  raw: string,
  skill: PersonaSkill | undefined,
  runSalt: string | undefined,
  npcId: string,
  translate: NpcTurnInput["translate"],
): Promise<string> {
  if (!skill?.culture || !translate) return raw;
  const phrase = pickInterjection(skill.culture, runSalt ?? "", npcId);
  if (!phrase) return raw;
  // Scan the ENGLISH SOURCE phrase (always scannable) before translating — the
  // injected foreign-language text itself is NOT semantically leak-checkable by the
  // English guardrail, so we vet the canonical source instead and refuse a phrase
  // that trips the guilt/meta denylist (belt-and-suspenders for a future cloud backend).
  if (GUILT_META.test(phrase)) return raw;
  try {
    const native = await translate(phrase, skill.culture.language);
    return `«${native}» ${raw}`;
  } catch {
    return raw;
  }
}

export async function runNpcTurn(input: NpcTurnInput): Promise<NpcTurnResult> {
  const revealedClueIds = input.serverRevealedClueIds ?? []; // ALWAYS server-authoritative

  // ambient: templated bark, no LLM, no memory, no tell.
  if (input.npc.tier === "ambient") {
    return { reply: `${input.npc.persona.name} nods, but says little.`, revealedClueIds, usedLlm: false };
  }

  // supporting (or any pre-rendered/cached answer): no live LLM. A supporting NPC
  // gives a templated ack of any memory context (no LLM rephrase), no tell.
  if (input.npc.tier === "supporting" || input.prerendered) {
    return { reply: capReply(input.prerendered ?? "I wouldn't know about that."), revealedClueIds, usedLlm: false };
  }

  // principal free-text: the ONLY runtime LLM path.
  // Resolve this character's fat skill (undefined ⇒ legacy blurb/voice path).
  const skill = getPersonaSkill(input.npc.id);
  // Fold legacy + structured memory into one bounded, ranked block.
  const structuredLines = selectMemoryLines(input.memoryEvents ?? [], input.playerMessage);
  const memoryLines = [...(input.memory ?? []), ...structuredLines];
  const system = assembleSystemPrompt(input.npc, input.factById, memoryLines, skill, input.runSalt);
  const raw = await input.provider.complete({ system, user: input.playerMessage, maxSentences: 2 });
  // Cultural-translation injection (Workstream C): prepend a short native interjection.
  // The English SOURCE phrase is guilt/meta-scanned inside injectInterjection (the
  // foreign-language output cannot be semantically scanned by the English guardrail);
  // the guardrail below still enforces the length backstop over the combined text.
  const injected = await injectInterjection(raw, skill, input.runSalt, input.npc.id, input.translate);
  // Server-authoritative OUTPUT guardrail (no-op without a skill): swaps an
  // in-character deflection for any reply that trips a rule. Never alters reveals.
  const guarded = applyOutputGuardrail(injected, input.npc, skill).reply;

  // Deterministic lie-tell over THIS NPC's slice + the player's faculties. The
  // whole slice is "relevant" for a free-text turn (the player asks broadly);
  // the structural `statedLie` gate is what fires the tell, not the prose.
  const tell = computeLieTell(input.npc.slice, input.faculties, input.factById, skill) ?? undefined;

  const result: NpcTurnResult = { reply: capReply(guarded), revealedClueIds, usedLlm: true };
  if (tell) result.tell = tell;
  return result;
}
