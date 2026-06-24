/**
 * Pure-logic tests for the client game-state FSM (src/client/state/fsm.ts).
 *
 * Scope: the reducer is a PURE transition table — no DOM, no WebGL, no fetch, no
 * clocks. These tests exercise the B3.1 additions (present flow, player zone,
 * detective sheet, tells/Faculties HUD, notetaker board nodes, the client-side
 * accuse gate + GATE_REJECTED) alongside the pre-existing transitions to prove
 * they still work. No browser environment is required.
 */
import { describe, it, expect } from "vitest";
import {
  reducer,
  initialState,
  canAccuse,
  boardNodes,
  latestTell,
  faculties,
  nominatedKiller,
  deductionStrength,
  ACCUSE_THRESHOLD,
  type GameState,
  type GameData,
} from "./fsm.js";
import type {
  ClientCaseView,
  RevealedClue,
  DetectiveState,
  TellSignal,
} from "../../shared/api.js";

// ── fixtures ──────────────────────────────────────────────────────────────
const view: ClientCaseView = {
  caseId: "c1",
  dailySeed: "2026-06-24",
  setting: "The Parlor",
  victim: "Lord Ashgrove",
  map: { zones: [], navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 } },
  suspectIds: ["npc_a", "npc_b"],
  npcs: [],
  items: [],
};

const tell: TellSignal = { faculty: "logic", line: "That timeline doesn't add up.", intensity: 0.8 };

const detective: DetectiveState = {
  faculties: { logic: 3, empathy: 2, drama: 1, perception: 1, authority: 0, encyclopedia: 0 },
  xp: 120,
  playStreak: 4,
  solveStreak: 2,
  unlocks: ["pressure"],
};

/** Drive the reducer from Loading to a freshly-loaded Briefing state. */
function loaded(): Extract<GameState, { phase: "Briefing" }> {
  const s = reducer(initialState, { type: "CASE_LOADED", view, startedAtMs: 1000 });
  if (s.phase !== "Briefing") throw new Error("expected Briefing");
  return s;
}

/** Reach the Exploring phase. */
function exploring(): GameState {
  return reducer(loaded(), { type: "START_INTERROGATING" });
}

// ── CASE_LOADED initializes all new fields ──────────────────────────────────
describe("CASE_LOADED initial GameData", () => {
  it("seeds the new B3.1 fields", () => {
    const s = loaded();
    expect(s.playerZone).toBeNull();
    expect(s.detective).toBeNull();
    expect(s.tells).toEqual({});
    expect(s.needMoreEvidence).toBe(false);
    // pre-existing fields still seeded
    expect(s.clues).toEqual([]);
    expect(s.boardUnlocked).toBe(false);
  });
});

// ── MOVE_PLAYER records the logical zone ─────────────────────────────────────
describe("MOVE_PLAYER", () => {
  it("records the server-confirmed logical zone, carried across transitions", () => {
    let s = reducer(exploring(), { type: "MOVE_PLAYER", zoneId: "library" });
    expect(s.phase === "Exploring" && s.playerZone).toBe("library");
    // carried into Dialogue
    s = reducer(s, { type: "ENTER_DIALOGUE", npcId: "npc_a" });
    expect(s.phase === "Dialogue" && s.playerZone).toBe("library");
  });

  it("is a no-op while still Loading", () => {
    const s = reducer(initialState, { type: "MOVE_PLAYER", zoneId: "library" });
    expect(s).toBe(initialState);
  });
});

// ── SET_DETECTIVE + faculties selector ───────────────────────────────────────
describe("SET_DETECTIVE", () => {
  it("stores the detective sheet and exposes faculties", () => {
    const s = reducer(exploring(), { type: "SET_DETECTIVE", detective });
    const data = s as GameData;
    expect(data.detective).toEqual(detective);
    expect(faculties(data)).toEqual(detective.faculties);
  });

  it("faculties() is null before the sheet loads", () => {
    expect(faculties(loaded())).toBeNull();
  });
});

