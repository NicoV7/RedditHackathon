/**
 * Procedural generator (C2). Builds a shared daily TEMPLATE (prose/cast/map/items)
 * and draws per-player INSTANCEs that randomize the killer + refuter channels —
 * each solvable-by-construction and validator-proven-unique (anti-spoiler, PLAN L1).
 *
 * Pure & deterministic (mulberry32). No LLM (that's the prose pre-render phase).
 */
import type {
  CaseInstance,
  CaseTemplate,
  Clue,
  Fact,
  Item,
  MapDef,
  Npc,
  SliceEntry,
  SuspectId,
  Zone,
} from "../../shared/case.js";
import { rngFromString, type Rng } from "../../shared/prng.js";

const SETTINGS = ["The Drowned Lily", "the Blue Hour speakeasy", "the Velvet Drown"];
const VICTIMS = ["Marco \"the Ledger\" Bellandi", "Sal the fence", "the bootlegger Quinn"];
// The Drowned Lily cast — these names match the portrait slugs in src/client/ui/portraits.ts.
const NAMES = [
  "Lola Marsh", "Don Vittorio", "Frankie Conti", "Sil Greco", "Det. Halloran",
  "Nell Carraway", "Harlan", "Mr. Ash", "Augie Doyle", "Old Cobb", "Birdie",
];
/** Per-character sin-themed flavor; falls back to a generic line for any other name. */
const PERSONAS: Record<string, { blurb: string; voice: string }> = {
  "Lola Marsh": { blurb: "The Lily's sultry headliner. They whisper her sin is Lust.", voice: "sultry" },
  "Don Vittorio": { blurb: "The kingpin who launders through the club. His sin is Pride.", voice: "genial menace" },
  "Frankie Conti": { blurb: "The Don's hot-tempered enforcer. His sin is Wrath.", voice: "hot-tempered" },
  "Sil Greco": { blurb: "The Don's skimming accountant. His sin is Greed.", voice: "wary" },
  "Det. Halloran": { blurb: "A corrupt patrolman who won't do his job. His sin is Sloth.", voice: "weary" },
  "Nell Carraway": { blurb: "A weary server who covets the life she pours. Her sin is Envy.", voice: "nervous" },
  "Harlan": { blurb: "A bloated regular three drinks past sense. His sin is Gluttony.", voice: "slurring" },
  "Mr. Ash": { blurb: "A pale envoy of the Order of the Pallid Star.", voice: "cold" },
  "Augie Doyle": { blurb: "The barkeep who sees everything and says little.", voice: "watchful" },
  "Old Cobb": { blurb: "The half-blind piano man who hears it all.", voice: "riddling" },
  "Birdie": { blurb: "The coat-check girl who clocks every arrival.", voice: "bright" },
};
const ZONE_DEFS: Array<{ id: string; name: string; tags: string[]; mood: string }> = [
  { id: "parlor", name: "The Parlor", tags: ["social", "host"], mood: "warm" },
  { id: "kitchen", name: "The Kitchen", tags: ["servants", "food"], mood: "busy" },
  { id: "garden", name: "The Garden", tags: ["outdoor", "quiet"], mood: "cold" },
  { id: "study", name: "The Study", tags: ["private", "documents"], mood: "tense" },
  { id: "cellar", name: "The Cellar", tags: ["hidden", "storage"], mood: "dim" },
];
const ITEM_KINDS = ["drink", "food", "trash", "effect", "document", "weapon"] as const;

/** Deterministic id factory, local to a generate/draw call (no global state). */
function idFactory(prefix: string): (kind: string) => string {
  let n = 0;
  return (kind: string) => `${kind}_${prefix}_${n++}`;
}

function buildMap(rng: Rng): { map: MapDef; zoneIds: string[] } {
  const chosen = rng.shuffle(ZONE_DEFS).slice(0, 4);
  const zones: Zone[] = chosen.map((z, i) => ({
    id: z.id,
    name: z.name,
    tags: z.tags,
    mood: z.mood,
    bounds: { x: (i % 2) * 200, y: Math.floor(i / 2) * 200, w: 200, h: 200 },
  }));
  return {
    map: { zones, navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 } },
    zoneIds: zones.map((z) => z.id),
  };
}

