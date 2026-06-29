/**
 * Server endpoints (C7 surface). Framework-agnostic handlers wired to the
 * verified core (C2/C3/C5/C6/C17) plus the B1 foundation (detective sheet,
 * perception-gated memory, lie-tells, save/resume). The Devvit runtime adapter
 * injects the real Redis + LLM provider; everything here is deterministic and
 * testable.
 *
 * Security: the instance is re-derived server-side from (dailySeed, playerId);
 * only sanitized views (shared/api.ts) and server-revealed clues leave the server.
 * Control data (revealed clue ids, tells, win/lose, gate) is computed server-side
 * from the typed graph — NEVER parsed out of an LLM reply. killerId never leaves
 * the server until the game is over (accuse summary).
 */
import type { CaseInstance, CaseTemplate, Clue, Fact, Npc } from "../shared/case.js";
import type * as Api from "../shared/api.js";
import { drawInstance, generateTemplate } from "./case/procedural.js";
import { runNpcTurn, type MemoryEvent } from "./npc/harness.js";
import { MockProvider, type LlmProvider } from "./llm/provider.js";
import type { RedisLike } from "./redis/redis.js";
import { FakeRedis, TTL_30D } from "./redis/redis.js";
import { accuse as sessionAccuse } from "./game/session.js";
import {
  logPlayerEvent,
  recentEventsForNpc,
  recordNomination,
  snapshotDailyStats,
} from "./metrics/events.js";
import {
  awardDetectiveXp,
  getDetective,
  loadCaseState,
  loadPlayerScope,
  purgePlayer,
  recordDetectiveOutcome,
  recordPlayerScope,
  resolveResume,
  saveCaseState,
  type CaseSaveState,
  type PlayerScope,
} from "./redis/repos.js";
import { witnessesAt } from "./world/perception.js";

/** How a (dailySeed, playerId) maps to a server-side case. Defaults to the real
 *  generator; tests may inject a fixture instance (e.g. with present-reactions or a
 *  statedLie) without touching the contract or the generator. */
export type DeriveInstanceFn = (dailySeed: string, playerId: string) => { template: CaseTemplate; instance: CaseInstance };

export interface ServerDeps {
  redis: RedisLike;
  provider: LlmProvider;
  /** Optional instance-derivation override (test seam). Default = real generator. */
  deriveInstance?: DeriveInstanceFn;
}

/** Default local deps (sandbox/dev). Devvit runtime injects real redis + key. */
export function defaultDeps(): ServerDeps {
  return { redis: new FakeRedis(), provider: new MockProvider((r) => `(${r.user.slice(0, 20)}…) I really couldn't say.`) };
}

function defaultDeriveInstance(dailySeed: string, playerId: string): { template: CaseTemplate; instance: CaseInstance } {
  const template = generateTemplate(dailySeed);
  return { template, instance: drawInstance(template, playerId) }; // quirks default-on
}

function renderFact(f: Fact, npcsById: Map<string, string>): string {
  const who = npcsById.get(f.subject) ?? f.subject;
  switch (f.predicate) {
    case "means": return `${who} had the means.`;
    case "opportunity": return `${who} had the opportunity.`;
    case "refutesMeans": return `${who} couldn't have had the means.`;
    case "refutesOpportunity": return `${who} has a verified alibi.`;
  }
}

/** A short templated reformat the notetaker pins as a board node (server-authored). */
function noteFor(clue: Clue, instance: CaseInstance, npcsById: Map<string, string>): string {
  const f = instance.facts.find((x) => clue.revealsFactIds.includes(x.id));
  if (!f) return "A detail worth pinning.";
  const who = npcsById.get(f.subject) ?? f.subject;
  switch (f.predicate) {
    case "means": return `Means: ${who} could have done it.`;
    case "opportunity": return `Opportunity: ${who} was unaccounted for.`;
    case "refutesMeans": return `Cleared: ${who} lacked the means.`;
    case "refutesOpportunity": return `Alibi: ${who} is accounted for.`;
  }
}

