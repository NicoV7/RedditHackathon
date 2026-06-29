/**
 * Redis repositories (C6): leaderboard (sorted set), streaks (UTC + freeze),
 * per-player case state, detective progression, mid-case save/resume, and the
 * compliance deletion purge. Every write sets a ≤30-day TTL. N+1 discipline:
 * reads use single hGetAll / zRevRange, never per-field round-trips.
 */
import type { DetectiveState, FacultyLevels } from "../../shared/api.js";
import { playerEventLogKeys } from "../metrics/events.js";
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

// ───────────────────── Detective progression (Part 1.3) ─────────────────────
// Persistent detective sheet: faculties, xp, and the two streaks. Stored as a
// Redis hash `detective:{playerId}` with a SLIDING ≤30d TTL refreshed on every
// write (a >30-day lapse resets — acceptable per the plan). XP→level uses a
// pure cumulative curve; unlocks are awarded at thresholds. playStreak NEVER
// breaks on a loss; solveStreak breaks on a loss.

const FACULTY_IDS = ["logic", "empathy", "drama", "perception", "authority", "encyclopedia"] as const;

function zeroFaculties(): FacultyLevels {
  return { logic: 0, empathy: 0, drama: 0, perception: 0, authority: 0, encyclopedia: 0 };
}

export function defaultDetectiveState(): DetectiveState {
  return { faculties: zeroFaculties(), xp: 0, playStreak: 0, solveStreak: 0, unlocks: [] };
}

/**
 * Cumulative XP curve → level. Level L requires `LEVEL_STEP * L*(L+1)/2` total XP
 * (triangular: 100, 300, 600, 1000, …). Pure & integer-only. Level is the global
 * detective level used to gate unlocks; per-faculty levels are derived from
 * awarded faculty XP the same way (see `applyFacultyXp`).
 */
const LEVEL_STEP = 100;
export function levelForXp(xp: number): number {
  if (xp < 0) return 0;
  let level = 0;
  // smallest L with LEVEL_STEP * L*(L+1)/2 > xp ... return that L (0-based floor)
  while (LEVEL_STEP * ((level + 1) * (level + 2)) / 2 <= xp) level++;
  return level;
}

/** Unlock thresholds keyed by GLOBAL detective level (Part 1.3). */
const UNLOCK_THRESHOLDS: { level: number; unlock: string }[] = [
  { level: 1, unlock: "hint" },
  { level: 2, unlock: "magnifier" },
  { level: 3, unlock: "pressure" },
];

/** Pure: the unlock set earned at a given level (monotonic — never revokes). */
export function unlocksForLevel(level: number): string[] {
  return UNLOCK_THRESHOLDS.filter((t) => level >= t.level).map((t) => t.unlock);
}

const detectiveKey = (playerId: string) => `detective:${playerId}`;

export async function getDetective(redis: RedisLike, playerId: string): Promise<DetectiveState> {
  const h = await redis.hGetAll(detectiveKey(playerId));
  if (!h.xp && !h.faculties) return defaultDetectiveState();
  const faculties = h.faculties ? (JSON.parse(h.faculties) as FacultyLevels) : zeroFaculties();
  const unlocks = h.unlocks ? (JSON.parse(h.unlocks) as string[]) : [];
  return {
    faculties: { ...zeroFaculties(), ...faculties },
    xp: Number(h.xp ?? "0"),
    playStreak: Number(h.playStreak ?? "0"),
    solveStreak: Number(h.solveStreak ?? "0"),
    unlocks,
  };
}

async function writeDetective(redis: RedisLike, playerId: string, s: DetectiveState): Promise<void> {
  const k = detectiveKey(playerId);
  await redis.hSet(k, "faculties", JSON.stringify(s.faculties));
  await redis.hSet(k, "xp", String(s.xp));
  await redis.hSet(k, "playStreak", String(s.playStreak));
  await redis.hSet(k, "solveStreak", String(s.solveStreak));
  await redis.hSet(k, "unlocks", JSON.stringify(s.unlocks));
  await redis.expire(k, TTL_30D); // SLIDING: refreshed on every write
}

/** Pure merge of newly-earned unlocks into the existing set (stable order, no dupes). */
function mergeUnlocks(existing: string[], earned: string[]): string[] {
  const out = [...existing];
  for (const u of earned) if (!out.includes(u)) out.push(u);
  return out;
}

export interface DetectiveProgressDelta {
  /** total XP to add (tells noticed, contradictions proven, speed/accuracy). */
  xp?: number;
  /** per-faculty XP awards; each faculty's level derives from its cumulative XP. */
  facultyXp?: Partial<Record<(typeof FACULTY_IDS)[number], number>>;
}

/**
 * Atomically (field-wise) award XP and recompute level/unlocks. Returns the new
 * state. XP fields use hIncrBy where possible; faculties/unlocks are JSON blobs so
 * we read-modify-write those two fields. Refreshes the sliding TTL.
 */
