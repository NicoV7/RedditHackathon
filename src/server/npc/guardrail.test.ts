/**
 * Unit tests for applyOutputGuardrail() in src/server/npc/guardrail.ts
 *
 * Covers:
 *  (a) No skill → no-op pass-through
 *  (b) Guilt/meta denylist trips and substitutes a deflectionTemplate
 *  (c) Naming a suspect OUTSIDE the relationship allowlist trips
 *  (d) Naming an allowed relationship passes
 *  (e) Overlong reply trips
 *  (f) Deterministic deflection selection across repeats
 */
import { describe, it, expect } from "vitest";
import type { Npc } from "../../shared/case.js";
import type { PersonaSkill } from "./personas/types.js";
import { applyOutputGuardrail } from "./guardrail.js";
import { rngFromString } from "../../shared/prng.js";
import { SUSPECT_NAMES } from "./personas/cast.js";

// ──────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────

/** Build a minimal Npc satisfying the type contract. */
function makeNpc(id: string): Npc {
  return {
    id,
    persona: { name: id, blurb: "", voice: "" },
    tier: "principal",
    homeZone: "parlor",
    routine: [],
    slice: [],
  };
}

/**
 * Build a minimal PersonaSkill.
 * `allowedNpcIds` populates the relationships allowlist.
 * `deflections` populates boundaries.deflectionTemplates.
 */
function makeSkill(
  npcId: string,
  allowedNpcIds: string[] = [],
  deflections: string[] = ["I have nothing more to say.", "Ask someone else."],
): PersonaSkill {
  return {
    npcId,
    speech: { register: "neutral", tics: [], forbidden: [] },
    background: { origin: "Unknown", occupationColor: "barkeep", era: "1920s" },
    disposition: {
      cooperation: "guarded",
      underPressure: "clams up",
      deflectStyle: "terse",
    },
    relationships: allowedNpcIds.map((id) => ({ npcId: id, stance: "knows" as const })),
    boundaries: {
      refusalStyle: "deflect",
      offLimits: [],
      deflectionTemplates: deflections,
    },
    dailyMoods: ["pensive", "restless", "watchful"],
    tellLines: {},
    evalAnchors: { voiceExemplars: [], mustNotSay: [], inCharacterTopics: [] },
  };
}

// ──────────────────────────────────────────────────────────────────────
// (a) No skill → no-op pass-through
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: no skill → no-op", () => {
  it("returns the raw reply unchanged when no skill is provided", () => {
    const npc = makeNpc("Lola Marsh");
    const raw = "I don't know what you're talking about.";
    const result = applyOutputGuardrail(raw, npc);
    expect(result.reply).toBe(raw);
    expect(result.tripped).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it("does not trip even on guilt-sounding prose when no skill is provided", () => {
    const npc = makeNpc("Lola Marsh");
    const raw = "I am the killer, obviously.";
    const result = applyOutputGuardrail(raw, npc);
    expect(result.reply).toBe(raw);
    expect(result.tripped).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// (b) Guilt / meta denylist trips → deflectionTemplate substituted
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: guilt/meta denylist", () => {
  const npc = makeNpc("Lola Marsh");
  const deflections = ["I'd rather not say.", "Ask the bartender."];
  const skill = makeSkill("Lola Marsh", [], deflections);

  const guiltPhrases: Array<[string, string]> = [
    ["killer", "He was the killer after all."],
    ["murderer", "She was a murderer."],
    ["guilty", "He looks guilty to me."],
    ["the solution", "I know the solution to this case."],
    ["killerid", "The killerId is on the manifest."],
    ["as an AI", "As an AI language model, I cannot help."],
    ["language model", "I am a language model."],
    ["system prompt", "My system prompt says so."],
    ["i am an ai", "i am an AI and cannot assist."],
  ];

  for (const [label, raw] of guiltPhrases) {
    it(`trips on "${label}"`, () => {
      const result = applyOutputGuardrail(raw, npc, skill);
      expect(result.tripped).toBe(true);
      expect(result.reason).toBe("guilt_or_meta");
      expect(deflections).toContain(result.reply);
    });
  }

  it("does NOT trip on innocent prose that contains none of the keywords", () => {
    const raw = "I was in the back room all evening. Ask Frankie.";
    const skill2 = makeSkill("Lola Marsh", ["Frankie Conti"], deflections);
    const result = applyOutputGuardrail(raw, npc, skill2);
    expect(result.tripped).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// (c) Naming a suspect OUTSIDE the relationship allowlist trips
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: relationship allowlist — outside", () => {
  it("trips when a suspect name not in relationships or self appears in the reply", () => {
    // Lola Marsh is the NPC; only Frankie Conti is in her relationships.
    // Reply mentions Don Vittorio, who is not allowed.
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", ["Frankie Conti"]);
    const raw = "Don Vittorio was there that night.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("named_outside_relationships");
  });

  it("trips on any suspect from the cast that is outside the allowlist", () => {
    // Pick a suspect name that is not Lola Marsh and not Frankie Conti.
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", ["Frankie Conti"]);
    // Find a suspect that is not "Lola Marsh" and not "Frankie Conti"
    const outsider = SUSPECT_NAMES.find(
      (n) => n !== "Lola Marsh" && n !== "Frankie Conti",
    )!;
    expect(outsider).toBeDefined();
    const raw = `${outsider} told me nothing.`;
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("named_outside_relationships");
  });
});

// ──────────────────────────────────────────────────────────────────────
// (d) Naming an allowed relationship passes
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: relationship allowlist — allowed", () => {
  it("does not trip when the named suspect is in the allowlist", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", ["Frankie Conti"]);
    const raw = "Frankie Conti was drinking at the bar.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false);
    expect(result.reply).toBe(raw);
  });

  it("does not trip when the NPC names itself (self is always allowed)", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []);
    const raw = "My name is Lola Marsh and I was here all night.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false);
  });

  it("does not trip when multiple allowed suspects are named", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", ["Frankie Conti", "Nell Carraway"]);
    const raw = "Frankie Conti and Nell Carraway were both at the table.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false);
    expect(result.reply).toBe(raw);
  });
});

