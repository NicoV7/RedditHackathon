import { describe, it, expect } from "vitest";
import { FakeRedis, TTL_30D, type RedisLike } from "./redis.js";
import {
  applyOutcomeToStreaks,
  awardDetectiveXp,
  defaultDetectiveState,
  getDetective,
  levelForXp,
  loadCaseState,
  loadPlayerScope,
  purgePlayer,
  recordDetectiveOutcome,
  recordLeaderboard,
  recordPlayerScope,
  resolveResume,
  saveCaseState,
  unlocksForLevel,
  type CaseSaveState,
} from "./repos.js";
import { logPlayerEvent, memoryForNpc } from "../metrics/events.js";

// A FakeRedis that also supports DEL, mirroring the real Devvit client, so we can
// assert the purge actually removes data (the base FakeRedis lacks del).
class DeletableFakeRedis extends FakeRedis {
  async del(key: string): Promise<void> {
    // Access private maps via index — test-only shim.
    const self = this as unknown as {
      str: Map<string, string>;
      hash: Map<string, unknown>;
      zset: Map<string, unknown>;
      ttls: Map<string, number>;
    };
    self.str.delete(key);
    self.hash.delete(key);
    self.zset.delete(key);
    self.ttls.delete(key);
  }
}

describe("detective progression (Part 1.3)", () => {
  it("starts from a zeroed sheet", async () => {
    const r = new FakeRedis();
    const d = await getDetective(r, "alice");
    expect(d).toEqual(defaultDetectiveState());
    expect(d.faculties.logic).toBe(0);
  });

  it("XP→level curve is monotonic and integer-pure", () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(99)).toBe(0);
    expect(levelForXp(100)).toBe(1); // first triangular threshold
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(600)).toBe(3);
    // monotonic non-decreasing
    let prev = -1;
    for (let xp = 0; xp <= 2000; xp += 7) {
      const l = levelForXp(xp);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it("awards unlocks at level thresholds (hint→magnifier→pressure)", () => {
    expect(unlocksForLevel(0)).toEqual([]);
    expect(unlocksForLevel(1)).toEqual(["hint"]);
    expect(unlocksForLevel(2)).toEqual(["hint", "magnifier"]);
    expect(unlocksForLevel(3)).toEqual(["hint", "magnifier", "pressure"]);
  });

  it("awardDetectiveXp accumulates xp, levels faculties, and grants unlocks", async () => {
    const r = new FakeRedis();
    await awardDetectiveXp(r, "alice", { xp: 60, facultyXp: { logic: 100 } });
    let d = await getDetective(r, "alice");
    expect(d.xp).toBe(60);
    expect(d.faculties.logic).toBe(1); // 100 faculty-xp → level 1
    expect(d.unlocks).toEqual([]); // global xp 60 < 100 → still level 0

    await awardDetectiveXp(r, "alice", { xp: 50 }); // cumulative 110 → level 1
    d = await getDetective(r, "alice");
    expect(d.xp).toBe(110);
    expect(d.unlocks).toContain("hint");
  });

  it("unlocks never revoke when xp later changes representation", async () => {
    const r = new FakeRedis();
    await awardDetectiveXp(r, "alice", { xp: 600 }); // level 3 → all unlocks
    const d = await getDetective(r, "alice");
    expect(d.unlocks).toEqual(["hint", "magnifier", "pressure"]);
  });

  it("playStreak never breaks on a loss; solveStreak breaks on a loss", () => {
    let s = applyOutcomeToStreaks({ playStreak: 0, solveStreak: 0 }, true);
    expect(s).toEqual({ playStreak: 1, solveStreak: 1 });
    s = applyOutcomeToStreaks(s, true);
    expect(s).toEqual({ playStreak: 2, solveStreak: 2 });
    s = applyOutcomeToStreaks(s, false); // a loss
    expect(s).toEqual({ playStreak: 3, solveStreak: 0 }); // play keeps going, solve resets
    s = applyOutcomeToStreaks(s, true);
    expect(s).toEqual({ playStreak: 4, solveStreak: 1 });
  });

  it("recordDetectiveOutcome persists streaks with a sliding ≤30-day TTL", async () => {
    const r = new FakeRedis();
    await recordDetectiveOutcome(r, "alice", true);
    let d = await recordDetectiveOutcome(r, "alice", false);
    expect(d.playStreak).toBe(2);
    expect(d.solveStreak).toBe(0);
    d = await getDetective(r, "alice");
    expect(d.playStreak).toBe(2);
    const ttl = await r.ttl("detective:alice");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL_30D);
  });

  it("TTL is refreshed (sliding) on every write", async () => {
    const r = new FakeRedis();
    await awardDetectiveXp(r, "alice", { xp: 10 });
    await r.expire("detective:alice", 5); // simulate decay
    await awardDetectiveXp(r, "alice", { xp: 10 });
    expect(await r.ttl("detective:alice")).toBe(TTL_30D); // refreshed
  });
});

