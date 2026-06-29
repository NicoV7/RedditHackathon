import { describe, it, expect } from "vitest";
import { rngFromString } from "../../../shared/prng.js";
import type { PersonaSkill } from "./types.js";
import { pickDailyMood } from "./overlay.js";

// ──────────────────────────────────────────────────────────────────────────
// Minimal stub PersonaSkill
// ──────────────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<PersonaSkill> & { npcId: PersonaSkill["npcId"] }): PersonaSkill {
  return {
    speech: {
      register: "formal",
      tics: [],
      forbidden: [],
    },
    background: {
      origin: "London",
      occupationColor: "bartender",
      era: "1920s",
    },
    disposition: {
      cooperation: "guarded",
      underPressure: "deflects with charm",
      deflectStyle: "changes the subject",
    },
    relationships: [],
    boundaries: {
      refusalStyle: "polite rebuff",
      offLimits: [],
      deflectionTemplates: [
        "I'd rather not say.",
        "That's not something I discuss with strangers.",
      ],
    },
    dailyMoods: overrides.dailyMoods ?? ["somber", "chipper", "cagey"],
    tellLines: {},
    evalAnchors: {
      voiceExemplars: [],
      mustNotSay: [],
      inCharacterTopics: [],
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────

describe("pickDailyMood()", () => {
  it("returns undefined when dailyMoods is empty", () => {
    const skill = makeSkill({ npcId: "lola", dailyMoods: [] });
    expect(pickDailyMood(skill, "salt-abc")).toBeUndefined();
  });

  it("returns a member of dailyMoods for a non-empty pool", () => {
    const skill = makeSkill({ npcId: "max", dailyMoods: ["somber", "chipper", "cagey"] });
    const result = pickDailyMood(skill, "test-salt");
    expect(["somber", "chipper", "cagey"]).toContain(result);
  });

  it("is deterministic for the same (runSalt, npcId) pair — called twice in the same run", () => {
    const skill = makeSkill({ npcId: "lola", dailyMoods: ["brooding", "jolly", "wary"] });
    const a = pickDailyMood(skill, "parlor-run-001");
    const b = pickDailyMood(skill, "parlor-run-001");
    expect(a).toBe(b);
  });

  it("is deterministic across independently constructed skill objects with the same npcId", () => {
    const skill1 = makeSkill({ npcId: "vera", dailyMoods: ["cold", "warm", "nervous"] });
    const skill2 = makeSkill({ npcId: "vera", dailyMoods: ["cold", "warm", "nervous"] });
    expect(pickDailyMood(skill1, "salt-x")).toBe(pickDailyMood(skill2, "salt-x"));
  });

  it("produces the same result as directly calling rngFromString with the expected seed key", () => {
    const skill = makeSkill({ npcId: "gideon", dailyMoods: ["morose", "lively", "tense", "detached"] });
    const runSalt = "instance-7";
    // Mirror the implementation: seed = `mood:${runSalt}:${npcId}`
    const expected = skill.dailyMoods[
      rngFromString(`mood:${runSalt}:${skill.npcId}`).int(skill.dailyMoods.length)
    ];
    expect(pickDailyMood(skill, runSalt)).toBe(expected);
  });

  it("different npcIds with the same salt can select different moods", () => {
    const moods = ["melancholic", "boisterous", "reticent", "animated", "withdrawn"];
    const skillA = makeSkill({ npcId: "npc-alpha", dailyMoods: moods });
    const skillB = makeSkill({ npcId: "npc-beta", dailyMoods: moods });

    const moodA = pickDailyMood(skillA, "shared-salt");
    const moodB = pickDailyMood(skillB, "shared-salt");

    // The seed strings differ (`mood:shared-salt:npc-alpha` vs `mood:shared-salt:npc-beta`),
    // so the hashes differ. With this particular salt + these npcIds, confirm they diverge.
    // (If they happen to collide, the test would be vacuous — but the structural guarantee
    //  is the seed-string isolation, validated by the seed-string test above.)
    expect(moodA).toBeDefined();
    expect(moodB).toBeDefined();
    // These two specific ids + salt produce different indices.
    expect(moodA).not.toBe(moodB);
  });

  it("different salts with the same npcId can select different moods", () => {
    const moods = ["glum", "bright", "terse", "effusive", "curt"];
    const skill = makeSkill({ npcId: "lola", dailyMoods: moods });

    const moodDay1 = pickDailyMood(skill, "run-day-1");
    const moodDay2 = pickDailyMood(skill, "run-day-2");

    expect(moodDay1).toBeDefined();
    expect(moodDay2).toBeDefined();
    // Different salts produce different hashes → at least these two particular salts diverge.
    expect(moodDay1).not.toBe(moodDay2);
  });

  it("seed string is composed of runSalt and npcId only — no killer data", () => {
    // The implementation seeds via `mood:${runSalt}:${npcId}`.
    // Here we verify structurally: injecting a fake killerId into the runSalt does NOT
    // change the result compared to the clean runSalt, because killerId is not a parameter.
    const skill = makeSkill({ npcId: "max", dailyMoods: ["cold", "warm", "nervous"] });
    const runSalt = "daily-abc";

    // Simulated "leaking" attempt: if killerId were appended, the seed would change.
    // Confirm that the module uses only `mood:${runSalt}:${npcId}` — any seed that
    // differs from that key would yield a different result for at least one mood pool.
    const legitimateSeed = `mood:${runSalt}:${skill.npcId}`;
    const leakyKillerSeed = `mood:${runSalt}:killer-max:${skill.npcId}`;

    const legit = rngFromString(legitimateSeed).int(skill.dailyMoods.length);
    const leaky = rngFromString(leakyKillerSeed).int(skill.dailyMoods.length);

    // The two seeds produce different indices (confirmed: different strings → different hashes).
    expect(legit).not.toBe(leaky);

    // pickDailyMood returns the value consistent with the legitimate, killer-blind seed.
    expect(pickDailyMood(skill, runSalt)).toBe(skill.dailyMoods[legit]);
    expect(pickDailyMood(skill, runSalt)).not.toBe(skill.dailyMoods[leaky]);
  });

  it("works correctly with a single-entry mood pool (always returns that entry)", () => {
    const skill = makeSkill({ npcId: "vera", dailyMoods: ["only-mood"] });
    expect(pickDailyMood(skill, "any-salt")).toBe("only-mood");
  });

  it("result index is always within the valid range of the dailyMoods array", () => {
    const moods = ["a", "b", "c", "d", "e", "f", "g"];
    // Test many different salt/npcId combos to exercise the bounds.
    const salts = ["s1", "s2", "s3", "s4", "s5"];
    const npcIds = ["alice", "bob", "carol", "dave", "eve"];
    for (const salt of salts) {
      for (const npcId of npcIds) {
        const skill = makeSkill({ npcId, dailyMoods: moods });
        const result = pickDailyMood(skill, salt);
        expect(moods).toContain(result);
      }
    }
  });
});
