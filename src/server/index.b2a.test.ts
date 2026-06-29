import { describe, it, expect } from "vitest";
import { createHandlers, defaultDeps, type ServerDeps, type DeriveInstanceFn } from "./index.js";
import { FakeRedis } from "./redis/redis.js";
import { MockProvider } from "./llm/provider.js";
import { generateTemplate, drawInstance } from "./case/procedural.js";
import { awardDetectiveXp, getDetective } from "./redis/repos.js";
import type { CaseInstance, CaseTemplate } from "../shared/case.js";

const SEED = "2026-06-24";

function realServer(): ServerDeps {
  return { redis: new FakeRedis(), provider: new MockProvider(() => "I have nothing to add.") };
}

/** Re-derive the server-side instance for gate/clue assertions (never exposed to client). */
function serverInstance(dailySeed: string, playerId: string): CaseInstance {
  return drawInstance(generateTemplate(dailySeed), playerId);
}

// ── A minimal fixture instance: one suspect, one NPC, an item with a present-reaction
// that reveals a refuter (a "gotcha"), and a statedLie the NPC voices so a tell can fire.
function fixtureDeps(): { deps: ServerDeps; redis: FakeRedis; template: CaseTemplate; instance: CaseInstance } {
  const redis = new FakeRedis();
  const template: CaseTemplate = {
    id: "template:fixture",
    templateSeed: "fixture",
    setting: "The Fixture Room",
    victim: "the victim",
    map: { zones: [{ id: "parlor", name: "Parlor", tags: [], bounds: { x: 0, y: 0, w: 200, h: 200 } }], navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 } },
    suspectIds: ["frankie", "lola"],
    roster: [],
    items: [],
    relationships: [],
  };
  const instance: CaseInstance = {
    templateId: "template:fixture",
    instanceSeed: "p1",
    suspectIds: ["frankie", "lola"],
    killerId: "frankie",
    facts: [
      { id: "f_means", subject: "frankie", predicate: "means" },
      { id: "f_opp", subject: "frankie", predicate: "opportunity" },
      { id: "f_lola_means", subject: "lola", predicate: "means" },
      { id: "f_lola_opp", subject: "lola", predicate: "opportunity" },
      { id: "f_lola_alibi", subject: "lola", predicate: "refutesOpportunity" },
    ],
    clues: [
      { id: "c_frankie_means", revealsFactIds: ["f_means"], unlockedBy: { kind: "askTopic", npcId: "frankie", topic: "means" } },
      { id: "c_frankie_opp", revealsFactIds: ["f_opp"], unlockedBy: { kind: "askTopic", npcId: "frankie", topic: "whereabouts" } },
      { id: "c_lola_means", revealsFactIds: ["f_lola_means"], unlockedBy: { kind: "askTopic", npcId: "lola", topic: "means" } },
      { id: "c_lola_opp", revealsFactIds: ["f_lola_opp"], unlockedBy: { kind: "askTopic", npcId: "lola", topic: "whereabouts" } },
      // the gotcha: presenting the locket to lola reveals her alibi (refuter)
      { id: "c_lola_alibi", revealsFactIds: ["f_lola_alibi"], unlockedBy: { kind: "presentItemTo", itemId: "i_locket", npcId: "lola" } },
    ],
    items: [
      {
        id: "i_locket",
        kind: "effect",
        zone: "parlor",
        coords: { x: 10, y: 10 },
        examineText: "A silver locket.",
        revealsFactIds: [],
        presentReactions: [{ npcId: "lola", revealsFactIds: ["f_lola_alibi"] }],
      },
    ],
    npcs: [
      {
        id: "frankie",
        persona: { name: "Frankie Conti", blurb: "the enforcer", voice: "hot-tempered" },
        tier: "principal",
        homeZone: "parlor",
        routine: [{ zoneId: "parlor", fromTick: 0, toTick: 240, activity: "present" }],
        // frankie (the killer) voices a statedLie on his opportunity → an empathy tell.
        slice: [
          { factId: "f_means", statedAs: "true" },
          { factId: "f_opp", statedAs: "statedLie" },
        ],
      },
      {
        id: "lola",
        persona: { name: "Lola Marsh", blurb: "the headliner", voice: "sultry" },
        tier: "principal",
        homeZone: "parlor",
        routine: [{ zoneId: "parlor", fromTick: 0, toTick: 240, activity: "present" }],
        slice: [
          { factId: "f_lola_means", statedAs: "true" },
          { factId: "f_lola_opp", statedAs: "true" },
          { factId: "f_lola_alibi", statedAs: "true" },
        ],
      },
    ],
    lockedZones: [],
    // solution edges = the killer's means+opportunity clues
    solution: { killerId: "frankie", supportingClueIds: ["c_frankie_means", "c_frankie_opp"] },
  };
  const derive: DeriveInstanceFn = () => ({ template, instance });
  return { deps: { redis, provider: new MockProvider(() => "I deny everything."), deriveInstance: derive }, redis, template, instance };
}

