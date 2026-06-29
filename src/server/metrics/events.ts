/**
 * Event log & daily metrics (C17). THREE stores:
 *   1. ANONYMIZED aggregate counters (eng-review H-3) — incremental so the daily
 *      snapshot is a near-no-op read (no end-of-day scan).
 *   2. The per-(playerId,caseId) PERCEPTION / EVENT LOG (Part 2.6/2.3) — the
 *      dynamic RAG corpus of player-driven events, perception-gated by zone+tick,
 *      ranked by recency for an NPC's memory slot.
 * Both are per-player-attributable, so the deletion purge (repos.purgePlayer)
 * removes them. ≤30-day TTL on EVERY key class (compliance).
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

// ──────────────────── Perception / Event log (Part 2.6/2.3) ────────────────────
// Player-driven events ARE the dynamic RAG corpus. Each event is stamped with the
// LOGICAL tick (integer, never Date.now) and the zone it happened in, plus the set
// of NPCs that could perceive it. The perception gate ("NPC.zone == event.zone at
// event.tick") is computed by the CALLER (it owns the routine table) and passed in
// as `witnessedBy`; this module is pure storage + recency-ranked retrieval.

export type PlayerEventKind =
  | "tookItem"
  | "presentedItem"
  | "enteredZone"
  | "askedTopic"
  | "caughtInLie";

export interface PlayerEvent {
  kind: PlayerEventKind;
  /** logical tick the event happened at (integer; tick 0 = case start) */
  tick: number;
  /** zone the event happened in — the perception-gate axis */
  zone: string;
  /** kind-specific subject: itemId / topicId / zoneId / npcId. Optional for bare events. */
  subjectId?: string;
  /** server-authored one-line memory phrasing fed into the NPC's RAG slot */
  summary: string;
  /** NPC ids that could perceive this event (caller-computed perception gate) */
  witnessedBy: string[];
}

/** The full event record (an event plus its monotonically increasing sequence number). */
export interface LoggedEvent extends PlayerEvent {
  /** per-(player,case) monotonic sequence; ties broken deterministically on read */
  seq: number;
}

// One sorted set per (player,case) holds the whole timeline (member = JSON, score =
// seq); one sorted set per witnessing NPC holds that NPC's perceptible slice. Both
// are scored by `seq` so recency ranking is integer-pure and stable.
const evLogKey = (playerId: string, caseId: string) => `evlog:${playerId}:${caseId}`;
const evSeqKey = (playerId: string, caseId: string) => `evseq:${playerId}:${caseId}`;
const evNpcKey = (playerId: string, caseId: string, npcId: string) =>
  `evnpc:${playerId}:${caseId}:${npcId}`;

/**
 * Append a player-driven event. The caller supplies `witnessedBy` (the perception
 * gate result for this tick+zone). Returns the stored record. ≤30d TTL on every key.
 */
export async function logPlayerEvent(
  redis: RedisLike,
  playerId: string,
  caseId: string,
  ev: PlayerEvent,
): Promise<LoggedEvent> {
  const seqK = evSeqKey(playerId, caseId);
  const seq = await redis.incrBy(seqK, 1); // monotonic per (player,case)
  await ttl(redis, seqK);

  const record: LoggedEvent = { ...ev, seq };
  const member = JSON.stringify(record);

  const logK = evLogKey(playerId, caseId);
  await redis.zAdd(logK, member, seq);
  await ttl(redis, logK);

  // de-dupe witnesses so an NPC listed twice doesn't get the event twice
  for (const npcId of [...new Set(ev.witnessedBy)]) {
    const npcK = evNpcKey(playerId, caseId, npcId);
    await redis.zAdd(npcK, member, seq);
    await ttl(redis, npcK);
  }
  return record;
}

function parseEvents(members: ZMember[]): LoggedEvent[] {
  return members.map((m) => JSON.parse(m.member) as LoggedEvent);
}

/**
 * Recency-ranked events an NPC perceived (most recent first), capped at `limit`.
 * This is the RAG memory slot feed for a principal turn.
 */
export async function recentEventsForNpc(
  redis: RedisLike,
  playerId: string,
  caseId: string,
  npcId: string,
  limit = 8,
): Promise<LoggedEvent[]> {
  const members = await redis.zRevRange(evNpcKey(playerId, caseId, npcId), 0, limit - 1);
  return parseEvents(members);
}

/** Convenience: just the memory summaries for an NPC, newest first (the RAG slot). */
export async function memoryForNpc(
  redis: RedisLike,
  playerId: string,
  caseId: string,
  npcId: string,
  limit = 8,
): Promise<string[]> {
  return (await recentEventsForNpc(redis, playerId, caseId, npcId, limit)).map((e) => e.summary);
}

/** The full player timeline, newest first (debug / save-resume reconstruction). */
export async function recentPlayerEvents(
  redis: RedisLike,
  playerId: string,
  caseId: string,
  limit = 50,
): Promise<LoggedEvent[]> {
  const members = await redis.zRevRange(evLogKey(playerId, caseId), 0, limit - 1);
  return parseEvents(members);
}

/**
 * Compute the exact event-log key set for a player so the deletion purge can drop
 * it. RedisLike has no SCAN, so the caller passes the caseIds the player touched
 * and (optionally) per-case npcIds. Returns every evlog/evseq/evnpc key to delete.
 */
export function playerEventLogKeys(
  playerId: string,
  cases: { caseId: string; npcIds?: string[] }[],
): string[] {
  const keys: string[] = [];
  for (const { caseId, npcIds } of cases) {
    keys.push(evLogKey(playerId, caseId), evSeqKey(playerId, caseId));
    for (const npcId of npcIds ?? []) keys.push(evNpcKey(playerId, caseId, npcId));
  }
  return keys;
}