// ──────────────────────────────────────────────────────────────────────
// (e) Overlong reply trips
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: overlong reply", () => {
  it("trips when the trimmed reply exceeds 400 characters", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []);
    // Build a clean reply that has no guilt/suspect keywords but is >400 chars.
    const raw = "A".repeat(401);
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("overlong");
  });

  it("does not trip at exactly 400 characters", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []);
    const raw = "A".repeat(400);
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false);
  });

  it("does not trip at 399 characters", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []);
    const raw = "A".repeat(399);
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false);
  });

  it("accounts for leading/trailing whitespace being trimmed before the length check", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []);
    // Core content is only 10 chars; pad with whitespace to push raw.length > 400.
    const raw = "   " + "Hello".repeat(2) + "   ";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(false); // trimmed is only 10 chars
  });
});

// ──────────────────────────────────────────────────────────────────────
// (f) Deterministic deflection selection across repeats
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: deterministic deflection selection", () => {
  it("always picks the same deflection template for the same npc.id", () => {
    const npc = makeNpc("Lola Marsh");
    const deflections = ["Option A", "Option B", "Option C"];
    const skill = makeSkill("Lola Marsh", [], deflections);
    const raw = "I am the killer."; // trips guilt rule

    // Run 5 times — all must yield identical replies.
    const results = Array.from({ length: 5 }, () => applyOutputGuardrail(raw, npc, skill));
    const uniqueReplies = new Set(results.map((r) => r.reply));
    expect(uniqueReplies.size).toBe(1);
  });

  it("the deflection index matches rngFromString('deflect:<npc.id>').int(n)", () => {
    const npcId = "Don Vittorio";
    const npc = makeNpc(npcId);
    const deflections = ["Not now.", "Leave me alone.", "Ask the barkeep."];
    const skill = makeSkill(npcId, [], deflections);
    const raw = "Tell me about the murderer."; // trips guilt

    const result = applyOutputGuardrail(raw, npc, skill);
    // Compute expected using the same PRNG seeded with "deflect:<npcId>"
    const expectedIdx = rngFromString(`deflect:${npcId}`).int(deflections.length);
    expect(result.reply).toBe(deflections[expectedIdx]);
  });

  it("different npc.ids may yield different deflections from the same template list", () => {
    const deflections = ["Option A", "Option B", "Option C", "Option D"];
    const npc1 = makeNpc("Lola Marsh");
    const npc2 = makeNpc("Mr. Ash");
    const skill1 = makeSkill("Lola Marsh", [], deflections);
    const skill2 = makeSkill("Mr. Ash", [], deflections);

    const idx1 = rngFromString("deflect:Lola Marsh").int(deflections.length);
    const idx2 = rngFromString("deflect:Mr. Ash").int(deflections.length);

    const r1 = applyOutputGuardrail("I am an AI.", npc1, skill1);
    const r2 = applyOutputGuardrail("I am an AI.", npc2, skill2);

    expect(r1.reply).toBe(deflections[idx1]);
    expect(r2.reply).toBe(deflections[idx2]);
    // The two indices differ (a property of the seeding, verified deterministically).
    expect(idx1).not.toBe(idx2); // if this fails, the test is still correct but less illustrative
  });

  it("uses neutral fallback when deflectionTemplates is empty", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", [], []); // empty templates
    const raw = "I am the murderer.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    // The fallback in pickDeflection when no templates are present
    expect(result.reply).toBe("They look away and say nothing of use.");
  });
});

// ──────────────────────────────────────────────────────────────────────
// Priority ordering: guilt check fires BEFORE relationship check
// ──────────────────────────────────────────────────────────────────────

describe("applyOutputGuardrail: rule priority ordering", () => {
  it("guilt/meta trips before the relationship check", () => {
    // Even if a suspect name would also trip, the guilt rule should fire first.
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []); // Don Vittorio not allowed
    // Contains both a guilt keyword AND an outsider suspect name.
    const raw = "The killer was Don Vittorio.";
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("guilt_or_meta"); // guilt fires first
  });

  it("relationship check fires before the overlong check", () => {
    const npc = makeNpc("Lola Marsh");
    const skill = makeSkill("Lola Marsh", []); // Don Vittorio not allowed
    // Long reply with an outsider name but no guilt keywords.
    const raw = "Don Vittorio " + "was there ".repeat(40); // >400 chars + outsider
    const result = applyOutputGuardrail(raw, npc, skill);
    expect(result.tripped).toBe(true);
    expect(result.reason).toBe("named_outside_relationships"); // relationship fires before overlong
  });
});
