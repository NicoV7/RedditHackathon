/**
 * Compliance (submission-gating) tests for the server surface (D1):
 *  1. DELETION-HONORING — the delete trigger purges EVERY per-player key class.
 *  2. tick TTL — /move stamps a ≤30d TTL on the logical-tick key.
 *  3. tick in purge — the per-case tick key is dropped on deletion.
 *  4. leaderboard zRem — the player's member is removed from the SHARED set.
 *  5. FREE-TEXT BOUND — interrogation input is truncated server-side before LLM.
 */
import { describe, it, expect } from "vitest";
import { createHandlers, defaultDeps, boundInterrogationMessage, MAX_INTERROGATION_CHARS } from "./index.js";
import { FakeRedis, TTL_30D } from "./redis/redis.js";
import { generateTemplate, drawInstance } from "./case/procedural.js";
import type { ModerationResult } from "./llm/provider.js";

/** A del-capable FakeRedis (mirrors the real Devvit client) so the purge truly
 *  removes keys rather than only scheduling a 1s TTL. */
class DeletableFakeRedis extends FakeRedis {
  async del(key: string): Promise<void> {
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
  /** test helper: every key the store currently holds (any type). */
  allKeys(): string[] {
    const self = this as unknown as {
      str: Map<string, string>;
      hash: Map<string, string>;
      zset: Map<string, string>;
    };
    return [...new Set([...self.str.keys(), ...self.hash.keys(), ...self.zset.keys()])];
  }
}

function serverInstance(dailySeed: string, playerId: string) {
  return drawInstance(generateTemplate(dailySeed), playerId);
}

describe("compliance: deletion-honoring delete trigger (D1.1)", () => {
  it("purges every per-player key class after a delete trigger, leaving other players' data", async () => {
    const r = new DeletableFakeRedis();
    const deps = { ...defaultDeps(), redis: r };
    const h = createHandlers(deps);
    const dailySeed = "2026-06-24";
    const player = "alice";
    const inst = serverInstance(dailySeed, player);

    // Drive a realistic play session so per-player keys exist across classes.
    const { view } = await h.startCase({ dailySeed }, player);
    const principal = view.npcs.find((n) => n.tier === "principal")!;
    await h.move({ caseId: view.caseId, dailySeed, zoneId: principal.homeZone, tick: 2 }, player);
    await h.interrogate({ caseId: view.caseId, dailySeed, npcId: principal.id, message: "where were you?" }, player);
    if (view.items[0]) await h.examine({ caseId: view.caseId, dailySeed, itemId: view.items[0].id }, player);
    await h.saveState(
      { dailySeed, dayId: "2026-06-24", posZone: principal.homeZone, boardGraph: {}, inventory: [], transcriptRef: "x", questionsUsed: 1, elapsedMs: 1000 },
      player,
    );
    await h.accuse(
      { caseId: view.caseId, dailySeed, nominatedKillerId: inst.killerId, nominations: { [inst.killerId]: "killer" }, discoveredClueIds: inst.solution.supportingClueIds, inventory: [], questions: 1, timeMs: 1000 },
      player,
      "2026-06-24",
    );

    // A SECOND player's data must survive the purge (deletion is scoped to alice).
    await h.startCase({ dailySeed }, "bob");
    await h.move({ caseId: view.caseId, dailySeed, zoneId: principal.homeZone, tick: 1 }, "bob");
    await h.accuse(
      { caseId: view.caseId, dailySeed, nominatedKillerId: serverInstance(dailySeed, "bob").killerId, nominations: { [serverInstance(dailySeed, "bob").killerId]: "killer" }, discoveredClueIds: serverInstance(dailySeed, "bob").solution.supportingClueIds, inventory: [], questions: 1, timeMs: 1000 },
      "bob",
      "2026-06-24",
    );

    // Sanity: alice has per-player keys before the trigger.
    const before = r.allKeys();
    expect(before.some((k) => k.includes(":alice") || k.endsWith("alice"))).toBe(true);

    // Fire the deletion trigger for alice.
    const res = await h.handleDeleteTrigger(player);
    expect(res.purged).toBe(true);
    expect(res.scope.caseIds).toContain(view.caseId);

    // NO per-player alice key survives (member-suffixed lb member excluded — it's a member, not a key).
    const after = r.allKeys();
    const aliceKeys = after.filter((k) => k === `streak:alice` || k === `detective:alice` || k === `scope:alice` || k.includes(":alice:") || k.endsWith(":alice"));
    expect(aliceKeys, `surviving alice keys: ${aliceKeys.join(", ")}`).toEqual([]);

    // alice's leaderboard MEMBER is gone; bob's score remains in the shared set.
    expect(await r.zScore(`lb:${view.caseId}`, "alice")).toBeNull();
    expect(await r.zScore(`lb:${view.caseId}`, "bob")).not.toBeNull();

    // bob's per-player keys still exist.
    expect(after.some((k) => k.endsWith(":bob") || k.includes(":bob:"))).toBe(true);
  });

  it("delete trigger is idempotent and safe for a player that never played", async () => {
    const r = new DeletableFakeRedis();
    const h = createHandlers({ ...defaultDeps(), redis: r });
    await h.handleDeleteTrigger("ghost"); // no data
    await h.handleDeleteTrigger("ghost"); // second fire must not throw
    expect(r.allKeys().some((k) => k.includes("ghost"))).toBe(false);
  });
});

describe("compliance: tick key TTL (D1.2 + D1.4)", () => {
  it("/move stamps a ≤30d TTL on the logical-tick key", async () => {
    const r = new FakeRedis();
    const h = createHandlers({ ...defaultDeps(), redis: r });
    const dailySeed = "d";
    const { view } = await h.startCase({ dailySeed }, "alice");
    await h.move({ caseId: view.caseId, dailySeed, zoneId: view.npcs[0]!.homeZone, tick: 5 }, "alice");
    const tickK = `tick:${view.caseId}:alice`;
    const ttl = await r.ttl(tickK);
    expect(ttl, tickK).toBeGreaterThan(0);
    expect(ttl, tickK).toBeLessThanOrEqual(TTL_30D);
  });
});

describe("compliance: bounded free-text interrogation (D1.5)", () => {
  it("truncates over-long input to the server ceiling before moderation/LLM", () => {
    const short = "where were you at midnight?";
    expect(boundInterrogationMessage(short)).toEqual({ message: short, truncated: false });

    const long = "a".repeat(MAX_INTERROGATION_CHARS + 100);
    const out = boundInterrogationMessage(long);
    expect(out.truncated).toBe(true);
    expect(out.message.length).toBe(MAX_INTERROGATION_CHARS);
  });

  it("the interrogate handler bounds input end-to-end (the NPC never sees over-long text)", async () => {
    // A provider that echoes the moderated message length back so we can assert the bound.
    const seen: number[] = [];
    const deps = defaultDeps();
    const base = deps.provider;
    const provider: typeof base = {
      name: base.name,
      complete: (req) => base.complete(req),
      async moderate(msg: string): Promise<ModerationResult> {
        seen.push(msg.length);
        return { flagged: false };
      },
    };
    const h = createHandlers({ ...deps, provider });
    const dailySeed = "d";
    const { view } = await h.startCase({ dailySeed }, "alice");
    const npc = view.npcs[0]!;
    await h.interrogate({ caseId: view.caseId, dailySeed, npcId: npc.id, message: "z".repeat(5000) }, "alice");
    expect(seen[0]).toBe(MAX_INTERROGATION_CHARS); // moderation saw the truncated text
  });
});