/** The NPC an askTopic clue is sourced from (drives the notetaker → board edge). */
function clueSourceNpcId(clue: Clue): string | undefined {
  return clue.unlockedBy.kind === "askTopic" ? clue.unlockedBy.npcId : undefined;
}

function clueToRevealed(
  instance: CaseInstance,
  clue: Clue,
  npcsById: Map<string, string>,
  opts?: { sourceNpcId?: string; tell?: Api.TellSignal },
): Api.RevealedClue {
  const text = clue.revealsFactIds
    .map((id) => instance.facts.find((f) => f.id === id))
    .filter((f): f is Fact => !!f)
    .map((f) => renderFact(f, npcsById))
    .join(" ");
  const out: Api.RevealedClue = {
    id: clue.id,
    text,
    noteText: noteFor(clue, instance, npcsById),
  };
  const src = opts?.sourceNpcId ?? clueSourceNpcId(clue);
  if (src) out.sourceNpcId = src;
  if (opts?.tell) out.tell = opts.tell;
  return out;
}

/** Map a LoggedEvent (J1) into the harness's structural MemoryEvent shape. */
function toMemoryEvent(e: { kind: MemoryEvent["kind"]; tick: number; summary: string; subjectId?: string; zone: string }): MemoryEvent {
  const m: MemoryEvent = { kind: e.kind, tick: e.tick, summary: e.summary, zoneId: e.zone };
  if (e.subjectId) m.subjectId = e.subjectId;
  return m;
}

// ── confidence gate (Part 1.5) ──────────────────────────────────────────────
/**
 * Count how many of the player's discovered clues are SOLUTION edges (the killer's
 * means+opportunity supporting clues). Pure & server-side; the client never sees
 * `solution`. This is the structural "confidence" metric the accuse gate checks.
 */
function solutionEdgesDiscovered(instance: CaseInstance, discoveredClueIds: readonly string[]): number {
  const solutionSet = new Set(instance.solution.supportingClueIds);
  const seen = new Set<string>();
  let n = 0;
  for (const id of discoveredClueIds) {
    if (solutionSet.has(id) && !seen.has(id)) {
      seen.add(id);
      n++;
    }
  }
  return n;
}

/** The current logical tick for a player+case (drives perception). Stored per-run;
 *  integer-pure (callers pass ticks; we never read a clock). Defaults to 0. */
const tickKey = (caseId: string, playerId: string) => `tick:${caseId}:${playerId}`;

/**
 * Hard server-side ceiling on free-text interrogation input (CLAUDE.md: "bounded
 * free-text"). Anything longer is truncated BEFORE it reaches moderation or the LLM,
 * so the principal-tier rephrase call can never be driven by unbounded input. Pure
 * (no allocation beyond the slice); exported for the unit test.
 */
export const MAX_INTERROGATION_CHARS = 280;
export function boundInterrogationMessage(message: string): { message: string; truncated: boolean } {
  if (message.length <= MAX_INTERROGATION_CHARS) return { message, truncated: false };
  return { message: message.slice(0, MAX_INTERROGATION_CHARS), truncated: true };
}

