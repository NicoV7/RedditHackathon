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
 */
import type { Fact, Npc, SliceEntry } from "../../shared/case.js";
import type { LlmProvider } from "../llm/provider.js";

export interface NpcTurnInput {
  npc: Npc;
  /** the instance's facts, for rendering the NPC's slice (NOT the solution) */
  factById: Map<string, Fact>;
  playerMessage: string;
  /** bounded, server-ranked memory context (C19); principal-only */
  memory?: string[];
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
}

/** Render one slice entry to a neutral first-person knowledge line. No guilt info. */
function renderSliceLine(entry: SliceEntry, factById: Map<string, Fact>): string {
  const f = factById.get(entry.factId);
  if (!f) return "";
  const subjectIsSelf = false; // (harness doesn't need self-detection for Wave 1)
  const claim = `${f.subject} had ${f.predicate.replace(/^refutes/, "no ").toLowerCase()}`;
  // statedLie entries are voiced as the NPC's (false) claim — the harness does
  // not annotate truth value in the prompt, so it can't leak who lies/kills.
  void subjectIsSelf;
  return entry.statedAs === "statedLie" ? `You insist: ${claim} is not true.` : `You know: ${claim}.`;
}

/**
 * Assemble the system prompt from persona + slice ONLY. Deterministic and
 * solution-blind: depends solely on (npc, factById, memory).
 */
export function assembleSystemPrompt(npc: Npc, factById: Map<string, Fact>, memory: string[] = []): string {
  const knowledge = npc.slice.map((e) => renderSliceLine(e, factById)).filter(Boolean);
  const mem = memory.length ? ["Recently, you observed:", ...memory.map((m) => `- ${m}`)] : [];
  return [
    `You are ${npc.persona.name}, ${npc.persona.blurb}`,
    `Speak in a ${npc.persona.voice} manner. Answer ONLY from what you personally know.`,
    `You are not omniscient. Do not invent facts. Keep replies to at most two sentences.`,
    ...knowledge,
    ...mem,
  ].join("\n");
}

/** Hard-cap a reply to two sentences (server-side; never trust the model's length). */
export function capReply(text: string, maxSentences = 2): string {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(" ");
}

export async function runNpcTurn(input: NpcTurnInput): Promise<NpcTurnResult> {
  const revealedClueIds = input.serverRevealedClueIds ?? []; // ALWAYS server-authoritative

  // ambient: templated bark, no LLM.
  if (input.npc.tier === "ambient") {
    return { reply: `${input.npc.persona.name} nods, but says little.`, revealedClueIds, usedLlm: false };
  }

  // supporting (or any pre-rendered/cached answer): no live LLM.
  if (input.npc.tier === "supporting" || input.prerendered) {
    return { reply: capReply(input.prerendered ?? "I wouldn't know about that."), revealedClueIds, usedLlm: false };
  }

  // principal free-text: the ONLY runtime LLM path.
  const system = assembleSystemPrompt(input.npc, input.factById, input.memory ?? []);
  const raw = await input.provider.complete({ system, user: input.playerMessage, maxSentences: 2 });
  return { reply: capReply(raw), revealedClueIds, usedLlm: true };
}
