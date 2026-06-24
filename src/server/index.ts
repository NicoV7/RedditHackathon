/**
 * Server endpoints (C7 surface). Framework-agnostic handlers wired to the
 * verified core (C2/C3/C5/C6/C17). The Devvit runtime adapter injects the real
 * Redis + LLM provider; everything here is deterministic and testable.
 *
 * Security: the instance is re-derived server-side from (dailySeed, playerId);
 * only sanitized views (shared/api.ts) and server-revealed clues leave the server.
 */
import type { CaseInstance, CaseTemplate, Clue, Fact } from "../shared/case.js";
import type * as Api from "../shared/api.js";
import { drawInstance, generateTemplate } from "./case/procedural.js";
import { runNpcTurn } from "./npc/harness.js";
import { MockProvider, type LlmProvider } from "./llm/provider.js";
import type { RedisLike } from "./redis/redis.js";
import { FakeRedis } from "./redis/redis.js";
import { accuse as sessionAccuse } from "./game/session.js";
import { recordNomination, snapshotDailyStats } from "./metrics/events.js";

export interface ServerDeps {
  redis: RedisLike;
  provider: LlmProvider;
}

/** Default local deps (sandbox/dev). Devvit runtime injects real redis + key. */
export function defaultDeps(): ServerDeps {
  return { redis: new FakeRedis(), provider: new MockProvider((r) => `(${r.user.slice(0, 20)}…) I really couldn't say.`) };
}

function deriveInstance(dailySeed: string, playerId: string): { template: CaseTemplate; instance: CaseInstance } {
  const template = generateTemplate(dailySeed);
  return { template, instance: drawInstance(template, playerId) };
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

function clueToRevealed(instance: CaseInstance, clue: Clue, npcsById: Map<string, string>): Api.RevealedClue {
  const text = clue.revealsFactIds
    .map((id) => instance.facts.find((f) => f.id === id))
    .filter((f): f is Fact => !!f)
    .map((f) => renderFact(f, npcsById))
    .join(" ");
  return { id: clue.id, text };
}

export function createHandlers(deps: ServerDeps) {
  const npcNames = (instance: CaseInstance) => new Map(instance.npcs.map((n) => [n.id, n.persona.name]));

  return {
    async startCase(req: Api.StartCaseRequest, playerId: string): Promise<Api.StartCaseResponse> {
      const { template, instance } = deriveInstance(req.dailySeed, playerId);
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

      const mod = await deps.provider.moderate(req.message);
      if (mod.flagged) return { reply: "The suspect ignores your outburst.", revealed: [], moderated: true };

      // Server-authoritative reveals: clues this NPC surfaces (askTopic on them).
      const myClues = instance.clues.filter((c) => c.unlockedBy.kind === "askTopic" && c.unlockedBy.npcId === npc.id);
      const names = npcNames(instance);
      const factById = new Map(instance.facts.map((f) => [f.id, f]));
      const turn = await runNpcTurn({
        npc,
        factById,
        playerMessage: req.message,
        serverRevealedClueIds: myClues.map((c) => c.id),
        provider: deps.provider,
      });
      return { reply: turn.reply, revealed: myClues.map((c) => clueToRevealed(instance, c, names)) };
    },

    async examine(req: Api.ExamineRequest, playerId: string): Promise<Api.ExamineResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
      const item = instance.items.find((i) => i.id === req.itemId);
      if (!item) throw new Error("unknown item");
      const names = npcNames(instance);
      const revealed: Api.RevealedClue[] = instance.clues
        .filter((c) => c.unlockedBy.kind === "inspectItem" && c.unlockedBy.itemId === item.id)
        .map((c) => clueToRevealed(instance, c, names));
      return { examineText: item.examineText, revealed };
    },

    async nominate(req: Api.NominateRequest): Promise<Api.NominateResponse> {
      if (req.role === "killer" || req.role === "suspect") {
        await recordNomination(deps.redis, req.caseId, req.role, req.npcId);
      }
      return { ok: true };
    },

    async accuse(req: Api.AccuseRequest, playerId: string, today: string): Promise<Api.AccuseResponse> {
      const { instance } = deriveInstance(req.dailySeed, playerId);
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