/** Build the shared daily template. */
export function generateTemplate(dailySeed: string, opts?: { suspects?: number; extras?: number }): CaseTemplate {
  const rng = rngFromString(`tmpl:${dailySeed}`);
  const nid = idFactory(`t_${dailySeed}`);
  const { map, zoneIds } = buildMap(rng);
  const setting = rng.pick(SETTINGS);
  const victim = rng.pick(VICTIMS);

  const names = rng.shuffle(NAMES);
  const nSuspects = opts?.suspects ?? 4 + rng.int(3); // 4–6 (≤8)
  const nExtras = opts?.extras ?? 6 + rng.int(5); // supporting/ambient → lean ~10–15 total

  const suspectIds: SuspectId[] = names.slice(0, nSuspects);
  const extraIds = names.slice(nSuspects, nSuspects + nExtras);

  const mkNpc = (id: string, tier: Npc["tier"]): Npc => {
    const home = rng.pick(zoneIds);
    return {
      id,
      persona: { name: id, blurb: PERSONAS[id]?.blurb ?? `${id}, present at ${setting}.`, voice: PERSONAS[id]?.voice ?? rng.pick(["clipped", "florid", "nervous", "genial", "curt"]) },
      tier,
      homeZone: home,
      routine: [{ zoneId: home, fromTick: 0, toTick: 240, activity: "present" }],
      slice: [],
    };
  };

  const roster: Npc[] = [
    ...suspectIds.map((id) => mkNpc(id, "principal")),
    ...extraIds.map((id) => mkNpc(id, rng.next() < 0.5 ? "supporting" : "ambient")),
  ];

  // A few shared items (prose). Some will host inspectItem refuter channels.
  const items: Item[] = Array.from({ length: 3 }, () => {
    const z = rng.pick(zoneIds);
    return {
      id: nid("item"),
      kind: rng.pick(ITEM_KINDS),
      zone: z,
      coords: { x: rng.int(200), y: rng.int(200) },
      examineText: "A detail that might matter — or might not.",
      revealsFactIds: [],
      presentReactions: [],
    };
  });

  return {
    id: `template:${dailySeed}`,
    templateSeed: dailySeed,
    setting,
    victim,
    map,
    suspectIds,
    roster,
    items,
    relationships: suspectIds.slice(1).map((s) => ({
      from: suspectIds[0]!,
      to: s,
      kind: "knows" as const,
      gating: false,
    })),
  };
}

/**
 * Draw a per-player instance: pick the killer, then materialize a fact/clue graph
 * where every innocent has a reachable refuter and the killer has none → unique.
 */
export function drawInstance(template: CaseTemplate, playerSeed: string): CaseInstance {
  const rng = rngFromString(`inst:${template.templateSeed}:${playerSeed}`);
  const nid = idFactory(`i_${template.templateSeed}_${playerSeed}`);
  const suspectIds = template.suspectIds;
  const killerId = rng.pick(suspectIds);
  const zoneIds = template.map.zones.map((z) => z.id);

  const facts: Fact[] = [];
  const clues: Clue[] = [];
  const sliceByNpc = new Map<string, SliceEntry[]>();
  const pushSlice = (npc: string, e: SliceEntry) => {
    const arr = sliceByNpc.get(npc) ?? [];
    arr.push(e);
    sliceByNpc.set(npc, arr);
  };

  const supportingClueIds: string[] = [];

  for (const s of suspectIds) {
    // Everyone looks guilty: means + opportunity, revealed by interrogating them.
    const means: Fact = { id: nid("fact"), subject: s, predicate: "means" };
    const opp: Fact = { id: nid("fact"), subject: s, predicate: "opportunity" };
    facts.push(means, opp);

    const meansClue: Clue = { id: nid("clue"), revealsFactIds: [means.id], unlockedBy: { kind: "askTopic", npcId: s, topic: "means" } };
    const oppClue: Clue = { id: nid("clue"), revealsFactIds: [opp.id], unlockedBy: { kind: "askTopic", npcId: s, topic: "whereabouts" } };
    clues.push(meansClue, oppClue);
    pushSlice(s, { factId: means.id, statedAs: "true" });
    pushSlice(s, { factId: opp.id, statedAs: "true" });

    if (s === killerId) {
      supportingClueIds.push(meansClue.id, oppClue.id);
      continue; // killer has NO refuter → stays viable
    }

    // Innocent: a reachable refuter (alibi). Randomize the discovery channel.
    const refuter: Fact = { id: nid("fact"), subject: s, predicate: "refutesOpportunity" };
    facts.push(refuter);
    const channel = rng.int(3);
    const unlockedBy =
      channel === 0
        ? ({ kind: "always" } as const)
        : channel === 1
          ? ({ kind: "enterZone", zoneId: rng.pick(zoneIds) } as const)
          : ({ kind: "inspectItem", itemId: rng.pick(template.items).id } as const);
    clues.push({ id: nid("clue"), revealsFactIds: [refuter.id], unlockedBy });
    pushSlice(s, { factId: refuter.id, statedAs: "true" }); // innocents truthfully give their alibi
  }

  const npcs: Npc[] = template.roster.map((n) => ({ ...n, slice: sliceByNpc.get(n.id) ?? [] }));

  const instance: CaseInstance = {
    templateId: template.id,
    instanceSeed: playerSeed,
    suspectIds,
    killerId,
    facts,
    clues,
    items: template.items,
    npcs,
    lockedZones: [],
    solution: { killerId, supportingClueIds },
  };
  return instance;
}
