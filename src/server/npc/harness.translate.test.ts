/**
 * Harness cultural-translation injection (Workstream C). Verifies the injected,
 * cached translator closure is used correctly and safely: deterministic guilt-blind
 * phrase pick, NPC-phrases-only (never player text), guardrail over the injected
 * text, and graceful English fallback when culture/translator/translation is absent.
 */
import { describe, it, expect } from "vitest";
import { runNpcTurn } from "./harness.js";
import { MockProvider } from "../llm/provider.js";
import { getPersonaSkill, personaSkillById } from "./personas/registry.js";
import type { Npc } from "../../shared/case.js";

const PLAIN = "Plain answer about the weather.";
function npcFor(id: string): Npc {
  return {
    id,
    persona: { name: id, blurb: "a figure at the Lily.", voice: "plain" },
    tier: "principal",
    homeZone: "parlor",
    routine: [{ zoneId: "parlor", fromTick: 0, toTick: 240, activity: "present" }],
    slice: [],
  };
}
const recorder = () => {
  const calls: Array<{ text: string; lang: string }> = [];
  const translate = async (text: string, lang: string) => {
    calls.push({ text, lang });
    return `${lang.toUpperCase()}:${text}`;
  };
  return { calls, translate };
};

describe("harness — cultural-translation injection", () => {
  it("prepends a translated native interjection for a culture-bearing principal", async () => {
    const npc = npcFor("Don Vittorio"); // skill has culture (Italian)
    const { calls, translate } = recorder();
    const provider = new MockProvider(() => PLAIN);
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "where were you?", provider, translate, runSalt: "r1" });
    expect(res.reply).toContain("«IT:");
    expect(res.reply).toContain("Plain answer");
    expect(calls.length).toBe(1);
  });

  it("picks the interjection deterministically from (runSalt, npcId)", async () => {
    const npc = npcFor("Don Vittorio");
    const provider = new MockProvider(() => PLAIN);
    const a = recorder();
    const b = recorder();
    await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, translate: a.translate, runSalt: "same" });
    await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, translate: b.translate, runSalt: "same" });
    expect(a.calls[0]!.text).toBe(b.calls[0]!.text); // same salt+npc ⇒ same phrase
  });

  it("translates ONLY NPC phrasebook phrases — never the player's message", async () => {
    const npc = npcFor("Mr. Ash"); // Latin culture
    const phrasebook = new Set(getPersonaSkill("Mr. Ash")!.culture!.phrasebook);
    const { calls, translate } = recorder();
    const provider = new MockProvider(() => PLAIN);
    const playerMessage = "Did you see Frankie Conti near the cellar at midnight?";
    await runNpcTurn({ npc, factById: new Map(), playerMessage, provider, translate, runSalt: "r2" });
    for (const c of calls) expect(phrasebook.has(c.text)).toBe(true);
    expect(calls.map((c) => c.text)).not.toContain(playerMessage);
  });

  it("does NOT inject when the character has no culture (English-native)", async () => {
    const npc = npcFor("Lola Marsh"); // skill, but no culture
    const { calls, translate } = recorder();
    const provider = new MockProvider(() => PLAIN);
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, translate, runSalt: "r" });
    expect(res.reply).not.toContain("«");
    expect(calls.length).toBe(0);
  });

  it("does NOT inject when no translator is provided (byte-identical fallback)", async () => {
    const npc = npcFor("Don Vittorio");
    const provider = new MockProvider(() => PLAIN);
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, runSalt: "r" });
    expect(res.reply).not.toContain("«");
    expect(res.reply).toBe(PLAIN);
  });

  it("falls back to untranslated English when the translator throws", async () => {
    const npc = npcFor("Don Vittorio");
    const provider = new MockProvider(() => PLAIN);
    const translate = async () => { throw new Error("backend down"); };
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, translate, runSalt: "r" });
    expect(res.reply).not.toContain("«");
    expect(res.reply).toBe(PLAIN);
  });

  it("refuses to inject a phrasebook phrase whose English SOURCE trips the guilt denylist", async () => {
    // Defence-in-depth for a future cloud backend: the English source is scanned
    // before translation, so a guilt-laden phrase is never sent out or injected.
    const id = "__TEST_GUILT_SRC__";
    personaSkillById[id] = {
      ...getPersonaSkill("Mr. Ash")!,
      npcId: id,
      culture: { language: "la", languageName: "Latin", phrasebook: ["the killer confesses"] },
    };
    try {
      const { calls, translate } = recorder();
      const provider = new MockProvider(() => PLAIN);
      const res = await runNpcTurn({ npc: npcFor(id), factById: new Map(), playerMessage: "q", provider, translate, runSalt: "r" });
      expect(res.reply).not.toContain("«"); // source vetted out → no injection
      expect(calls.length).toBe(0); // translator never even called for a guilt source
    } finally {
      delete personaSkillById[id];
    }
  });

  it("runs the output guardrail over the INJECTED text (a leaky translation is caught)", async () => {
    const npc = npcFor("Don Vittorio");
    const skill = getPersonaSkill("Don Vittorio")!;
    const provider = new MockProvider(() => PLAIN);
    const translate = async () => "the killer confesses"; // a translation that smuggles a guilt word
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "q", provider, translate, runSalt: "r" });
    expect(skill.boundaries.deflectionTemplates).toContain(res.reply); // guardrail tripped → deflection
    expect(res.reply).not.toContain("killer");
  });
});