describe("mid-case save/resume (Part 1.4)", () => {
  const sample = (): CaseSaveState => ({
    posZone: "bar",
    boardGraph: { nodes: ["a"], links: [] },
    inventory: ["matchbook"],
    transcriptRef: "tr:alice:2026-06-24",
    questionsUsed: 3,
    elapsedMs: 120_000,
    facultyXp: { logic: 2 },
  });

  it("round-trips the resumable session with a ≤30-day TTL", async () => {
    const r = new FakeRedis();
    await saveCaseState(r, "alice", "2026-06-24", sample());
    const loaded = await loadCaseState(r, "alice", "2026-06-24");
    expect(loaded?.posZone).toBe("bar");
    expect(loaded?.questionsUsed).toBe(3);
    expect(loaded?.facultyXp.logic).toBe(2);
    const ttl = await r.ttl("case:state:alice:2026-06-24");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL_30D);
  });

  it("resolveResume resumes today's save editable", async () => {
    const r = new FakeRedis();
    await saveCaseState(r, "alice", "2026-06-24", sample());
    const dec = await resolveResume(r, "alice", "2026-06-24");
    expect(dec.startFresh).toBe(false);
    expect(dec.readOnly).toBe(false);
    expect(dec.state?.posZone).toBe("bar");
  });

  it("resolveResume forfeits a prior-day case (read-only, fresh today, no penalty)", async () => {
    const r = new FakeRedis();
    await saveCaseState(r, "alice", "2026-06-23", sample()); // yesterday's session
    const dec = await resolveResume(r, "alice", "2026-06-24"); // new UTC day
    expect(dec.state).toBeNull();
    expect(dec.readOnly).toBe(true);
    expect(dec.startFresh).toBe(true);
  });
});

