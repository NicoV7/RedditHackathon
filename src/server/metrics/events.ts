/**
 * Event log & daily metrics (C17). TWO stores (eng-review H-3): per-player
 * attributable state lives in C6 (deletable); THIS module holds only the
 * ANONYMIZED aggregate counters, updated incrementally so the "daily snapshot"
 * is a near-no-op read (no end-of-day scan). ≤30-day TTL on every key.
 */
import { type RedisLike, TTL_30D, type ZMember } from "../redis/redis.js";

const aggKey = (caseId: string) => `agg:${caseId}`;
const nomKey = (caseId: string, role: string) => `nom:${caseId}:${role}`;
const clueKey = (caseId: string) => `cluefound:${caseId}`;

async function ttl(redis: RedisLike, key: string) {
  await redis.expire(key, TTL_30D);
}

/** A player tagged `npcId` as `role` (suspect|killer). Anonymized tally. */
export async function recordNomination(redis: RedisLike, caseId: string, role: "suspect" | "killer", npcId: string): Promise<void> {
  const k = nomKey(caseId, role);
  await redis.zIncrBy(k, npcId, 1);
  await ttl(redis, k);
}

export interface OutcomeMetric {
  gotKillerRight: boolean;
  suspectedKiller: boolean; // tagged the true killer as 'suspect' but didn't name them
  discoveredClueRoles: string[]; // normalized clue ROLES (placement is per-instance)
}

export async function recordOutcome(redis: RedisLike, caseId: string, m: OutcomeMetric): Promise<void> {
  const a = aggKey(caseId);
  await redis.hIncrBy(a, "total", 1);
  await redis.hIncrBy(a, m.gotKillerRight ? "killerRight" : m.suspectedKiller ? "suspected" : "didnt", 1);
  await ttl(redis, a);
  const c = clueKey(caseId);
  for (const role of m.discoveredClueRoles) await redis.hIncrBy(c, role, 1);
  await ttl(redis, c);
}

export interface DailyStats {
  total: number;
  killerRight: number;
  suspected: number;
  didnt: number;
  mostNominatedKillers: ZMember[];
  mostNominatedSuspects: ZMember[];
  clueDiscoveryRates: Record<string, number>; // role -> fraction who found it
}

/** Near-no-op snapshot: reads already-aggregated counters. */
export async function snapshotDailyStats(redis: RedisLike, caseId: string): Promise<DailyStats> {
  const a = await redis.hGetAll(aggKey(caseId));
  const total = Number(a.total ?? "0");
  const clues = await redis.hGetAll(clueKey(caseId));
  const rates: Record<string, number> = {};
  for (const [role, n] of Object.entries(clues)) rates[role] = total ? Number(n) / total : 0;
  return {
    total,
    killerRight: Number(a.killerRight ?? "0"),
    suspected: Number(a.suspected ?? "0"),
    didnt: Number(a.didnt ?? "0"),
    mostNominatedKillers: await redis.zRevRange(nomKey(caseId, "killer"), 0, 4),
    mostNominatedSuspects: await redis.zRevRange(nomKey(caseId, "suspect"), 0, 4),
    clueDiscoveryRates: rates,
  };
}
