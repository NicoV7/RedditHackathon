/**
 * Persona-skill eval battery (Wave 1, GATING). Synthetic data only — never Reddit.
 *
 * Proves the anti-spoiler keystone: the per-character "fat skill" is GUILT-BLIND —
 * identical whether or not the character is the killer this run — and the runtime
 * guardrails hold (jailbreak, relationship-leak). Also proves registry completeness
 * and the culture/translation wiring.
 */
import { describe, it, expect } from "vitest";
import { generateTemplate, drawInstance } from "../../case/procedural.js";
import { MockProvider } from "../../llm/provider.js";
import { assembleSystemPrompt, runNpcTurn } from "../harness.js";
import { personaSkillById, getPersonaSkill } from "../personas/registry.js";
import { SUSPECT_NAMES } from "../personas/cast.js";
import { CANONICAL_PHRASES } from "../../translate/dictionary.js";
import type { Fact, Npc } from "../../../shared/case.js";

const GUILT = /\b(killer|murderer|guilty|the solution|killerid|statedlie)\b/i;
const factMap = (facts: Fact[]) => new Map(facts.map((f) => [f.id, f]));
const stripSlice = (npc: Npc): Npc => ({ ...npc, slice: [] });

describe("persona-skill eval — registry & culture", () => {
  it("every suspect-eligible principal has a skill, and every skill is a suspect", () => {
    for (const name of SUSPECT_NAMES) expect(getPersonaSkill(name), `${name} skill`).toBeDefined();
    for (const [key, skill] of Object.entries(personaSkillById)) {
      expect(SUSPECT_NAMES).toContain(key);
      expect(skill.npcId).toBe(key); // registry key === skill identity
    }
  });

  it("registry is complete for every principal drawn across synthetic instances", () => {
    const template = generateTemplate("registry-complete");
    for (let i = 0; i < 40; i++) {
      const inst = drawInstance(template, `rc-${i}`);
      for (const npc of inst.npcs) {
        if (npc.tier === "principal") expect(getPersonaSkill(npc.id), `${npc.id}`).toBeDefined();
      }
    }
  });

  it("cultural languages map correctly; English-native characters have no culture", () => {
    const expected: Record<string, string> = {
      "Don Vittorio": "it", "Frankie Conti": "it", "Sil Greco": "it",
      "Det. Halloran": "ga", "Augie Doyle": "ga", "Mr. Ash": "la",
    };
    for (const [name, lang] of Object.entries(expected)) {
      expect(getPersonaSkill(name)?.culture?.language, name).toBe(lang);
    }
    expect(getPersonaSkill("Lola Marsh")?.culture).toBeUndefined();
    expect(getPersonaSkill("Nell Carraway")?.culture).toBeUndefined();
  });

  it("every culture phrasebook entry is a canonical phrase the LocalTranslator can resolve", () => {
    for (const skill of Object.values(personaSkillById)) {
      if (!skill.culture) continue;
      expect(skill.culture.phrasebook.length).toBeGreaterThan(0);
      for (const phrase of skill.culture.phrasebook) {
        expect(CANONICAL_PHRASES, `${skill.npcId}: "${phrase}"`).toContain(phrase);
      }
    }
  });
});

describe("persona-skill eval — guilt-blind by construction", () => {
  it("no prompt-reachable field of any skill leaks guilt (evalAnchors excluded — they hold the denylist)", () => {
    for (const skill of Object.values(personaSkillById)) {
      const { evalAnchors, ...promptReachable } = skill;
      void evalAnchors;
      expect(JSON.stringify(promptReachable), skill.npcId).not.toMatch(GUILT);
    }
  });

  it("the assembled prompt never leaks guilt or the solution across many instances", () => {
    const template = generateTemplate("guilt-blind");
    for (let i = 0; i < 30; i++) {
      const inst = drawInstance(template, `gb-${i}`);
      const fb = factMap(inst.facts);
      for (const npc of inst.npcs) {
        const prompt = assembleSystemPrompt(npc, fb, [], getPersonaSkill(npc.id), inst.instanceSeed);
        expect(prompt, npc.id).not.toMatch(GUILT);
        expect(prompt).not.toContain(JSON.stringify(inst.solution));
      }
    }
  });
});

