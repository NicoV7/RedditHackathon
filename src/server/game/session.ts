/**
 * Game session glue (the Wave-1 e2e gate). Ties generation (C2), reachability +
 * solver (C3), state (C6), and metrics (C17) into one server-authoritative flow:
 *   start → (interrogate/examine reveal clues) → nominate → accuse → score.
 * The client never learns `killerId`; the server checks the accusation.
 */
import type { CaseInstance, Fact } from "../../shared/case.js";
import { generateTemplate, drawInstance } from "../case/procedural.js";
import { computeSurface } from "../case/reachability.js";
import type { RedisLike } from "../redis/redis.js";
import { bumpStreak, computeScore, getStreak, loadPlayerState, playerRank, recordLeaderboard, savePlayerState, type PlayerCaseState, type StreakState } from "../redis/repos.js";
import { recordNomination, recordOutcome } from "../metrics/events.js";

export interface StartedCase {
  caseId: string;
  instance: CaseInstance;
}

/** Start a player's per-instance case for a given daily template. */
export function startCase(dailySeed: string, playerId: string): StartedCase {
  const template = generateTemplate(dailySeed);
  const instance = drawInstance(template, playerId);
  return { caseId: template.id, instance };
}

/** The normalized "role" of a clue = the predicate of the fact it reveals.
 *  Comparable across per-player instances even though placement differs. */
function clueRole(instance: CaseInstance, clueId: string): string | null {
  const clue = instance.clues.find((c) => c.id === clueId);
  const factId = clue?.revealsFactIds[0];
  const fact = instance.facts.find((f) => f.id === factId);
  return fact?.predicate ?? null;
}

export interface AccuseInput {
  caseId: string;
  playerId: string;
  instance: CaseInstance;
  nominatedKillerId: string;
  nominations: PlayerCaseState["nominations"];
  discoveredClueIds: string[];
  inventory: string[];
  questions: number;
  timeMs: number;
  today: string; // UTC YYYY-MM-DD (passed in; never Date.now)
}

export interface AccuseResult {
  solved: boolean;
  score: number;
  rank: number | null;
  streak: StreakState;
}

/** Server-authoritative accusation + scoring + persistence. */
export async function accuse(redis: RedisLike, input: AccuseInput): Promise<AccuseResult> {
  const { instance, caseId, playerId } = input;
  const solved = input.nominatedKillerId === instance.killerId; // checked server-side only
  const suspectedKiller = !solved && input.nominations[instance.killerId] === "suspect";

  // Persist attributable per-player state (C6, deletable).
  const state: PlayerCaseState = {
    discoveredClueIds: input.discoveredClueIds,
    inventory: input.inventory,
    nominations: input.nominations,
    outcome: { solved, questions: input.questions, timeMs: input.timeMs },
  };
  await savePlayerState(redis, caseId, playerId, state);

  // Leaderboard (C6) + streak (C6, only advances on a solve).
  const score = computeScore({ solved, questions: input.questions, timeMs: input.timeMs });
  await recordLeaderboard(redis, caseId, playerId, score);
  const streakState: StreakState = solved
    ? await bumpStreak(redis, playerId, input.today)
    : (await getStreak(redis, playerId)) ?? { count: 0, lastDay: input.today, freeze: 0 };

  // Anonymized aggregate metrics (C17).
  for (const [npcId, role] of Object.entries(input.nominations)) {
    if (role === "killer") await recordNomination(redis, caseId, "killer", npcId);
    else if (role === "suspect") await recordNomination(redis, caseId, "suspect", npcId);
  }
  const discoveredClueRoles = input.discoveredClueIds
    .map((id) => clueRole(instance, id))
    .filter((r): r is string => r != null);
  await recordOutcome(redis, caseId, { gotKillerRight: solved, suspectedKiller, discoveredClueRoles });

  return { solved, score, rank: await playerRank(redis, caseId, playerId), streak: streakState };
}

/** A perfect interrogator: reach everything, then deduce. Used by the e2e test
 *  and as a server-side solvability self-check. */
export function perfectSolve(instance: CaseInstance): { killerId: string | null; reachedClueIds: string[]; facts: Fact[] } {
  const surface = computeSurface(instance);
  // The blind solver determines the unique survivor (never reads `solution`).
  const reachedClueIds = [...surface.reachableClueIds];
  // Find the unique viable suspect from the reachable facts.
  const viable = instance.suspectIds.filter((s) => {
    const has = (p: Fact["predicate"]) => instance.facts.some((f) => f.subject === s && f.predicate === p && surface.reachableFactIds.has(f.id));
    return has("means") && has("opportunity") && !has("refutesMeans") && !has("refutesOpportunity");
  });
  return { killerId: viable.length === 1 ? viable[0]! : null, reachedClueIds, facts: instance.facts };
}

export async function loadState(redis: RedisLike, caseId: string, playerId: string) {
  return loadPlayerState(redis, caseId, playerId);
}
