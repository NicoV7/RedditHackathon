import { describe, it, expect } from "vitest";
import { FakeRedis } from "./redis.js";
import { bumpStreak, computeScore, computeStreak, playerRank, recordLeaderboard, topLeaderboard, savePlayerState, loadPlayerState } from "./repos.js";

describe("C6 repos", () => {
  it("leaderboard ranks by score and round-trips state", async () => {
    const r = new FakeRedis();
    await recordLeaderboard(r, "case1", "alice", 800);
    await recordLeaderboard(r, "case1", "bob", 950);
    await recordLeaderboard(r, "case1", "cara", 600);
    const top = await topLeaderboard(r, "case1", 3);
    expect(top.map((m) => m.member)).toEqual(["bob", "alice", "cara"]);
    expect(await playerRank(r, "case1", "bob")).toBe(0);
  });

  it("computeScore rewards solving fast with fewer questions", () => {
    expect(computeScore({ solved: false, questions: 0, timeMs: 0 })).toBe(0);
    expect(computeScore({ solved: true, questions: 3, timeMs: 60_000 })).toBeGreaterThan(computeScore({ solved: true, questions: 9, timeMs: 200_000 }));
  });

  it("streak logic: consecutive UTC days, freeze grace, and reset", () => {
    let s = computeStreak(null, "2026-06-24");
    expect(s.count).toBe(1);
    s = computeStreak(s, "2026-06-25"); // +1 day
    expect(s.count).toBe(2);
    s = computeStreak(s, "2026-06-25"); // same day, no change
    expect(s.count).toBe(2);
    s = computeStreak(s, "2026-06-27"); // gap of 2 → freeze covers it
    expect(s.count).toBe(3);
    expect(s.freeze).toBe(0);
    s = computeStreak(s, "2026-06-30"); // gap of 3, no freeze → reset
    expect(s.count).toBe(1);
  });

  it("bumpStreak persists and every key has a ≤30-day TTL", async () => {
    const r = new FakeRedis();
    await bumpStreak(r, "alice", "2026-06-24");
    await recordLeaderboard(r, "c", "alice", 10);
    await savePlayerState(r, "c", "alice", { discoveredClueIds: [], inventory: [], nominations: {} });
    for (const k of ["streak:alice", "lb:c", "ps:c:alice"]) {
      const ttl = await r.ttl(k);
      expect(ttl, k).toBeGreaterThan(0);
      expect(ttl, k).toBeLessThanOrEqual(30 * 24 * 60 * 60);
    }
    expect((await loadPlayerState(r, "c", "alice"))?.discoveredClueIds).toEqual([]);
  });
});