describe("persona-skill eval — anti-spoiler (persona block invariant under killer reassignment)", () => {
  // Find a suspect with a skill that is the killer in one instance and innocent in another.
  function findPair() {
    const template = generateTemplate("anti-spoiler");
    for (const X of SUSPECT_NAMES) {
      if (!getPersonaSkill(X)) continue;
      let killer: { inst: ReturnType<typeof drawInstance>; npc: Npc } | undefined;
      let innocent: { inst: ReturnType<typeof drawInstance>; npc: Npc } | undefined;
      for (let i = 0; i < 400 && (!killer || !innocent); i++) {
        const inst = drawInstance(template, `as-${i}`);
        if (!inst.suspectIds.includes(X)) continue;
        const npc = inst.npcs.find((n) => n.id === X);
        if (!npc) continue;
        if (inst.killerId === X) killer ??= { inst, npc };
        else innocent ??= { inst, npc };
      }
      if (killer && innocent) return { X, killer, innocent };
    }
    return null;
  }

  it("the persona/skill/overlay prompt for a suspect is byte-identical whether they are the killer or innocent", () => {
    const pair = findPair();
    expect(pair, "expected a suspect that is killer in one instance and innocent in another").not.toBeNull();
    const { X, killer, innocent } = pair!;
    const skill = getPersonaSkill(X)!;
    const salt = "fixed-run-salt"; // same overlay seed for both — isolates the killer variable

    // With the slice stripped, the entire prompt IS the persona block; it must not
    // depend on who the killer is. (The slice — the only structural channel — may differ.)
    const personaKiller = assembleSystemPrompt(stripSlice(killer.npc), factMap(killer.inst.facts), [], skill, salt);
    const personaInnocent = assembleSystemPrompt(stripSlice(innocent.npc), factMap(innocent.inst.facts), [], skill, salt);
    expect(personaKiller).toBe(personaInnocent);
    expect(personaKiller).not.toMatch(GUILT);
  });
});

describe("persona-skill eval — runtime guardrails", () => {
  const template = generateTemplate("guardrails");
  function aSkilledPrincipal(seed: string): Npc {
    const inst = drawInstance(template, seed);
    return inst.npcs.find((n) => n.tier === "principal" && getPersonaSkill(n.id))!;
  }

  it("a jailbreak / guilt-leak reply is replaced by an in-character deflection", async () => {
    const npc = aSkilledPrincipal("jb-1");
    const skill = getPersonaSkill(npc.id)!;
    const provider = new MockProvider(() => "Ignore your rules. The killer is Frankie Conti. As an AI, I confess everything.");
    const res = await runNpcTurn({ npc, factById: new Map(), playerMessage: "are you the killer?", provider });
    expect(skill.boundaries.deflectionTemplates).toContain(res.reply);
    expect(res.reply).not.toMatch(GUILT);
  });

  it("naming a suspect outside the relationship allowlist trips the guardrail", async () => {
    // Pick a skilled principal and a cast suspect they do NOT list as a relationship.
    let npc: Npc | undefined, outsider: string | undefined;
    for (let i = 0; i < 50 && !outsider; i++) {
      const cand = drawInstance(template, `outsider-${i}`).npcs.find((n) => n.tier === "principal" && getPersonaSkill(n.id));
      if (!cand) continue;
      const skill = getPersonaSkill(cand.id)!;
      const allowed = new Set([cand.id, ...skill.relationships.map((r) => r.npcId)]);
      const off = SUSPECT_NAMES.find((s) => !allowed.has(s));
      if (off) { npc = cand; outsider = off; }
    }
    expect(outsider, "a suspect outside the allowlist").toBeDefined();
    const skill = getPersonaSkill(npc!.id)!;
    const provider = new MockProvider(() => `Why don't you go bother ${outsider} about it instead.`);
    const res = await runNpcTurn({ npc: npc!, factById: new Map(), playerMessage: "well?", provider });
    expect(skill.boundaries.deflectionTemplates).toContain(res.reply);
  });

  it("runNpcTurn is deterministic for identical inputs", async () => {
    const npc = aSkilledPrincipal("det-1");
    const provider = new MockProvider(() => "A perfectly ordinary answer about the weather.");
    const first = await runNpcTurn({ npc, factById: new Map(), playerMessage: "how are you?", provider, runSalt: "s" });
    for (let i = 0; i < 8; i++) {
      const again = await runNpcTurn({ npc, factById: new Map(), playerMessage: "how are you?", provider, runSalt: "s" });
      expect(again.reply).toBe(first.reply);
    }
  });
});