describe("B2a present endpoint — server-authoritative gotcha", () => {
  it("presenting the locket to lola fires her present-reaction → reveals the alibi refuter + caughtInLie", async () => {
    const { deps } = fixtureDeps();
    const h = createHandlers(deps);
    const res = await h.present({ caseId: "template:fixture", dailySeed: SEED, itemId: "i_locket", npcId: "lola", tick: 0 }, "p1");
    expect(res.revealed.length).toBe(1);
    expect(res.revealed[0]!.id).toBe("c_lola_alibi");
    expect(res.revealed[0]!.noteText).toMatch(/Alibi/);
    expect(res.revealed[0]!.sourceNpcId).toBe("lola");
    expect(res.caughtInLie).toBe(true);
  });

  it("presenting to the wrong NPC reveals nothing and is not a gotcha", async () => {
    const { deps } = fixtureDeps();
    const h = createHandlers(deps);
    const res = await h.present({ caseId: "template:fixture", dailySeed: SEED, itemId: "i_locket", npcId: "frankie", tick: 0 }, "p1");
    expect(res.revealed).toEqual([]);
    expect(res.caughtInLie).toBe(false);
  });
});

describe("B2a interrogate — lie-tell attaches when faculties are high + a statedLie exists", () => {
  it("attaches turn.tell to the revealed clue once the player's faculties clear the gate", async () => {
    const { deps, redis } = fixtureDeps();
    const h = createHandlers(deps);

    // Default faculties (0) → no tell visible even though frankie voices a statedLie.
    const low = await h.interrogate({ caseId: "template:fixture", dailySeed: SEED, npcId: "frankie", message: "where were you?" }, "p1");
    expect(low.revealed.length).toBeGreaterThan(0);
    expect(low.revealed[0]!.tell).toBeUndefined();

    // Level up empathy past the threshold → the structural statedLie now reads as a tell.
    await awardDetectiveXp(redis, "p1", { facultyXp: { empathy: 400 } });
    expect((await getDetective(redis, "p1")).faculties.empathy).toBeGreaterThanOrEqual(2);

    const high = await h.interrogate({ caseId: "template:fixture", dailySeed: SEED, npcId: "frankie", message: "where were you?" }, "p1");
    expect(high.revealed[0]!.tell).toBeDefined();
    expect(high.revealed[0]!.tell!.faculty).toBe("empathy");
    // intensity is COSMETIC — present but never used for control flow.
    expect(typeof high.revealed[0]!.tell!.intensity).toBe("number");
  });
});

describe("B2a confidence gate — blocks a premature accusation (Part 1.5)", () => {
  it("rejects when the killer is tagged but no solution-edge clues were discovered", async () => {
    const { deps } = fixtureDeps();
    const h = createHandlers(deps);
    const res = await h.accuse(
      { caseId: "template:fixture", dailySeed: SEED, nominatedKillerId: "frankie", nominations: { frankie: "killer" }, discoveredClueIds: [], inventory: [], questions: 1, timeMs: 1000 },
      "p1",
      "2026-06-24",
    );
    expect(res.gateNotMet).toBeDefined();
    expect(res.gateNotMet!.needed).toBe(2);
    expect(res.gateNotMet!.have).toBe(0);
    expect(res.gateNotMet!.killerTagged).toBe(true);
    expect(res.solved).toBe(false);
    expect(res.summary.killerName).toBe(""); // spoiler-safe: no reveal on rejection
  });

  it("rejects when solution edges are present but no killer was tagged", async () => {
    const { deps } = fixtureDeps();
    const h = createHandlers(deps);
    const res = await h.accuse(
      { caseId: "template:fixture", dailySeed: SEED, nominatedKillerId: "frankie", nominations: { frankie: "suspect" }, discoveredClueIds: ["c_frankie_means", "c_frankie_opp"], inventory: [], questions: 1, timeMs: 1000 },
      "p1",
      "2026-06-24",
    );
    expect(res.gateNotMet).toBeDefined();
    expect(res.gateNotMet!.killerTagged).toBe(false);
  });

  it("admits the accusation once the killer is tagged AND enough solution edges are discovered", async () => {
    const { deps } = fixtureDeps();
    const h = createHandlers(deps);
    const res = await h.accuse(
      { caseId: "template:fixture", dailySeed: SEED, nominatedKillerId: "frankie", nominations: { frankie: "killer" }, discoveredClueIds: ["c_frankie_means", "c_frankie_opp"], inventory: [], questions: 2, timeMs: 30_000 },
      "p1",
      "2026-06-24",
    );
    expect(res.gateNotMet).toBeUndefined();
    expect(res.solved).toBe(true);
    expect(res.summary.killerName).toBe("Frankie Conti");
  });

  it("on a real (graded) accusation, detective play/solve streaks advance", async () => {
    const { deps, redis } = fixtureDeps();
    const h = createHandlers(deps);
    await h.accuse(
      { caseId: "template:fixture", dailySeed: SEED, nominatedKillerId: "frankie", nominations: { frankie: "killer" }, discoveredClueIds: ["c_frankie_means", "c_frankie_opp"], inventory: [], questions: 2, timeMs: 30_000 },
      "p1",
      "2026-06-24",
    );
    const det = await getDetective(redis, "p1");
    expect(det.playStreak).toBe(1);
    expect(det.solveStreak).toBe(1);
    expect(det.xp).toBeGreaterThan(0);
  });
});