// ── tells: latest tell per NPC for the Faculties HUD ─────────────────────────
describe("tells (Faculties HUD)", () => {
  it("REVEAL_CLUES folds a tell in under sourceNpcId", () => {
    const clues: RevealedClue[] = [
      { id: "k1", text: "A clue", tell, sourceNpcId: "npc_b" },
    ];
    const s = reducer(exploring(), { type: "REVEAL_CLUES", clues });
    expect(latestTell(s as GameData, "npc_b")).toEqual(tell);
    expect(latestTell(s as GameData, "npc_a")).toBeNull();
  });

  it("REVEAL_CLUES in Dialogue attributes a source-less tell to the active NPC", () => {
    const inDialogue = reducer(exploring(), { type: "ENTER_DIALOGUE", npcId: "npc_a" });
    const clues: RevealedClue[] = [{ id: "k2", text: "Stammered", tell }];
    const s = reducer(inDialogue, { type: "REVEAL_CLUES", clues });
    expect(latestTell(s as GameData, "npc_a")).toEqual(tell);
  });

  it("the latest tell for an NPC wins", () => {
    const first: TellSignal = { faculty: "empathy", line: "first", intensity: 0.2 };
    const second: TellSignal = { faculty: "logic", line: "second", intensity: 0.9 };
    let s = reducer(exploring(), {
      type: "REVEAL_CLUES",
      clues: [{ id: "a", text: "x", tell: first, sourceNpcId: "npc_a" }],
    });
    s = reducer(s, {
      type: "REVEAL_CLUES",
      clues: [{ id: "b", text: "y", tell: second, sourceNpcId: "npc_a" }],
    });
    expect(latestTell(s as GameData, "npc_a")).toEqual(second);
  });

  it("clues without a tell leave the HUD untouched", () => {
    const s = reducer(exploring(), {
      type: "REVEAL_CLUES",
      clues: [{ id: "a", text: "plain", sourceNpcId: "npc_a" }],
    });
    expect((s as GameData).tells).toEqual({});
  });
});

// ── PRESENT_RESULT ───────────────────────────────────────────────────────────
describe("PRESENT_RESULT", () => {
  it("merges revealed clues, unlocks the board, and folds the tell to the target NPC", () => {
    const clues: RevealedClue[] = [{ id: "p1", text: "Refuted!", tell }];
    const s = reducer(exploring(), {
      type: "PRESENT_RESULT",
      clues,
      npcId: "npc_b",
      caughtInLie: true,
    });
    const data = s as GameData;
    expect(data.clues.map((c) => c.id)).toContain("p1");
    expect(data.boardUnlocked).toBe(true);
    expect(latestTell(data, "npc_b")).toEqual(tell);
  });

  it("de-dupes clue ids across reveal + present", () => {
    let s: GameState = reducer(exploring(), {
      type: "REVEAL_CLUES",
      clues: [{ id: "dup", text: "once" }],
    });
    s = reducer(s, {
      type: "PRESENT_RESULT",
      clues: [{ id: "dup", text: "again" }],
      npcId: "npc_a",
      caughtInLie: false,
    });
    expect((s as GameData).clues.filter((c) => c.id === "dup")).toHaveLength(1);
  });
});

// ── notetaker board nodes ────────────────────────────────────────────────────
describe("boardNodes", () => {
  it("projects only clues that carry noteText, preserving order + source edge", () => {
    const clues: RevealedClue[] = [
      { id: "n1", text: "raw", noteText: "Note one", sourceNpcId: "npc_a" },
      { id: "n2", text: "no note" }, // omitted — not board-pinnable
      { id: "n3", text: "raw3", noteText: "Note three" },
    ];
    const s = reducer(exploring(), { type: "REVEAL_CLUES", clues });
    const nodes = boardNodes(s as GameData);
    expect(nodes).toEqual([
      { clueId: "n1", noteText: "Note one", sourceNpcId: "npc_a" },
      { clueId: "n3", noteText: "Note three", sourceNpcId: undefined },
    ]);
  });

  it("is empty when no clue carries noteText", () => {
    const s = reducer(exploring(), {
      type: "REVEAL_CLUES",
      clues: [{ id: "x", text: "raw" }],
    });
    expect(boardNodes(s as GameData)).toEqual([]);
  });
});

