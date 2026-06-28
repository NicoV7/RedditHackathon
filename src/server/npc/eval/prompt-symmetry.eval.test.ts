/**
 * Anti-spoiler prompt-symmetry eval (Wave 2 keystone). Pins the fix for the confirmed
 * "killer is the unique NPC with no self-alibi line" leak: across many instances, the
 * killer's self-referential prompt lines must be shape-identical to at least one
 * innocent suspect's (the decoy), so the killer is never a unique prompt fingerprint.
 */
import { describe, it, expect } from "vitest";
import { generateTemplate, drawInstance } from "../../case/procedural.js";
import { assembleSystemPrompt } from "../harness.js";
import { getPersonaSkill } from "../personas/registry.js";
import type { Fact, Npc } from "../../../shared/case.js";

const factMap = (facts: Fact[]) => new Map(facts.map((f) => [f.id, f]));

/** The normalized multiset of self-referential knowledge lines in an NPC's prompt. */
function selfLineShape(npc: Npc, fb: Map<string, Fact>): string {
  const prompt = assembleSystemPrompt(npc, fb, [], getPersonaSkill(npc.id), "fixed-salt");
  const lines = prompt
    .split("\n")
    .filter((l) => /^You (know|insist):/.test(l))
    .map((l) => l.split(npc.id).join("<self>"))
    .sort();
  return JSON.stringify(lines);
}

describe("anti-spoiler — killer prompt self-line shape is never unique", () => {
  it("the killer's self-line shape is shared by >=1 innocent suspect across many seeds", () => {
    const template = generateTemplate("prompt-symmetry");
    for (let i = 0; i < 50; i++) {
      const inst = drawInstance(template, `ps-${i}`);
      const fb = factMap(inst.facts);
      const killer = inst.npcs.find((n) => n.id === inst.killerId)!;
      const killerShape = selfLineShape(killer, fb);
      const sharers = inst.suspectIds
        .filter((s) => s !== inst.killerId)
        .filter((s) => selfLineShape(inst.npcs.find((n) => n.id === s)!, fb) === killerShape);
      expect(sharers.length, `seed ${i}: killer self-line shape was unique`).toBeGreaterThan(0);
    }
  });

  it("no suspect's prompt voices a self-alibi ('no opportunity') line", () => {
    const template = generateTemplate("no-self-alibi");
    for (let i = 0; i < 20; i++) {
      const inst = drawInstance(template, `na-${i}`);
      const fb = factMap(inst.facts);
      for (const npc of inst.npcs) {
        const prompt = assembleSystemPrompt(npc, fb, [], getPersonaSkill(npc.id), inst.instanceSeed);
        // a self-alibi would render as "You know: <self> had no opportunity." — suppressed.
        expect(prompt).not.toMatch(new RegExp(`You know: ${npc.id} had no opportunity`));
      }
    }
  });
});