describe("deletion purge (compliance)", () => {
  async function seedPlayer(r: RedisLike) {
    // detective sheet + streaks
    await awardDetectiveXp(r, "alice", { xp: 600 });
    await recordDetectiveOutcome(r, "alice", true);
    // saved case session
    await saveCaseState(r, "alice", "2026-06-24", {
      posZone: "bar",
      boardGraph: {},
      inventory: [],
      transcriptRef: "x",
      questionsUsed: 0,
      elapsedMs: 0,
      facultyXp: {},
    });
    // perception event log
    await logPlayerEvent(r, "alice", "case1", {
      kind: "askedTopic",
      tick: 1,
      zone: "bar",
      summary: "asked about the relic",
      witnessedBy: ["lola"],
    });
    // shared leaderboard membership + per-case logical tick
    await recordLeaderboard(r, "case1", "alice", 800);
    await r.set("tick:case1:alice", "3");
    await r.expire("tick:case1:alice", TTL_30D);
  }

  it("purgePlayer removes every per-player key class (with a del-capable client)", async () => {
    const r = new DeletableFakeRedis();
    await seedPlayer(r);
    // a SECOND player shares the leaderboard — their score must survive the purge.
    await recordLeaderboard(r, "case1", "bob", 500);

    await purgePlayer(r, "alice", {
      caseIds: ["case1"],
      dayIds: ["2026-06-24"],
      caseNpcIds: { case1: ["lola"] },
    });

    // detective sheet gone → fresh default
    expect(await getDetective(r, "alice")).toEqual(defaultDetectiveState());
    // saved session gone
    expect(await loadCaseState(r, "alice", "2026-06-24")).toBeNull();
    // perception memory gone
    expect(await memoryForNpc(r, "alice", "case1", "lola")).toEqual([]);
    // leaderboard MEMBER removed (shared set survives; only alice's member is gone)
    expect(await r.zScore("lb:case1", "alice")).toBeNull();
    expect(await r.zScore("lb:case1", "bob")).toBe(500);
    // raw keys are truly absent (incl. the per-case tick key)
    for (const k of ["detective:alice", "streak:alice", "case:state:alice:2026-06-24", "evlog:alice:case1", "evseq:alice:case1", "evnpc:alice:case1:lola", "tick:case1:alice"]) {
      expect(await r.ttl(k), k).toBe(-2); // -2 = missing in FakeRedis
    }
  });

  it("purgePlayer zRems the player's leaderboard member via the fallback client too", async () => {
    const r = new FakeRedis(); // no del(): leaderboard zRem still works (not del-based)
    await seedPlayer(r);
    await recordLeaderboard(r, "case1", "bob", 500);
    await purgePlayer(r, "alice", { caseIds: ["case1"] });
    expect(await r.zScore("lb:case1", "alice")).toBeNull();
    expect(await r.zScore("lb:case1", "bob")).toBe(500);
    // the tick key is expired to 1s under the no-del fallback
    expect(await r.ttl("tick:case1:alice")).toBe(1);
  });

  it("scope index records a purge-resolvable scope and is itself purged", async () => {
    const r = new DeletableFakeRedis();
    // empty by default
    expect(await loadPlayerScope(r, "alice")).toEqual({});
    // folds in ids idempotently across calls (union)
    await recordPlayerScope(r, "alice", { caseIds: ["case1"], caseNpcIds: { case1: ["lola"] } });
    await recordPlayerScope(r, "alice", { caseIds: ["case1", "case2"], dayIds: ["2026-06-24"], caseNpcIds: { case1: ["mara"], case2: ["zed"] } });
    const scope = await loadPlayerScope(r, "alice");
    expect(scope.caseIds?.sort()).toEqual(["case1", "case2"]);
    expect(scope.dayIds).toEqual(["2026-06-24"]);
    expect(scope.caseNpcIds?.case1?.sort()).toEqual(["lola", "mara"]);
    expect(scope.caseNpcIds?.case2).toEqual(["zed"]);
    // scope index carries a ≤30d TTL
    const t = await r.ttl("scope:alice");
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(TTL_30D);
    // a purge using the resolved scope removes the index key itself
    await purgePlayer(r, "alice", scope);
    expect(await loadPlayerScope(r, "alice")).toEqual({});
    expect(await r.ttl("scope:alice")).toBe(-2);
  });

  it("purgePlayer falls back to a 1s TTL when the client lacks del", async () => {
    const r = new FakeRedis(); // no del()
    await seedPlayer(r);
    await purgePlayer(r, "alice", { caseIds: ["case1"], dayIds: ["2026-06-24"], caseNpcIds: { case1: ["lola"] } });
    // keys still exist in FakeRedis but are scheduled to expire immediately
    expect(await r.ttl("detective:alice")).toBe(1);
    expect(await r.ttl("evnpc:alice:case1:lola")).toBe(1);
  });

  it("purgePlayer is idempotent and safe with an empty scope", async () => {
    const r = new DeletableFakeRedis();
    await seedPlayer(r);
    await purgePlayer(r, "alice"); // no caseIds/dayIds — drops single-owner keys only
    await purgePlayer(r, "alice"); // second call must not throw
    expect(await getDetective(r, "alice")).toEqual(defaultDetectiveState());
  });
});