export function createHandlers(deps: ServerDeps) {
  const deriveInstance = deps.deriveInstance ?? defaultDeriveInstance;
  const npcNames = (instance: CaseInstance) => new Map(instance.npcs.map((n) => [n.id, n.persona.name]));

  /** Resolve the tick an action happens at: an explicit caller tick, else the last
   *  recorded logical tick for this player+case (set by /move), else 0. */
  async function resolveTick(caseId: string, playerId: string, explicit?: number): Promise<number> {
    if (typeof explicit === "number" && Number.isFinite(explicit)) return Math.max(0, Math.floor(explicit));
    const raw = await deps.redis.get(tickKey(caseId, playerId));
    return raw ? Math.max(0, Math.floor(Number(raw))) : 0;
  }

  /** The zone an NPC is in (for perception of NPC-targeted actions like present). */
  function npcZone(npc: Npc, tick: number): string {
    for (const step of npc.routine) if (tick >= step.fromTick && tick < step.toTick) return step.zoneId;
    return npc.homeZone;
  }

  return {
    async startCase(req: Api.StartCaseRequest, playerId: string): Promise<Api.StartCaseResponse> {
      const { template, instance } = deriveInstance(req.dailySeed, playerId);
      void playerId;
      return {
        view: {
          caseId: template.id,
          dailySeed: req.dailySeed,
          setting: template.setting,
          victim: template.victim,
          map: template.map,
          suspectIds: instance.suspectIds,
          npcs: instance.npcs.map((n) => ({ id: n.id, name: n.persona.name, blurb: n.persona.blurb, voice: n.persona.voice, tier: n.tier, homeZone: n.homeZone, routine: n.routine })),
          items: instance.items.map((i) => ({ id: i.id, kind: i.kind, zone: i.zone, coords: i.coords })),
        },
      };
    },

    async interrogate(req: Api.InterrogateRequest, playerId: string): Promise<Api.InterrogateResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      const npc = instance.npcs.find((n) => n.id === req.npcId);
      if (!npc) throw new Error("unknown npc");

      // Bound the free-text BEFORE moderation/LLM (compliance: no unbounded input).
      const bounded = boundInterrogationMessage(req.message);
      const message = bounded.message;

      // Record this case+npc in the player's deletion-scope index (purge-on-delete).
      await recordPlayerScope(deps.redis, playerId, { caseIds: [instance.templateId], caseNpcIds: { [instance.templateId]: [npc.id] } });

      const mod = await deps.provider.moderate(message);
      if (mod.flagged) return { reply: "The suspect ignores your outburst.", revealed: [], moderated: true };

      const names = npcNames(instance);
      const factById = new Map(instance.facts.map((f) => [f.id, f]));

      // Server-authoritative reveals: clues this NPC surfaces (askTopic on them).
      const myClues = instance.clues.filter((c) => c.unlockedBy.kind === "askTopic" && c.unlockedBy.npcId === npc.id);

      // The player's persistent detective faculties drive the lie-tell visibility.
      const detective = await getDetective(deps.redis, playerId);

      // Perception-gated, recency-ranked memory the NPC actually witnessed (J1 RAG).
      const logged = await recentEventsForNpc(deps.redis, playerId, instance.templateId, npc.id);
      const memoryEvents = logged.map(toMemoryEvent);

      const turn = await runNpcTurn({
        npc,
        factById,
        playerMessage: message,
        serverRevealedClueIds: myClues.map((c) => c.id),
        faculties: detective.faculties,
        memoryEvents,
        provider: deps.provider,
      });

      // Log this question as a perception-gated event (witnesses = co-located NPCs).
      const tick = await resolveTick(instance.templateId, playerId, undefined);
      const witnessedBy = witnessesAt(instance.npcs, npc.homeZone, tick);
      await logPlayerEvent(deps.redis, playerId, instance.templateId, {
        kind: "askedTopic",
        tick,
        zone: npcZone(npc, tick),
        subjectId: npc.id,
        summary: `The detective questioned ${npc.persona.name}.`,
        witnessedBy,
      });

      // Attach the lie-tell to the clue the NPC surfaced (a HINT; proof is structural).
      const revealed = myClues.map((c, i) =>
        clueToRevealed(instance, c, names, { sourceNpcId: npc.id, tell: i === 0 ? turn.tell : undefined }),
      );

      // XP: noticing a tell is a small empathy/logic reward (faculties grow with use).
      if (turn.tell) {
        await awardDetectiveXp(deps.redis, playerId, { xp: 5, facultyXp: { [turn.tell.faculty]: 10 } });
      }

      return { reply: turn.reply, revealed };
    },

    async examine(req: Api.ExamineRequest, playerId: string): Promise<Api.ExamineResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      const item = instance.items.find((i) => i.id === req.itemId);
      if (!item) throw new Error("unknown item");
      const names = npcNames(instance);
      const revealed: Api.RevealedClue[] = instance.clues
        .filter((c) => c.unlockedBy.kind === "inspectItem" && c.unlockedBy.itemId === item.id)
        .map((c) => clueToRevealed(instance, c, names));

      // Picking up / inspecting an item is a perceptible world event.
      const tick = await resolveTick(instance.templateId, playerId, undefined);
      const witnessedBy = witnessesAt(instance.npcs, item.zone, tick);
      await recordPlayerScope(deps.redis, playerId, { caseIds: [instance.templateId], caseNpcIds: { [instance.templateId]: witnessedBy } });
      await logPlayerEvent(deps.redis, playerId, instance.templateId, {
        kind: "tookItem",
        tick,
        zone: item.zone,
        subjectId: item.id,
        summary: `The detective examined an item in ${item.zone}.`,
        witnessedBy,
      });

      return { examineText: item.examineText, revealed };
    },

    async present(req: Api.PresentRequest, playerId: string): Promise<Api.PresentResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      const item = instance.items.find((i) => i.id === req.itemId);
      if (!item) throw new Error("unknown item");
      const npc = instance.npcs.find((n) => n.id === req.npcId);
      if (!npc) throw new Error("unknown npc");
      const names = npcNames(instance);

      // Server-authoritative gotcha: fire THIS item's present-reactions for THIS NPC.
      // Reveals are the union of (a) the item's pre-authored presentReactions for the
      // NPC and (b) any presentItemTo clue keyed to (itemId, npcId). Never from prose.
      const reactionFacts = item.presentReactions
        .filter((pr) => pr.npcId === npc.id)
        .flatMap((pr) => pr.revealsFactIds);

      const presentClues = instance.clues.filter(
        (c) => c.unlockedBy.kind === "presentItemTo" && c.unlockedBy.itemId === item.id && c.unlockedBy.npcId === npc.id,
      );

      // Synthesize a stable, deterministic revealed-clue id for raw presentReactions
      // that have no backing Clue node (so the board still gets a node).
      const revealed: Api.RevealedClue[] = [
        ...presentClues.map((c) => clueToRevealed(instance, c, names, { sourceNpcId: npc.id })),
        ...reactionFacts
          .filter((fid) => !presentClues.some((c) => c.revealsFactIds.includes(fid)))
          .map((fid) => {
            const f = instance.facts.find((x) => x.id === fid);
            const synthetic: Clue = { id: `present_${item.id}_${npc.id}_${fid}`, revealsFactIds: [fid], unlockedBy: { kind: "presentItemTo", itemId: item.id, npcId: npc.id } };
            void f;
            return clueToRevealed(instance, synthetic, names, { sourceNpcId: npc.id });
          }),
      ];

      // "Caught in a lie" iff a revealed fact REFUTES (the gotcha contradicts a claim).
      const refuted = revealed.some((r) => /Cleared|Alibi/.test(r.noteText ?? "") || /couldn't|verified alibi/.test(r.text));

      const tick = await resolveTick(instance.templateId, playerId, req.tick);
      const zone = npcZone(npc, tick);
      const witnessedBy = witnessesAt(instance.npcs, zone, tick);
      await recordPlayerScope(deps.redis, playerId, { caseIds: [instance.templateId], caseNpcIds: { [instance.templateId]: [npc.id, ...witnessedBy] } });
      await logPlayerEvent(deps.redis, playerId, instance.templateId, {
        kind: "presentedItem",
        tick,
        zone,
        subjectId: item.id,
        summary: `The detective showed ${npc.persona.name} an item.`,
        witnessedBy,
      });
      if (refuted) {
        await logPlayerEvent(deps.redis, playerId, instance.templateId, {
          kind: "caughtInLie",
          tick,
          zone,
          subjectId: npc.id,
          summary: `${npc.persona.name} was caught contradicting themselves.`,
          witnessedBy,
        });
        // Proving a contradiction is a logic XP reward (Part 1.3).
        await awardDetectiveXp(deps.redis, playerId, { xp: 15, facultyXp: { logic: 15 } });
      }

      const reactionText = revealed.length
        ? `${npc.persona.name} stiffens — the item clearly means something.`
        : `${npc.persona.name} glances at it and shrugs. "Never seen it."`;
      return { reactionText, revealed, caughtInLie: refuted };
    },

    async move(req: Api.MoveRequest, playerId: string): Promise<Api.MoveResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      const tick = Math.max(0, Math.floor(req.tick));
      // Record the player's logical position/tick (drives perception for later actions).
      const tk = tickKey(instance.templateId, playerId);
      await deps.redis.set(tk, String(tick));
      await deps.redis.expire(tk, TTL_30D); // compliance: ≤30d TTL on EVERY key class
      const witnessedBy = witnessesAt(instance.npcs, req.zoneId, tick);
      // Index this case (+ witnesses) for purge-on-delete.
      await recordPlayerScope(deps.redis, playerId, { caseIds: [instance.templateId], caseNpcIds: { [instance.templateId]: witnessedBy } });
      await logPlayerEvent(deps.redis, playerId, instance.templateId, {
        kind: "enteredZone",
        tick,
        zone: req.zoneId,
        subjectId: req.zoneId,
        summary: `The detective entered ${req.zoneId}.`,
        witnessedBy,
      });
      return { zoneId: req.zoneId, witnessedBy };
    },

    async saveState(req: Api.SaveStateRequest, playerId: string): Promise<Api.SaveStateResponse> {
      const state: CaseSaveState = {
        posZone: req.posZone,
        boardGraph: req.boardGraph,
        inventory: req.inventory,
        transcriptRef: req.transcriptRef,
        questionsUsed: req.questionsUsed,
        elapsedMs: req.elapsedMs,
        facultyXp: req.facultyXp ?? {},
      };
      await saveCaseState(deps.redis, playerId, req.dayId, state);
      // Index this dayId for purge-on-delete (saved sessions are per (player,dayId)).
      await recordPlayerScope(deps.redis, playerId, { dayIds: [req.dayId] });
      return { ok: true };
    },

    async resume(req: Api.ResumeRequest, playerId: string): Promise<Api.ResumeResponse> {
      const decision = await resolveResume(deps.redis, playerId, req.dayId);
      // resolveResume returns today's save if present; if not, the prior day is forfeit.
      const saved = decision.state ?? (await loadCaseState(deps.redis, playerId, req.dayId));
      return {
        state: saved
          ? {
              posZone: saved.posZone,
              boardGraph: saved.boardGraph,
              inventory: saved.inventory,
              transcriptRef: saved.transcriptRef,
              questionsUsed: saved.questionsUsed,
              elapsedMs: saved.elapsedMs,
              facultyXp: saved.facultyXp,
            }
          : null,
        readOnly: decision.readOnly,
        startFresh: decision.startFresh,
      };
    },

    async detective(_req: Api.DetectiveRequest, playerId: string): Promise<Api.DetectiveResponse> {
      return { detective: await getDetective(deps.redis, playerId) };
    },

    /**
     * Honor deletions (compliance). The Devvit runtime fires Account/Post/Comment
     * delete triggers; the adapter resolves the deleting Reddit user to our internal
     * `playerId` and calls this. We read the player's accumulated deletion-scope index
     * (caseIds/dayIds/caseNpcIds — populated as they played) and purge every per-player
     * key class, then drop the index itself. Idempotent: a re-fired or scope-less
     * trigger still clears the single-owner keys. Returns the resolved scope for logs.
     */
    async handleDeleteTrigger(playerId: string): Promise<{ purged: true; scope: PlayerScope }> {
      const scope = await loadPlayerScope(deps.redis, playerId);
      await purgePlayer(deps.redis, playerId, scope);
      return { purged: true, scope };
    },

    async nominate(req: Api.NominateRequest): Promise<Api.NominateResponse> {
      if (req.role === "killer" || req.role === "suspect") {
        await recordNomination(deps.redis, req.caseId, req.role, req.npcId);
      }
      return { ok: true };
    },

    async accuse(req: Api.AccuseRequest, playerId: string, today: string): Promise<Api.AccuseResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      // Index this case for purge-on-delete (leaderboard + per-case state written below).
      await recordPlayerScope(deps.redis, playerId, { caseIds: [req.caseId] });

      // ── SERVER-SIDE CONFIDENCE GATE (Part 1.5) ──
      // The player must have (a) tagged a killer AND (b) discovered ≥ N solution-edge
      // clues (default N = solution.supportingClueIds.length). Computed server-side
      // from the typed graph — the client never sees `solution`. A premature accuse is
      // REJECTED with no state change (spoiler-safe: no killerName leaked).
      const killerTagged = req.nominations[req.nominatedKillerId] === "killer";
      const needed = instance.solution.supportingClueIds.length;
      const have = solutionEdgesDiscovered(instance, req.discoveredClueIds);
      if (!killerTagged || have < needed) {
        const stats = await snapshotDailyStats(deps.redis, req.caseId);
        return {
          solved: false,
          score: 0,
          rank: null,
          streak: { count: 0, freeze: 0 },
          summary: {
            killerName: "", // spoiler-safe: no reveal on a rejected accusation
            yourClueCount: req.discoveredClueIds.length,
            crowd: { total: stats.total, killerRightPct: stats.total ? Math.round((stats.killerRight / stats.total) * 100) : 0 },
          },
          gateNotMet: { reason: "gateNotMet", needed, have, killerTagged },
        };
      }

      const res = await sessionAccuse(deps.redis, {
        caseId: req.caseId,
        playerId,
        instance,
        nominatedKillerId: req.nominatedKillerId,
        nominations: req.nominations,
        discoveredClueIds: req.discoveredClueIds,
        inventory: req.inventory,
        questions: req.questions,
        timeMs: req.timeMs,
        today,
      });

      // Detective progression (Part 1.5): play/solve streaks + XP for the outcome.
      await recordDetectiveOutcome(deps.redis, playerId, res.solved);
      const contradictionsProven = req.discoveredClueIds.filter((id) => {
        const clue = instance.clues.find((c) => c.id === id);
        const fid = clue?.revealsFactIds[0];
        const fact = instance.facts.find((f) => f.id === fid);
        return fact?.predicate === "refutesMeans" || fact?.predicate === "refutesOpportunity";
      }).length;
      await awardDetectiveXp(deps.redis, playerId, {
        xp: (res.solved ? 100 : 10) + contradictionsProven * 5,
        facultyXp: { logic: contradictionsProven * 5, ...(res.solved ? { perception: 10 } : {}) },
      });

      const stats = await snapshotDailyStats(deps.redis, req.caseId);
      const killerName = instance.npcs.find((n) => n.id === instance.killerId)?.persona.name ?? instance.killerId;
      return {
        solved: res.solved,
        score: res.score,
        rank: res.rank,
        streak: { count: res.streak.count, freeze: res.streak.freeze },
        summary: {
          killerName, // safe to reveal now — the game is over
          yourClueCount: req.discoveredClueIds.length,
          crowd: { total: stats.total, killerRightPct: stats.total ? Math.round((stats.killerRight / stats.total) * 100) : 0 },
        },
      };
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
