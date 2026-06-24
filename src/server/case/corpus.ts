/**
 * Hand-authored known-answer corpus (C3). The validator must ACCEPT every
 * solvable case and REJECT every broken one before the generator's output is
 * trusted. These are deliberate, minimal, and read by corpus.test.ts.
 */
import type { CaseInstance, Clue, Fact, Npc } from "../../shared/case.js";

const npc = (id: string): Npc => ({
  id,
  persona: { name: id, blurb: id, voice: "plain" },
  tier: "principal",
  homeZone: "parlor",
  routine: [{ zoneId: "parlor", fromTick: 0, toTick: 1, activity: "present" }],
  slice: [],
});

const base = (over: Partial<CaseInstance>): CaseInstance => ({
  templateId: "corpus",
  instanceSeed: "corpus",
  suspectIds: ["A", "B"],
  killerId: "A",
  facts: [],
  clues: [],
  items: [],
  npcs: [npc("A"), npc("B")],
  lockedZones: [],
  solution: { killerId: "A", supportingClueIds: [] },
  ...over,
});

const meansOpp = (s: string): Fact[] => [
  { id: `${s}_means`, subject: s, predicate: "means" },
  { id: `${s}_opp`, subject: s, predicate: "opportunity" },
];
const askClues = (s: string): Clue[] => [
  { id: `${s}_c_means`, revealsFactIds: [`${s}_means`], unlockedBy: { kind: "askTopic", npcId: s, topic: "means" } },
  { id: `${s}_c_opp`, revealsFactIds: [`${s}_opp`], unlockedBy: { kind: "askTopic", npcId: s, topic: "whereabouts" } },
];
const refuter = (s: string): Fact => ({ id: `${s}_ref`, subject: s, predicate: "refutesOpportunity" });

export interface CorpusEntry {
  name: string;
  instance: CaseInstance;
  expectOk: boolean;
  /** substring expected in the rejection reason (when expectOk is false) */
  reasonHas?: string;
}

export const CORPUS: CorpusEntry[] = [
  {
    name: "solvable: A killer, B refuted (reachable)",
    expectOk: true,
    instance: base({
      facts: [...meansOpp("A"), ...meansOpp("B"), refuter("B")],
      clues: [
        ...askClues("A"),
        ...askClues("B"),
        { id: "B_c_ref", revealsFactIds: ["B_ref"], unlockedBy: { kind: "always" } },
      ],
      solution: { killerId: "A", supportingClueIds: ["A_c_means", "A_c_opp"] },
    }),
  },
  {
    name: "ambiguous: neither refuted → two viable",
    expectOk: false,
    reasonHas: "ambiguous",
    instance: base({
      facts: [...meansOpp("A"), ...meansOpp("B")],
      clues: [...askClues("A"), ...askClues("B")],
    }),
  },
  {
    name: "unsolvable: B's refuter gated behind a LOCKED zone",
    expectOk: false,
    reasonHas: "ambiguous",
    instance: base({
      facts: [...meansOpp("A"), ...meansOpp("B"), refuter("B")],
      clues: [
        ...askClues("A"),
        ...askClues("B"),
        { id: "B_c_ref", revealsFactIds: ["B_ref"], unlockedBy: { kind: "enterZone", zoneId: "vault" } },
      ],
      lockedZones: ["vault"],
    }),
  },
  {
    name: "cycle: two refuter clues depend on each other",
    expectOk: false,
    reasonHas: "cycle",
    instance: base({
      facts: [...meansOpp("A"), ...meansOpp("B"), refuter("B")],
      clues: [
        ...askClues("A"),
        ...askClues("B"),
        { id: "x1", revealsFactIds: ["B_ref"], unlockedBy: { kind: "clue", clueId: "x2" } },
        { id: "x2", revealsFactIds: [], unlockedBy: { kind: "clue", clueId: "x1" } },
      ],
    }),
  },
  {
    name: "wrong killer: A is refuted, B is unrefuted, but killerId=A",
    expectOk: false,
    reasonHas: "not killer",
    instance: base({
      killerId: "A",
      facts: [...meansOpp("A"), ...meansOpp("B"), refuter("A")],
      clues: [
        ...askClues("A"),
        ...askClues("B"),
        { id: "A_c_ref", revealsFactIds: ["A_ref"], unlockedBy: { kind: "always" } },
      ],
    }),
  },
  {
    name: "reachable via inspectItem: B refuted by examining an item",
    expectOk: true,
    instance: base({
      facts: [...meansOpp("A"), ...meansOpp("B"), refuter("B")],
      items: [
        { id: "glass", kind: "drink", zone: "parlor", coords: { x: 1, y: 1 }, examineText: "A smudged glass.", revealsFactIds: [], presentReactions: [] },
      ],
      clues: [
        ...askClues("A"),
        ...askClues("B"),
        { id: "B_c_ref", revealsFactIds: ["B_ref"], unlockedBy: { kind: "inspectItem", itemId: "glass" } },
      ],
    }),
  },
];