export async function awardDetectiveXp(
  redis: RedisLike,
  playerId: string,
  delta: DetectiveProgressDelta,
): Promise<DetectiveState> {
  const k = detectiveKey(playerId);
  const prev = await getDetective(redis, playerId);

  // global xp via atomic field op
  const xpGain = Math.max(0, Math.floor(delta.xp ?? 0));
  const xp = xpGain > 0 ? await redis.hIncrBy(k, "xp", xpGain) : prev.xp;

  // per-faculty xp accumulates in dedicated hash fields; level = curve(cumXp)
  const faculties = { ...prev.faculties };
  for (const fid of FACULTY_IDS) {
    const gain = Math.max(0, Math.floor(delta.facultyXp?.[fid] ?? 0));
    if (gain <= 0) continue;
    const cum = await redis.hIncrBy(k, `fxp:${fid}`, gain);
    faculties[fid] = levelForXp(cum);
  }

  const level = levelForXp(xp);
  const unlocks = mergeUnlocks(prev.unlocks, unlocksForLevel(level));

  await redis.hSet(k, "faculties", JSON.stringify(faculties));
  await redis.hSet(k, "unlocks", JSON.stringify(unlocks));
  await redis.expire(k, TTL_30D);

  return { faculties, xp, playStreak: prev.playStreak, solveStreak: prev.solveStreak, unlocks };
}

/**
 * Record a completed-case outcome's effect on the two streaks (Part 1.5).
 * playStreak ALWAYS increments (the forgiving habit driver — never breaks on a
 * loss). solveStreak increments on a solve and RESETS to 0 on a loss.
 * Pure transition exposed for unit tests; the repo wraps it with persistence.
 */
export function applyOutcomeToStreaks(
  prev: { playStreak: number; solveStreak: number },
  solved: boolean,
): { playStreak: number; solveStreak: number } {
  return {
    playStreak: prev.playStreak + 1,
    solveStreak: solved ? prev.solveStreak + 1 : 0,
  };
}

export async function recordDetectiveOutcome(
  redis: RedisLike,
  playerId: string,
  solved: boolean,
): Promise<DetectiveState> {
  const prev = await getDetective(redis, playerId);
  const next = applyOutcomeToStreaks(prev, solved);
  const merged: DetectiveState = { ...prev, ...next };
  await writeDetective(redis, playerId, merged);
  return merged;
}

// ───────────────────── Mid-case save/resume (Part 1.4) ─────────────────────
// `case:state:{playerId}:{dayId}` holds the resumable session, written on each
// completed verb (debounced by the caller). ≤30d TTL. On UTC rollover an
// in-progress case becomes read-only/forfeit (no play-streak penalty); the new
// day loads fresh.

export interface CaseSaveState {
  posZone: string;
  /** opaque serialized deduction-board graph (nodes + manual links + tags). */
  boardGraph: unknown;
  inventory: string[];
  /** pointer/ref to the transcript blob (transcript itself stored elsewhere). */
  transcriptRef: string;
  questionsUsed: number;
  elapsedMs: number;
  /** per-faculty XP banked this session (folded into the sheet on completion). */
  facultyXp: Partial<FacultyLevels>;
}

const caseStateKey = (playerId: string, dayId: string) => `case:state:${playerId}:${dayId}`;

export async function saveCaseState(
  redis: RedisLike,
  playerId: string,
  dayId: string,
  state: CaseSaveState,
): Promise<void> {
  const k = caseStateKey(playerId, dayId);
  await redis.hSet(k, "state", JSON.stringify(state)); // single small blob
  await redis.hSet(k, "dayId", dayId); // stamp for rollover checks
  await redis.expire(k, TTL_30D);
}

export async function loadCaseState(
  redis: RedisLike,
  playerId: string,
  dayId: string,
): Promise<CaseSaveState | null> {
  const raw = await redis.hGet(caseStateKey(playerId, dayId), "state");
  return raw ? (JSON.parse(raw) as CaseSaveState) : null;
}

export interface ResumeDecision {
  /** the saved session, if any. */
  state: CaseSaveState | null;
  /** true ⇒ saved session is from a prior UTC day → read-only/forfeit. */
  readOnly: boolean;
  /** true ⇒ the caller should load a fresh case for `currentDayId`. */
  startFresh: boolean;
}

/**
 * UTC-rollover resume helper (Part 1.4). Pure decision given the saved day and the
 * current day: same day → resume editable; prior day → the saved case is read-only
 * (forfeit, NO play-streak penalty) and the caller starts the new day fresh.
 * `currentDayId`/`savedDayId` are passed in (never Date.now) for determinism.
 */
export async function resolveResume(
  redis: RedisLike,
  playerId: string,
  currentDayId: string,
): Promise<ResumeDecision> {
  const state = await loadCaseState(redis, playerId, currentDayId);
  if (state) return { state, readOnly: false, startFresh: false }; // today's session
  // No save for today. The previous day's case (if any) is forfeit/read-only; the
  // caller loads today fresh. We don't scan; the existence of today's save is the
  // single source of truth for "resume vs fresh".
  return { state: null, readOnly: true, startFresh: true };
}

