import { describe, it, expect } from "vitest";
import { FakeRedis, TTL_30D } from "../redis/redis.js";
import {
  logPlayerEvent,
  memoryForNpc,
  playerEventLogKeys,
  recentEventsForNpc,
  recentPlayerEvents,
  recordNomination,
  recordOutcome,
  snapshotDailyStats,
  type PlayerEvent,
} from "./events.js";

const ev = (over: Partial<PlayerEvent>): PlayerEvent => ({
  kind: "askedTopic",
  tick: 0,
  zone: "bar",
  summary: "the detective asked about the relic",
  witnessedBy: [],
  ...over,
});

describe("C17 perception / event log", () => {
  it("only NPCs in witnessedBy receive the event (perception gate)", async () => {
    const r = new FakeRedis();
    await logPlayerEvent(r, "alice", "case1", ev({ tick: 1, zone: "bar", witnessedBy: ["lola", "max"] }));
    await logPlayerEvent(r, "alice", "case1", ev({ tick: 2, zone: "kitchen", witnessedBy: ["max"] }));

    expect(await memoryForNpc(r, "alice", "case1", "lola")).toHaveLength(1);
    expect(await memoryForNpc(r, "alice", "case1", "max")).toHaveLength(2);
    // An NPC that witnessed nothing has an empty memory slot.
    expect(await memoryForNpc(r, "alice", "case1", "ghost")).toEqual([]);
  });

  it("returns events recency-ranked (newest first) and respects the limit", async () => {
    const r = new FakeRedis();
    for (let t = 1; t <= 5; t++) {
      await logPlayerEvent(r, "alice", "case1", ev({ tick: t, summary: `turn ${t}`, witnessedBy: ["lola"] }));
    }
    const recent = await recentEventsForNpc(r, "alice", "case1", "lola", 3);
    expect(recent.map((e) => e.summary)).toEqual(["turn 5", "turn 4", "turn 3"]);
    // seq is monotonic and matches insertion order
    expect(recent.map((e) => e.seq)).toEqual([5, 4, 3]);
  });

  it("stamps each event with logical tick + zone and the full timeline reads newest-first", async () => {
    const r = new FakeRedis();
    await logPlayerEvent(r, "alice", "case1", ev({ kind: "tookItem", tick: 3, zone: "alley", subjectId: "knife", witnessedBy: [] }));
    await logPlayerEvent(r, "alice", "case1", ev({ kind: "caughtInLie", tick: 4, zone: "vip", subjectId: "lola", witnessedBy: ["lola"] }));
    const all = await recentPlayerEvents(r, "alice", "case1");
    const [first, second] = all;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.kind).toBe("caughtInLie");
    expect(first?.tick).toBe(4);
    expect(first?.zone).toBe("vip");
    expect(second?.kind).toBe("tookItem");
    expect(second?.subjectId).toBe("knife");
  });

  it("de-dupes a witness listed twice for one event", async () => {
    const r = new FakeRedis();
    await logPlayerEvent(r, "alice", "case1", ev({ tick: 1, witnessedBy: ["lola", "lola"] }));
    expect(await memoryForNpc(r, "alice", "case1", "lola")).toHaveLength(1);
  });

  it("event-log keys are isolated per (player, case)", async () => {
    const r = new FakeRedis();
    await logPlayerEvent(r, "alice", "case1", ev({ witnessedBy: ["lola"] }));
    await logPlayerEvent(r, "bob", "case1", ev({ witnessedBy: ["lola"] }));
    await logPlayerEvent(r, "alice", "case2", ev({ witnessedBy: ["lola"] }));
    expect(await memoryForNpc(r, "alice", "case1", "lola")).toHaveLength(1);
    expect(await memoryForNpc(r, "bob", "case1", "lola")).toHaveLength(1);
    expect(await memoryForNpc(r, "alice", "case2", "lola")).toHaveLength(1);
  });

  it("every event-log key carries a ≤30-day TTL", async () => {
    const r = new FakeRedis();
    await logPlayerEvent(r, "alice", "case1", ev({ witnessedBy: ["lola"] }));
    for (const k of ["evlog:alice:case1", "evseq:alice:case1", "evnpc:alice:case1:lola"]) {
      const t = await r.ttl(k);
      expect(t, k).toBeGreaterThan(0);
      expect(t, k).toBeLessThanOrEqual(TTL_30D);
    }
  });

  it("playerEventLogKeys enumerates evlog/evseq/evnpc for purge", () => {
    const keys = playerEventLogKeys("alice", [{ caseId: "case1", npcIds: ["lola", "max"] }, { caseId: "case2" }]);
    expect(keys).toContain("evlog:alice:case1");
    expect(keys).toContain("evseq:alice:case1");
    expect(keys).toContain("evnpc:alice:case1:lola");
    expect(keys).toContain("evnpc:alice:case1:max");
    expect(keys).toContain("evlog:alice:case2");
    expect(keys).toContain("evseq:alice:case2");
  });

  it("existing aggregate metrics still work alongside the event log", async () => {
    const r = new FakeRedis();
    await recordNomination(r, "case1", "killer", "lola");
    await recordOutcome(r, "case1", { gotKillerRight: true, suspectedKiller: false, discoveredClueRoles: ["weapon"] });
    const stats = await snapshotDailyStats(r, "case1");
    expect(stats.total).toBe(1);
    expect(stats.killerRight).toBe(1);
    expect(stats.clueDiscoveryRates.weapon).toBe(1);
    expect(stats.mostNominatedKillers[0]?.member).toBe("lola");
  });
});
