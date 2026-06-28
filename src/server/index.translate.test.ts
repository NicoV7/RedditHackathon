/**
 * Integration: interrogate() wires the cached translator closure into the harness
 * (Workstream C). Proves end-to-end injection, the compliance invariant (player text
 * is never translated), and that the Redis cache prevents repeat backend calls.
 */
import { describe, it, expect } from "vitest";
import { createHandlers } from "./index.js";
import { FakeRedis } from "./redis/redis.js";
import { MockProvider } from "./llm/provider.js";
import { MockTranslator } from "./translate/translator.js";
import { getPersonaSkill } from "./npc/personas/registry.js";

type Handlers = ReturnType<typeof createHandlers>;

function setup() {
  const translator = new MockTranslator((r) => `<${r.targetLang}>${r.text}`);
  const deps = { redis: new FakeRedis(), provider: new MockProvider(() => "I really couldn't say."), translator };
  return { h: createHandlers(deps), translator };
}

/** Find a (seed, player) whose drawn instance has an interrogable, culture-bearing principal. */
async function findCulturePrincipal(h: Handlers) {
  for (let i = 0; i < 40; i++) {
    const dailySeed = `xl-${i}`;
    const player = `p-${i}`;
    const { view } = await h.startCase({ dailySeed }, player);
    const npc = view.npcs.find((n) => n.tier === "principal" && getPersonaSkill(n.id)?.culture);
    if (npc) return { dailySeed, player, npcId: npc.id, caseId: view.caseId };
  }
  return null;
}

describe("interrogate — cultural translation injection (Workstream C)", () => {
  it("injects a translated interjection and translates ONLY the NPC phrase, never the player message", async () => {
    const { h, translator } = setup();
    const found = await findCulturePrincipal(h);
    expect(found, "a culture-bearing principal").not.toBeNull();
    const { dailySeed, player, npcId, caseId } = found!;
    const playerMessage = "where were you?";
    const res = await h.interrogate({ caseId, dailySeed, npcId, message: playerMessage }, player);

    expect(res.reply).toContain("«");
    expect(translator.calls.length).toBeGreaterThan(0);
    const phrasebook = new Set(getPersonaSkill(npcId)!.culture!.phrasebook);
    for (const c of translator.calls) expect(phrasebook.has(c.text)).toBe(true);
    expect(translator.calls.map((c) => c.text)).not.toContain(playerMessage);
  });

  it("caches translations — a repeat interrogation does not re-call the translator", async () => {
    const { h, translator } = setup();
    const found = await findCulturePrincipal(h);
    expect(found).not.toBeNull();
    const { dailySeed, player, npcId, caseId } = found!;
    await h.interrogate({ caseId, dailySeed, npcId, message: "first" }, player);
    const afterFirst = translator.calls.length;
    await h.interrogate({ caseId, dailySeed, npcId, message: "second" }, player);
    expect(translator.calls.length).toBe(afterFirst); // cache hit → no new backend call
  });
});
