/**
 * Redis repositories (C6): leaderboard (sorted set), streaks (UTC + freeze),
 * per-player case state. Every write sets a ≤30-day TTL. N+1 discipline: reads
 * use single hGetAll / zRevRange, never per-field round-trips.
 */
import { type RedisLike, TTL_30D, type ZMember } from "./redis.js";

// ───────────────────────── Leaderboard ─────────────────────────
const lbKey = (caseId: string) => `lb:${caseId}`;

/** Efficiency score (higher = better): solved, faster, fewer questions. */
export function computeScore(o: { solved: boolean; questions: number; timeMs: number }): number {
  if (!o.solved) return 0;
  return Math.max(1, 1000 - o.questions * 10 - Math.floor(o.timeMs / 1000));
}

export async function recordLeaderboard(redis: RedisLike, caseId: string, playerId: string, score: number): Promise<void> {
  const k = lbKey(caseId);
  await redis.zAdd(k, playerId, score);
  await redis.expire(k, TTL_30D);
}
export async function topLeaderboard(redis: RedisLike, caseId: string, n = 10): Promise<ZMember[]> {
  return redis.zRevRange(lbKey(caseId), 0, n - 1);
}
export async function playerRank(redis: RedisLike, caseId: string, playerId: string): Promise<number | null> {
  return redis.zRevRank(lbKey(caseId), playerId);
}

// ───────────────────────── Streaks (UTC + freeze) ─────────────────────────
export interface StreakState {
  count: number;
  lastDay: string; // YYYY-MM-DD (UTC)
  freeze: number; // remaining grace days
}
const STREAK_FREEZE_BASE = 1;

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

/** Pure, deterministic streak transition (today passed in — never Date.now). */
export function computeStreak(prev: StreakState | null, today: string): StreakState {
  if (!prev) return { count: 1, lastDay: today, freeze: STREAK_FREEZE_BASE };
  const gap = daysBetween(prev.lastDay, today);
  if (gap <= 0) return prev; // same day (or earlier) — no change
  if (gap === 1) return { count: prev.count + 1, lastDay: today, freeze: prev.freeze };
  if (gap === 2 && prev.freeze > 0) return { count: prev.count + 1, lastDay: today, freeze: prev.freeze - 1 };
  return { count: 1, lastDay: today, freeze: STREAK_FREEZE_BASE };
}

const streakKey = (playerId: string) => `streak:${playerId}`;

export async function getStreak(redis: RedisLike, playerId: string): Promise<StreakState | null> {
  const h = await redis.hGetAll(streakKey(playerId));
  if (!h.lastDay) return null;
  return { count: Number(h.count), lastDay: h.lastDay, freeze: Number(h.freeze) };
}
export async function bumpStreak(redis: RedisLike, playerId: string, today: string): Promise<StreakState> {
  const k = streakKey(playerId);
  const next = computeStreak(await getStreak(redis, playerId), today);
  await redis.hSet(k, "count", String(next.count));
  await redis.hSet(k, "lastDay", next.lastDay);
  await redis.hSet(k, "freeze", String(next.freeze));
  await redis.expire(k, TTL_30D);
  return next;
}

// ───────────────────────── Per-player case state ─────────────────────────
export interface PlayerCaseState {
  discoveredClueIds: string[];
  inventory: string[];
  nominations: Record<string, "suspect" | "bystander" | "killer" | "unknown">;
  outcome?: { solved: boolean; questions: number; timeMs: number };
}
const psKey = (caseId: string, playerId: string) => `ps:${caseId}:${playerId}`;

export async function savePlayerState(redis: RedisLike, caseId: string, playerId: string, state: PlayerCaseState): Promise<void> {
  const k = psKey(caseId, playerId);
  await redis.hSet(k, "state", JSON.stringify(state)); // single blob; small per-player
  await redis.expire(k, TTL_30D);
}
export async function loadPlayerState(redis: RedisLike, caseId: string, playerId: string): Promise<PlayerCaseState | null> {
  const raw = await redis.hGet(psKey(caseId, playerId), "state");
  return raw ? (JSON.parse(raw) as PlayerCaseState) : null;
}