// ── accuse gate (canAccuse) ──────────────────────────────────────────────────
describe("canAccuse (client-side gate, advisory)", () => {
  it("false with no killer tagged", () => {
    expect(canAccuse(loaded())).toBe(false);
  });

  it("false when the tagged killer's strength is below threshold", () => {
    // killer tagged but 0 clues ⇒ deductionStrength = 0.5 < 0.6
    const s = reducer(exploring(), { type: "TAG_NPC", npcId: "npc_a", role: "killer" });
    expect(deductionStrength(s as GameData, "npc_a")).toBeLessThan(ACCUSE_THRESHOLD);
    expect(canAccuse(s as GameData)).toBe(false);
  });

  it("true once a tagged killer clears the threshold", () => {
    let s: GameState = reducer(exploring(), { type: "TAG_NPC", npcId: "npc_a", role: "killer" });
    // 2 clues ⇒ clueWeight 0.4 ⇒ strength 0.5 + 0.2 = 0.7 ≥ 0.6
    s = reducer(s, {
      type: "REVEAL_CLUES",
      clues: [
        { id: "c1", text: "1" },
        { id: "c2", text: "2" },
      ],
    });
    expect(nominatedKiller(s as GameData)).toBe("npc_a");
    expect(canAccuse(s as GameData)).toBe(true);
  });

  it("honors a custom threshold", () => {
    const s = reducer(exploring(), { type: "TAG_NPC", npcId: "npc_a", role: "killer" });
    // strength 0.5: passes a low bar, fails the default
    expect(canAccuse(s as GameData, 0.4)).toBe(true);
    expect(canAccuse(s as GameData, 0.6)).toBe(false);
  });
});

// ── GATE_REJECTED (server rejected a premature accuse) ───────────────────────
describe("GATE_REJECTED", () => {
  it("returns to Board with needMoreEvidence set, keeping the player in the case", () => {
    // tag a killer and begin accusing
    let s: GameState = reducer(exploring(), { type: "TAG_NPC", npcId: "npc_a", role: "killer" });
    s = reducer(s, { type: "REVEAL_CLUES", clues: [{ id: "c1", text: "1" }] }); // unlock board
    s = reducer(s, { type: "OPEN_BOARD" });
    s = reducer(s, { type: "BEGIN_ACCUSE", nominatedKillerId: "npc_a" });
    expect(s.phase).toBe("Accusing");
    s = reducer(s, { type: "GATE_REJECTED" });
    expect(s.phase).toBe("Board");
    expect((s as GameData).needMoreEvidence).toBe(true);
    // nominations + clues survive (no state lost)
    expect((s as GameData).nominations.npc_a).toBe("killer");
  });

  it("a fresh BEGIN_ACCUSE clears the needMoreEvidence flag", () => {
    let s: GameState = reducer(exploring(), { type: "TAG_NPC", npcId: "npc_a", role: "killer" });
    s = reducer(s, { type: "REVEAL_CLUES", clues: [{ id: "c1", text: "1" }] });
    s = reducer(s, { type: "OPEN_BOARD" });
    s = reducer(s, { type: "BEGIN_ACCUSE", nominatedKillerId: "npc_a" });
    s = reducer(s, { type: "GATE_REJECTED" });
    expect((s as GameData).needMoreEvidence).toBe(true);
    s = reducer(s, { type: "BEGIN_ACCUSE", nominatedKillerId: "npc_a" });
    expect(s.phase).toBe("Accusing");
    expect((s as GameData).needMoreEvidence).toBe(false);
  });

  it("is a no-op outside Accusing/Board", () => {
    const s = exploring();
    expect(reducer(s, { type: "GATE_REJECTED" })).toBe(s);
  });
});

// ── pre-existing transitions still work (regression guard) ───────────────────
describe("existing transitions (regression)", () => {
  it("Loading → Briefing → Exploring ⇄ Dialogue", () => {
    let s: GameState = loaded();
    expect(s.phase).toBe("Briefing");
    s = reducer(s, { type: "START_INTERROGATING" });
    expect(s.phase).toBe("Exploring");
    s = reducer(s, { type: "ENTER_DIALOGUE", npcId: "npc_a" });
    expect(s.phase === "Dialogue" && s.npcId).toBe("npc_a");
    s = reducer(s, { type: "EXIT_DIALOGUE" });
    expect(s.phase).toBe("Exploring");
  });

  it("board stays locked until the first clue lands", () => {
    let s: GameState = exploring();
    s = reducer(s, { type: "OPEN_BOARD" });
    expect(s.phase).toBe("Exploring"); // still locked
    s = reducer(s, { type: "REVEAL_CLUES", clues: [{ id: "c1", text: "1" }] });
    s = reducer(s, { type: "OPEN_BOARD" });
    expect(s.phase).toBe("Board");
  });

  it("ASKED increments the question count", () => {
    const s = reducer(exploring(), { type: "ASKED" });
    expect((s as GameData).questions).toBe(1);
  });
});