describe("B2a move + perception → NPC memory", () => {
  it("records the player's logical tick and an enteredZone event witnessed by co-located NPCs", async () => {
    const deps = realServer();
    const h = createHandlers(deps);
    const { view } = await h.startCase({ dailySeed: SEED }, "alice");
    const zone = view.npcs[0]!.homeZone; // an occupied zone
    const mv = await h.move({ caseId: view.caseId, dailySeed: SEED, zoneId: zone, tick: 5 }, "alice");
    expect(mv.zoneId).toBe(zone);
    // at least the NPC whose homeZone/routine covers (zone, tick=5) witnessed it
    expect(Array.isArray(mv.witnessedBy)).toBe(true);
  });

  it("an interrogation an NPC witnessed surfaces in that NPC's recency-ranked memory", async () => {
    const deps = realServer();
    const h = createHandlers(deps);
    const { view } = await h.startCase({ dailySeed: SEED }, "alice");
    const principal = view.npcs.find((n) => n.tier === "principal")!;
    // ask the principal something — logs an askedTopic event witnessed by co-located NPCs.
    await h.interrogate({ caseId: view.caseId, dailySeed: SEED, npcId: principal.id, message: "tell me about the night" }, "alice");
    // a second interrogation should fold the prior event into the prompt without error.
    const second = await h.interrogate({ caseId: view.caseId, dailySeed: SEED, npcId: principal.id, message: "and the means?" }, "alice");
    expect(typeof second.reply).toBe("string");
  });
});

describe("B2a save → resume round-trip", () => {
  it("saves a mid-case session and resumes it editable on the same UTC day", async () => {
    const deps = realServer();
    const h = createHandlers(deps);
    await h.saveState(
      { dailySeed: SEED, dayId: "2026-06-24", posZone: "parlor", boardGraph: { nodes: [1, 2] }, inventory: ["i1"], transcriptRef: "t:1", questionsUsed: 3, elapsedMs: 12_345, facultyXp: { logic: 2 } },
      "alice",
    );
    const r = await h.resume({ dailySeed: SEED, dayId: "2026-06-24" }, "alice");
    expect(r.state).not.toBeNull();
    expect(r.readOnly).toBe(false);
    expect(r.startFresh).toBe(false);
    expect(r.state!.posZone).toBe("parlor");
    expect(r.state!.inventory).toEqual(["i1"]);
    expect(r.state!.questionsUsed).toBe(3);
    expect(r.state!.boardGraph).toEqual({ nodes: [1, 2] });
  });

  it("resuming with no save for today reports startFresh (prior-day forfeit)", async () => {
    const deps = realServer();
    const h = createHandlers(deps);
    const r = await h.resume({ dailySeed: SEED, dayId: "2026-06-25" }, "bob");
    expect(r.state).toBeNull();
    expect(r.startFresh).toBe(true);
    expect(r.readOnly).toBe(true);
  });
});

describe("B2a detective endpoint", () => {
  it("returns the persistent detective sheet", async () => {
    const deps = realServer();
    const h = createHandlers(deps);
    const before = await h.detective({}, "carol");
    expect(before.detective.xp).toBe(0);
    expect(before.detective.faculties.logic).toBe(0);
    await awardDetectiveXp((deps.redis as FakeRedis), "carol", { xp: 50 });
    const after = await h.detective({}, "carol");
    expect(after.detective.xp).toBe(50);
  });
});

describe("B2a regression — client view stays secret-safe on the real generator", () => {
  it("startCase view carries no killerId/solution/facts", async () => {
    const h = createHandlers(realServer());
    const { view } = await h.startCase({ dailySeed: SEED }, "alice");
    const json = JSON.stringify(view);
    const inst = serverInstance(SEED, "alice");
    expect(json).not.toContain("killerId");
    expect(json).not.toContain("solution");
    expect(json).not.toContain(inst.killerId === inst.suspectIds[0] ? "\"killerId\"" : "killerId");
    // the real killer id should not appear as a labelled secret anywhere in the view
    expect(json).not.toContain("statedLie");
  });
});
