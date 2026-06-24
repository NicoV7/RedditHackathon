import { describe, it, expect } from "vitest";
import { createHandlers, defaultDeps } from "./index.js";

describe("server endpoint handlers (C7 surface) — verified with fakes", () => {
  it("start → interrogate → examine → accuse, never leaking the killer", async () => {
    const deps = defaultDeps();
    const h = createHandlers(deps);
    const dailySeed = "2026-06-24";
    const player = "alice";

    const { view } = await h.startCase({ dailySeed }, player);
    // The client view must not carry any secret.
    const json = JSON.stringify(view);
    expect(json).not.toContain("killerId");
    expect(json).not.toContain("solution");
    expect(json).not.toContain("statedLie");
    expect(view.npcs.length).toBeGreaterThan(0);

    // Interrogate a principal — get a reply + server-revealed clues.
    const principal = view.npcs.find((n) => n.tier === "principal")!;
    const inter = await h.interrogate({ caseId: view.caseId, dailySeed, npcId: principal.id, message: "where were you?" }, player);
    expect(typeof inter.reply).toBe("string");
    expect(Array.isArray(inter.revealed)).toBe(true);

    // Examine an item.
    if (view.items[0]) {
      const ex = await h.examine({ caseId: view.caseId, dailySeed, itemId: view.items[0].id }, player);
      expect(typeof ex.examineText).toBe("string");
    }

    // Accuse a suspect; the server checks correctness (client can't know killer).
    const guess = view.suspectIds[0]!;
    const res = await h.accuse(
      { caseId: view.caseId, dailySeed, nominatedKillerId: guess, nominations: { [guess]: "killer" }, discoveredClueIds: [], inventory: [], questions: 3, timeMs: 50_000 },
      player,
      "2026-06-24",
    );
    expect(typeof res.solved).toBe("boolean");
    expect(res.summary.crowd.total).toBe(1);
    expect(res.summary.killerName).toBeTruthy();
  });

  it("moderation blocks abusive interrogation input", async () => {
    const deps = defaultDeps();
    const h = createHandlers(deps);
    const { view } = await h.startCase({ dailySeed: "d" }, "p");
    const npc = view.npcs[0]!;
    const inter = await h.interrogate({ caseId: view.caseId, dailySeed: "d", npcId: npc.id, message: "kill yourself" }, "p");
    expect(inter.moderated).toBe(true);
    expect(inter.revealed).toEqual([]);
  });
});