// ───────────────────── Per-player scope index (deletion support) ─────────────────────
// RedisLike has no SCAN, so a deletion trigger can't discover which caseIds/dayIds a
// player touched. We maintain a tiny per-player INDEX (`scope:{playerId}`) recording
// exactly that, updated as the player plays. The deletion handler reads it to build the
// purge scope, then drops the index itself. ≤30d TTL (compliance). The index holds no
// game content — only ids the player already owns — and is itself purged.

const scopeKey = (playerId: string) => `scope:${playerId}`;

export interface PlayerScope {
  /** every caseId the player has data under (leaderboards, state, events). */
  caseIds?: string[];
  /** every dayId with a saved case session. */
  dayIds?: string[];
  /** per-case witnessing NPC ids, so the perception event-log keys can be dropped. */
  caseNpcIds?: Record<string, string[]>;
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)];
}

/** Merge two scopes (union of ids / per-case npc ids). Pure. */
function mergeScope(a: PlayerScope, b: PlayerScope): PlayerScope {
  const caseNpcIds: Record<string, string[]> = { ...(a.caseNpcIds ?? {}) };
  for (const [caseId, npcIds] of Object.entries(b.caseNpcIds ?? {})) {
    caseNpcIds[caseId] = uniq([...(caseNpcIds[caseId] ?? []), ...npcIds]);
  }
  return {
    caseIds: uniq([...(a.caseIds ?? []), ...(b.caseIds ?? [])]),
    dayIds: uniq([...(a.dayIds ?? []), ...(b.dayIds ?? [])]),
    caseNpcIds,
  };
}

/** Read the player's accumulated deletion scope (empty if never recorded). */
export async function loadPlayerScope(redis: RedisLike, playerId: string): Promise<PlayerScope> {
  const raw = await redis.hGet(scopeKey(playerId), "scope");
  return raw ? (JSON.parse(raw) as PlayerScope) : {};
}

/**
 * Fold `add` into the player's stored deletion scope (idempotent union) so a later
 * Account/Post/Comment delete trigger can purge every per-player key without SCAN.
 * Called on the play path (start/save/interrogate) with the ids touched. ≤30d TTL.
 */
export async function recordPlayerScope(redis: RedisLike, playerId: string, add: PlayerScope): Promise<void> {
  const k = scopeKey(playerId);
  const merged = mergeScope(await loadPlayerScope(redis, playerId), add);
  await redis.hSet(k, "scope", JSON.stringify(merged));
  await redis.expire(k, TTL_30D);
}

// ───────────────────── Deletion purge (compliance) ─────────────────────
// Honor deletions (Post/Comment/Account triggers): drop every per-player key
// class. RedisLike has no SCAN/DEL, so the caller passes the caseIds/dayIds the
// player touched; a `del`-capable client (real Devvit Redis) is used when present,
// otherwise we expire keys to 1s (near-immediate Redis purge). Either way no
// per-player datum survives.

/** Optional DEL capability the real Devvit Redis exposes; not on the base interface. */
type Deletable = RedisLike & { del?(key: string): Promise<void> };

async function dropKey(redis: RedisLike, key: string): Promise<void> {
  const d = redis as Deletable;
  if (typeof d.del === "function") await d.del(key);
  else await redis.expire(key, 1); // fallback: near-immediate TTL purge
}

/** Per-(player,case) logical-tick key (mirrors `index.ts`'s tickKey shape). */
const tickKey = (caseId: string, playerId: string) => `tick:${caseId}:${playerId}`;

/**
 * Delete ALL per-player keys (compliance): streak, detective sheet, per-case
 * player state, per-case logical tick, the player's leaderboard MEMBERSHIP, saved
 * case sessions, the perception event log, and the per-player scope index itself.
 * Idempotent. The leaderboard is a SHARED sorted set, so we `zRem` only this player's
 * member (never delete the set) and leave shared anonymized aggregates alone.
 */
export async function purgePlayer(redis: RedisLike, playerId: string, scope: PlayerScope = {}): Promise<void> {
  const caseIds = scope.caseIds ?? [];
  const dayIds = scope.dayIds ?? [];

  // Per-player single-owner keys.
  await dropKey(redis, streakKey(playerId));
  await dropKey(redis, detectiveKey(playerId));
  await dropKey(redis, scopeKey(playerId)); // the deletion-scope index is itself per-player
  for (const caseId of caseIds) {
    await dropKey(redis, psKey(caseId, playerId));
    await dropKey(redis, tickKey(caseId, playerId)); // logical-tick state
    await redis.zRem(lbKey(caseId), playerId); // drop this player's SHARED-leaderboard member only
  }
  for (const dayId of dayIds) await dropKey(redis, caseStateKey(playerId, dayId));

  // Perception / event log keys (evlog/evseq/evnpc).
  const eventKeys = playerEventLogKeys(
    playerId,
    caseIds.map((caseId) => ({ caseId, npcIds: scope.caseNpcIds?.[caseId] })),
  );
  for (const k of eventKeys) await dropKey(redis, k);
}
