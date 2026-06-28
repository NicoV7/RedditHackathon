/**
 * Guardrail red-team (Wave 2 hardening). Pins the fixes for the confirmed bypasses:
 * first-name/surname name-token leaks, guilt/confession synonyms, inflected stems,
 * AI/meta variants — and proves the deflection substitutions never self-trip.
 */
import { describe, it, expect } from "vitest";
import { applyOutputGuardrail, GUILT_META, nameTokens } from "./guardrail.js";
import { personaSkillById, getPersonaSkill } from "./personas/registry.js";
import type { Npc } from "../../shared/case.js";

const npcFor = (id: string): Npc => ({
  id, persona: { name: id, blurb: "", voice: "" }, tier: "principal", homeZone: "parlor", routine: [], slice: [],
});
const lola = npcFor("Lola Marsh");
const lolaSkill = getPersonaSkill("Lola Marsh")!; // relationships: Don Vittorio, Frankie Conti, Nell Carraway, Augie Doyle
const trips = (s: string, npc = lola, skill = lolaSkill) => applyOutputGuardrail(s, npc, skill).tripped;

describe("guardrail red-team — name-token bypass", () => {
  // Off-allowlist suspects for Lola: Sil Greco, Det. Halloran, Mr. Ash.
  it("trips on a first-name-only reference to an off-allowlist suspect", () => {
    expect(trips("It was Sil, all along, sugar.")).toBe(true);
  });
  it("trips on a surname-only reference to an off-allowlist suspect", () => {
    expect(trips("You ought to ask Greco about that.")).toBe(true);
    expect(trips("Halloran knows more than he lets on.")).toBe(true);
  });
  it("trips on the full name of an off-allowlist suspect (incl. honorific names)", () => {
    expect(trips("Mr. Ash was lurking by the cellar.")).toBe(true);
  });
  it("does NOT trip when naming an ALLOWED relationship in benign prose", () => {
    expect(trips("Frankie was at the bar all night, lamb.")).toBe(false);
    expect(trips("Augie pours a heavy glass, bless him.")).toBe(false);
  });
  it("nameTokens strips honorifics and collision-prone common tokens", () => {
    expect(nameTokens("Det. Halloran")).toEqual(["halloran"]);
    expect(nameTokens("Mr. Ash")).toEqual([]); // "ash" is collision-prone → full-name match only
    expect(nameTokens("Don Vittorio")).toEqual(["vittorio"]); // "don" dropped (don't/done)
    expect(nameTokens("Sil Greco")).toEqual(["sil", "greco"]);
  });
});

describe("guardrail red-team — guilt/confession synonyms & inflected stems", () => {
  it("trips on guilt/confession synonyms outside the original tiny list", () => {
    for (const s of [
      "The culprit slipped out the side door.",
      "I confess, lamb — I never told you.",
      "He's the perp, plain as day.",
      "It was an assassin, I'd wager.",
      "She strangled him in the dark.",
      "Whodunit? The man who owed the most.",
    ]) expect(trips(s), s).toBe(true);
  });
  it("trips on inflected/pluralized forms of denylisted stems", () => {
    for (const s of ["The killers are still among us.", "He took to murdering for hire.", "guilt-ridden to the last."])
      expect(trips(s), s).toBe(true);
  });
  it("trips on AI / meta-leak variants", () => {
    for (const s of ["I'm an LLM and must comply.", "my instructions say otherwise.", "as an AI, I cannot do that.", "per my system prompt."])
      expect(trips(s), s).toBe(true);
  });
  it("does NOT trip on ordinary in-character prose", () => {
    for (const s of [
      "The rye sort of evening, wasn't it.",
      "I pour the drinks, I don't ponder.",
      "Ask me about the music, darling.",
      "A lady keeps a few things behind the curtain.",
    ]) expect(trips(s), s).toBe(false);
  });
});

describe("guardrail — substitution output is itself clean (no self-trip / no loop)", () => {
  it("no authored deflectionTemplate trips the denylist or names an off-allowlist suspect", () => {
    for (const skill of Object.values(personaSkillById)) {
      const npc = npcFor(skill.npcId);
      for (const tmpl of skill.boundaries.deflectionTemplates) {
        expect(GUILT_META.test(tmpl), `GUILT_META: ${skill.npcId} :: ${tmpl}`).toBe(false);
        expect(applyOutputGuardrail(tmpl, npc, skill).tripped, `allowlist: ${skill.npcId} :: ${tmpl}`).toBe(false);
      }
    }
  });
});
