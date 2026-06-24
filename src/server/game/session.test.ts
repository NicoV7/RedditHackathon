import { describe, it, expect } from "vitest";
import { FakeRedis } from "../redis/redis.js";
import { accuse, perfectSolve, startCase, loadState } from "./session.js";
import { snapshotDailyStats } from "../metrics/events.js";

describe("e2e: generate → interrogate → accuse → score (Wave-1 gate)", () => {
  it("a perfect player solves, scores, and climbs the leaderboard", async () => {
    const redis = new FakeRedis();
    const { caseId, instance } = startCase("daily-2026-06-24", "alice");

    // Perfect interrogation reaches every clue; the blind solver finds the killer.
    const solvedKiller = perfectSolve(instance).killerId;
    expect(solvedKiller).toBe(instance.killerId); // server self-check: solvable

    const res = await accuse(redis, {
      caseId,
      playerId: "alice",
      instance,
      nominatedKillerId: solvedKiller!,
      nominations: { [solvedKiller!]: "killer" },
      discoveredClueIds: perfectSolve(instance).reachedClueIds,
      inventory: [],
      questions: 4,
      timeMs: 90_000,
      today: "2026-06-24",
    });

    expect(res.solved).toBe(true);
    expect(res.score).toBeGreaterThan(0);
    expect(res.rank).toBe(0);
    expect(res.streak.count).toBe(1);
    expect((await loadState(redis, caseId, "alice"))?.outcome?.solved).toBe(true);
  });

  it("a wrong accusation does not solve, and aggregate metrics tally correctly", async () => {
    const redis = new FakeRedis();
    const { caseId, instance } = startCase("daily-x", "alice");
    const killer = perfectSolve(instance).killerId!;
    const innocent = instance.suspectIds.find((s) => s !== killer)!;

    // alice solves; bob accuses an innocent but had tagged the real killer as a suspect.
    await accuse(redis, { caseId, playerId: "alice", instance, nominatedKillerId: killer, nominations: { [killer]: "killer" }, discoveredClueIds: [], inventory: [], questions: 5, timeMs: 100_000, today: "2026-06-24" });
    const bob = await accuse(redis, { caseId, playerId: "bob", instance, nominatedKillerId: innocent, nominations: { [killer]: "suspect", [innocent]: "killer" }, discoveredClueIds: [], inventory: [], questions: 8, timeMs: 300_000, today: "2026-06-24" });

    expect(bob.solved).toBe(false);

    const stats = await snapshotDailyStats(redis, caseId);
    expect(stats.total).toBe(2);
    expect(stats.killerRight).toBe(1);
    expect(stats.suspected).toBe(1); // bob suspected the killer but didn't name them
    expect(stats.mostNominatedKillers[0]?.member).toBeDefined();
  });
});
