/**
 * Procedural generator (C2). Builds a shared daily TEMPLATE (prose/cast/map/items)
 * and draws per-player INSTANCEs that randomize the killer + refuter channels —
 * each solvable-by-construction and validator-proven-unique (anti-spoiler, PLAN L1).
 *
 * Pure & deterministic (mulberry32). No LLM (that's the prose pre-render phase).
 *
 * Wave-1 additions (PLAN §2.4/§2.5):
 *  - CLUE-LIKELIHOOD PRIORS (§2.5): which template item hosts an inspectItem clue
 *    channel is a *weighted* seeded draw keyed by (ItemKind, zone tags) — a weapon
 *    in a crime-scene zone is very likely the clue; a drink/trash rarely is. Same
 *    typed Item/Clue outputs; red herrings (revealsFactIds: []) still appear.
 *  - QUIRK MATERIALIZATION (§2.5): each instance NPC gets a small seeded quirks tag
 *    list. FLAVOR ONLY — drawn from a *dedicated* RNG stream applied AFTER the fact
 *    graph is complete, so the validator/solver graph is byte-identical with or
 *    without quirks (proven in procedural.test.ts).
 *  - DOORS (§2.4): the template map emits doors linking adjacent zones; some carry a
 *    Precondition. A gated door lowers to the existing reachability machinery: a
 *    refuter clue placed behind a gated door inherits the door's precondition, so it
 *    is reachable only once the door opens. A hard-locked door stamps lockedZones.
 */
import type {
  CaseInstance,
  CaseTemplate,
  Clue,
  Door,
  Fact,
  Item,
  ItemKind,
  MapDef,
  Npc,
  Precondition,
  QuirkTag,
  SliceEntry,
  SuspectId,
  Zone,
} from "../../shared/case.js";
import { rngFromString, type Rng } from "../../shared/prng.js";
import { SUSPECT_NAMES, WITNESS_NAMES } from "../npc/personas/cast.js";

const SETTINGS = ["The Drowned Lily", "the Blue Hour speakeasy", "the Velvet Drown"];
const VICTIMS = ["Marco \"the Ledger\" Bellandi", "Sal the fence", "the bootlegger Quinn"];
// The Drowned Lily cast — these names match the portrait slugs in src/client/ui/portraits.ts.
// The suspect pool + witness pool are the single source of truth in npc/personas/cast.ts, so
// the generator and the PersonaSkill registry can never drift on who is suspect-eligible.
const NAMES = [...SUSPECT_NAMES, ...WITNESS_NAMES];
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
const ITEM_KINDS: readonly ItemKind[] = ["drink", "food", "trash", "effect", "document", "weapon"];

/**
 * Quirk pool (PLAN §2.5). FLAVOR ONLY — colors voice/barks/tell presentation; never
 * read by the validator/solver and never alters the fact graph. A "nervous" quirk may
 * deliberately *mimic* a lie-tell (ambiguity by design), but changes nothing structural.
 */
const QUIRK_POOL: readonly QuirkTag[] = [
  "nervous", "theatrical", "terse", "rambling", "evasive",
  "deadpan", "haughty", "fidgety", "overpolite", "sardonic",
];

/** Deterministic id factory, local to a generate/draw call (no global state). */
function idFactory(prefix: string): (kind: string) => string {
  let n = 0;
  return (kind: string) => `${kind}_${prefix}_${n++}`;
}

// ───────────────────────── Clue-likelihood priors (§2.5) ─────────────────────────
/**
 * Prior weight (a positive number; relative magnitude is what matters) that an item
 * of `kind` sitting in a zone tagged `zoneTags` *carries a clue* rather than being a
 * red herring. Keyed by (ItemKind, zone tags) — purely generator-internal, NOT a
 * contract change. The draw stays seeded + validator-checked; this only *weights* it.
 *
 * Rationale: a weapon/document/effect at the crime scene reads as evidence; a
 * drink/food/trash reads as background. Crime-scene-flavored zone tags amplify.
 */
export function cluePrior(kind: ItemKind, zoneTags: readonly string[]): number {
  const KIND_BASE: Record<ItemKind, number> = {
    weapon: 10,
    document: 6,
    effect: 5,
    food: 2,
    drink: 1,
    trash: 1,
  };
  let w = KIND_BASE[kind];
  // Crime-scene-ish tags lift evidentiary kinds; social/food zones don't.
  const tagSet = new Set(zoneTags);
  if (tagSet.has("hidden") || tagSet.has("private") || tagSet.has("storage")) w *= 2;
  if (tagSet.has("documents") && (kind === "document" || kind === "effect")) w *= 2;
  if (tagSet.has("food") && (kind === "food" || kind === "drink")) w *= 1.5;
  return w;
}

/**
 * Weighted seeded pick of an index into `weights` (integer-pure: scales to an integer
 * domain before drawing, never accumulates floats into logical state). Returns -1 only
 * if the list is empty or all weights are non-positive.
 */
function weightedPick(rng: Rng, weights: readonly number[]): number {
  // Quantize to integers so the draw is engine-stable (no float accumulation).
  const ints = weights.map((w) => Math.max(0, Math.round(w * 1000)));
  const total = ints.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.length > 0 ? rng.int(weights.length) : -1;
  let r = rng.int(total); // integer in [0, total)
  for (let i = 0; i < ints.length; i++) {
    r -= ints[i]!;
    if (r < 0) return i;
  }
  return ints.length - 1;
}

// ───────────────────────── Map + doors (§2.4) ─────────────────────────
/** Two zones are adjacent iff their bounds share an edge (grid-laid 2×2 blocks). */
function adjacent(a: Zone, b: Zone): boolean {
  const ax2 = a.bounds.x + a.bounds.w;
  const ay2 = a.bounds.y + a.bounds.h;
  const bx2 = b.bounds.x + b.bounds.w;
  const by2 = b.bounds.y + b.bounds.h;
  const shareV = (a.bounds.x === bx2 || b.bounds.x === ax2) && a.bounds.y < by2 && b.bounds.y < ay2;
  const shareH = (a.bounds.y === by2 || b.bounds.y === ay2) && a.bounds.x < bx2 && b.bounds.x < ax2;
  return shareV || shareH;
}

/**
 * Build doors linking adjacent zones, spanning every zone (a connected door graph so
 * the map is traversable). One interior door (never to the start zone) is locked by a
 * `Precondition` — a *first-class reachability gate*: you must satisfy it to open the
 * door (e.g. `inspectItem` the key). The gate LOWERS to the existing reachability
 * machinery (PLAN §2.4): a refuter the instance places behind a gated door inherits
 * the door's precondition, so it is reachable only once the door opens. The gated
 * door's target + precondition are returned for the instance to consume.
 *
 * @param keyItemId  optional id of a "key" item (placed in an open zone) the gated
 *   door requires; when present the gate is `inspectItem(keyItemId)`. Omitted ⇒ no
 *   gated door (the map is fully open).
 */
function buildDoors(rng: Rng, zones: Zone[], keyItemId?: string): {
  doors: Door[];
  /** zoneId → precondition that must hold before that zone is reachable (gated door). */
  gateByZone: Map<string, Precondition>;
} {
  const doors: Door[] = [];
  const gateByZone = new Map<string, Precondition>();
  if (zones.length < 2) return { doors, gateByZone };

  // Spanning-tree over the adjacency graph rooted at zones[0] (the start zone) so
  // every zone is reachable through some door chain. Deterministic BFS order.
  const start = zones[0]!;
  const inTree = new Set<string>([start.id]);
  const order: Zone[] = [start];
  const treeEdges: Array<{ from: Zone; to: Zone }> = [];
  while (order.length < zones.length) {
    let added = false;
    for (const z of zones) {
      if (inTree.has(z.id)) continue;
      const parent = order.find((p) => adjacent(p, z));
      if (parent) {
        treeEdges.push({ from: parent, to: z });
        inTree.add(z.id);
        order.push(z);
        added = true;
      }
    }
    if (!added) {
      // Not fully grid-adjacent (shouldn't happen with the 2×2 layout); link the
      // first unconnected zone to the start so the graph stays connected.
      const z = zones.find((zz) => !inTree.has(zz.id));
      if (!z) break;
      treeEdges.push({ from: start, to: z });
      inTree.add(z.id);
      order.push(z);
    }
  }

  // Choose exactly one interior (non-start-target) tree edge to lock behind the key
  // item. A leaf zone is preferred so gating it never strands a sibling.
  const interior = treeEdges.filter((e) => e.to.id !== start.id);
  const isLeaf = (z: Zone) => !treeEdges.some((e) => e.from.id === z.id);
  const lockable = interior.filter((e) => isLeaf(e.to));
  const pool = lockable.length > 0 ? lockable : interior;
  const gatedEdge = keyItemId && pool.length > 0 ? pool[rng.int(pool.length)]! : null;

  for (const e of treeEdges) {
    const door: Door = {
      from: e.from.id,
      to: e.to.id,
      coords: { x: e.to.bounds.x, y: e.to.bounds.y },
    };
    if (gatedEdge && e === gatedEdge && keyItemId) {
      // A genuinely-enforced gate: the door needs the key item inspected. Reachability
      // already understands `inspectItem`, so a clue placed behind this door is only
      // reachable once the key (hence the door) is in play.
      door.unlockedBy = { kind: "inspectItem", itemId: keyItemId };
      gateByZone.set(e.to.id, door.unlockedBy);
    }
    doors.push(door);
  }
  return { doors, gateByZone };
}

function buildMap(rng: Rng, keyItemId?: string): { map: MapDef; zoneIds: string[]; gateByZone: Map<string, Precondition> } {
  const chosen = rng.shuffle(ZONE_DEFS).slice(0, 4);
  const zones: Zone[] = chosen.map((z, i) => ({
    id: z.id,
    name: z.name,
    tags: z.tags,
    mood: z.mood,
    bounds: { x: (i % 2) * 200, y: Math.floor(i / 2) * 200, w: 200, h: 200 },
  }));
  const { doors, gateByZone } = buildDoors(rng, zones, keyItemId);
  return {
    map: { zones, navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 }, doors },
    zoneIds: zones.map((z) => z.id),
    gateByZone,
  };
}

/** Build the shared daily template. */
export function generateTemplate(dailySeed: string, opts?: { suspects?: number; extras?: number }): CaseTemplate {
  const rng = rngFromString(`tmpl:${dailySeed}`);
  const nid = idFactory(`t_${dailySeed}`);
  // Mint the key-item id up front so the gated door can reference it. The key item is
  // placed below in the START zone (always open) — inspecting it opens the locked door.
  const keyItemId = nid("item");
  const { map, zoneIds } = buildMap(rng, keyItemId);
  const startZoneId = map.zones[0]!.id; // door-graph root: always reachable
  const setting = rng.pick(SETTINGS);
  const victim = rng.pick(VICTIMS);

  const names = rng.shuffle(NAMES);
  const nSuspects = opts?.suspects ?? 4 + rng.int(3); // 4–6 (≤8)
  const nExtras = opts?.extras ?? 6 + rng.int(5); // supporting/ambient → lean ~10–15 total

  // Suspects are drawn ONLY from the suspect-eligible pool, so each has an authored
  // PersonaSkill; witnesses (Old Cobb/Birdie/Harlan) are never principals (stay scripted).
  const suspectIds: SuspectId[] = names.filter((n) => SUSPECT_NAMES.includes(n)).slice(0, nSuspects);
  const extraIds = names.filter((n) => !suspectIds.includes(n)).slice(0, nExtras);

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

  // The key item for the gated door (§2.4): a document in the always-open start zone.
  // Inspecting it opens the locked door; its id was reserved before buildMap.
  const keyItem: Item = {
    id: keyItemId,
    kind: "document",
    zone: startZoneId,
    coords: { x: rng.int(200), y: rng.int(200) },
    examineText: "A heavy iron key on a brass fob — it fits a door somewhere in the house.",
    revealsFactIds: [],
    presentReactions: [],
  };
  // A few more shared items (prose). Some will host inspectItem refuter channels; which
  // ones is biased at draw time by the clue-likelihood priors (§2.5).
  const extraItems: Item[] = Array.from({ length: 3 }, () => {
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
  const items: Item[] = [keyItem, ...extraItems];

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
 *
 * @param opts.quirks  default true; pass `false` to suppress quirk materialization.
 *   Quirks ride a DEDICATED rng stream applied AFTER the fact graph, so the graph the
 *   validator/solver reads is byte-identical regardless of this flag.
 * @param opts.lies    default true; pass `false` to suppress ALL statedLie baking
 *   (killer self-account lies AND the symmetric innocent decoy tells). Like quirks,
 *   lie-baking rides a DEDICATED rng stream applied AFTER the fact graph is sealed and
 *   writes ONLY the harness-only `statedAs` marker — so the fact/clue graph the
 *   validator/solver reads is byte-identical regardless of this flag (proven in tests).
 */
export function drawInstance(
  template: CaseTemplate,
  playerSeed: string,
  opts?: { quirks?: boolean; lies?: boolean },
): CaseInstance {
  const rng = rngFromString(`inst:${template.templateSeed}:${playerSeed}`);
  const nid = idFactory(`i_${template.templateSeed}_${playerSeed}`);
  const suspectIds = template.suspectIds;
  const killerId = rng.pick(suspectIds);
  const zoneIds = template.map.zones.map((z) => z.id);
  const zoneById = new Map(template.map.zones.map((z) => [z.id, z]));

  // Door gates from the template map: a zone behind a gated door is only reachable
  // once the door's precondition holds (§2.4). The generator lowers a refuter placed
  // behind such a zone to that precondition so reachability gates it dynamically.
  const gatedDoors = (template.map.doors ?? []).filter((d) => d.unlockedBy);
  const gateByZone = new Map<string, Precondition>();
  for (const d of gatedDoors) if (d.unlockedBy) gateByZone.set(d.to, d.unlockedBy);

  const facts: Fact[] = [];
  const clues: Clue[] = [];
  const sliceByNpc = new Map<string, SliceEntry[]>();
  const pushSlice = (npc: string, e: SliceEntry) => {
    const arr = sliceByNpc.get(npc) ?? [];
    arr.push(e);
    sliceByNpc.set(npc, arr);
  };

  const supportingClueIds: string[] = [];

  // Pre-compute prior weights for each template item so inspectItem refuter channels
  // prefer evidentiary items (weapon/document at a hidden/private zone). Determinism:
  // weights are a pure function of (kind, zone tags); the draw uses the seeded rng.
  const itemWeights = template.items.map((it) => cluePrior(it.kind, zoneById.get(it.zone)?.tags ?? []));

  // Make the gated door load-bearing: route exactly ONE innocent's alibi *behind* the
  // locked door (its precondition becomes the door's gate). Because that gate is an
  // `inspectItem` on the key (in the always-open start zone), the alibi is reachable —
  // but ONLY once the door is opened, exactly per §2.4. Reachability enforces it with
  // zero changes (the gate is a plain Precondition it already understands).
  const doorGate: Precondition | null = gatedDoors[0]?.unlockedBy ?? null;
  let doorGateUsed = false;

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

    // Innocent: a reachable refuter (alibi). Randomize the discovery channel, with
    // the inspectItem channel biased toward evidentiary items by the clue priors.
    const refuter: Fact = { id: nid("fact"), subject: s, predicate: "refutesOpportunity" };
    facts.push(refuter);
    let unlockedBy: Precondition;
    // First innocent (when a gated door exists): place the alibi behind the locked
    // door so the door is a genuine reachability gate the validator enforces.
    if (doorGate && !doorGateUsed) {
      unlockedBy = doorGate;
      doorGateUsed = true;
      clues.push({ id: nid("clue"), revealsFactIds: [refuter.id], unlockedBy });
      pushSlice(s, { factId: refuter.id, statedAs: "true" });
      continue;
    }
    const channel = rng.int(3);
    if (channel === 0) {
      unlockedBy = { kind: "always" };
    } else if (channel === 1) {
      // enterZone channel: prefer an UNGATED zone so the alibi is always reachable.
      // (Gated zones are handled by the inspectItem/door channel below.)
      const open = zoneIds.filter((z) => !gateByZone.has(z));
      const pool = open.length > 0 ? open : zoneIds;
      unlockedBy = { kind: "enterZone", zoneId: pool[rng.int(pool.length)]! };
    } else {
      // inspectItem channel: weighted by the clue-likelihood priors so the refuter
      // tends to live on a sensible (weapon/document) item. Falls back to a uniform
      // pick if priors are degenerate.
      const idx = weightedPick(rng, itemWeights);
      const item = template.items[idx >= 0 ? idx : rng.int(template.items.length)]!;
      unlockedBy = { kind: "inspectItem", itemId: item.id };
    }
    clues.push({ id: nid("clue"), revealsFactIds: [refuter.id], unlockedBy });
    pushSlice(s, { factId: refuter.id, statedAs: "true" }); // innocents truthfully give their alibi
  }

  // ─────────── Bake killer lies onto the slice PROJECTION (B2b) ───────────
  // The fact/clue graph is FINAL and validated-by-construction above. `statedAs`
  // lives on the slice projection and is read ONLY by the NPC harness
  // (renderSliceLine + computeLieTell) — the validator, blind solver, and
  // reachability traverse facts/clues/items/reachability and NEVER read statedAs.
  // So flipping entries to `statedLie` here is SOLVABILITY-NEUTRAL: the fact graph,
  // the unique-killer guarantee, and the corpus all stay byte-identical.
  //
  // Determinism: a DEDICATED mulberry32 stream (like quirks), applied after the
  // graph is sealed, integer-pure. Same seed ⇒ same lies. Never references the
  // (forbidden-in-prompts) killerId in any prose — it only marks the killer's OWN
  // incriminating self-account as deceptively stated.
  //
  // Suppressible via opts.lies === false (used by tests to PROVE the fact/clue
  // graph is byte-identical with and without lie-baking). Because every flip below
  // writes ONLY `statedAs`, the structural graph is unchanged either way.
  if (opts?.lies !== false) {
  const lrng = rngFromString(`lies:${template.templateSeed}:${playerSeed}`);

  // The killer states their own incriminating means + opportunity DECEPTIVELY:
  // they claim innocence on exactly the facts that, left unrefuted, convict them.
  // These predicates are means/opportunity, so computeLieTell maps them to an
  // empathy/drama emotional tell — a principal turn with high faculties now
  // produces a TellSignal end-to-end. (refutesMeans/refutesOpportunity would map
  // to a logic tell, but the killer has no refuter by construction, so the
  // killer's tellable lies are means/opportunity.)
  //
  // We capture exactly WHICH predicates the killer lies about (its "tell shape")
  // so the innocent decoy below can be made byte-identical in shape + count — the
  // anti-spoiler keystone: the killer must never be the UNIQUE or oddly-shaped
  // tell-bearer.
  const killerSlice = sliceByNpc.get(killerId) ?? [];
  const tellablePredicates: ("means" | "opportunity")[] = ["means", "opportunity"];
  const killerTellShape: ("means" | "opportunity")[] = [];
  for (const entry of killerSlice) {
    const f = facts.find((ff) => ff.id === entry.factId);
    if (!f) continue;
    // Incriminating self-account = the killer's own means / opportunity.
    if (f.subject === killerId && (f.predicate === "means" || f.predicate === "opportunity")) {
      entry.statedAs = "statedLie";
      killerTellShape.push(f.predicate);
    }
  }

  // ───────── SYMMETRIC INNOCENT TELLS (anti-spoiler integrity, D2) ─────────
  // VERIFIED FLAW (pre-fix): the killer's means+opportunity were ALWAYS flipped,
  // but only a 0.5-gated single innocent ever got ONE counter-lie — so at high
  // faculty the killer was the SOLE empathy/drama tell-bearer in ~52% of
  // instances (a >50% killer fingerprint, undermining "solvability is structural").
  //
  // FIX — UNCONDITIONAL + SHAPE-SYMMETRIC: in EVERY instance, guarantee ≥1
  // innocent emits a same-SHAPE, same-COUNT means/opportunity statedLie tell,
  // keyed to the SAME empathy/drama faculty bucket as the killer's tells. The
  // chosen decoy mirrors the killer's tell shape entry-for-entry where possible
  // (every innocent has BOTH means + opportunity entries, so the mirror is
  // always achievable). This is read ONLY by the harness (computeLieTell); the
  // validator/solver/reachability never touch statedAs, so the fact/clue graph
  // stays byte-identical and the blind-solver-unique-killer guarantee is untouched.
  //
  // The decoys keep their reachable refuter as `statedAs: "true"` (asserted
  // below) — their alibi stays truthful + reachable, so a decoy never becomes a
  // second viable killer.
  //
  // Determinism: the same `lrng` stream, integer-pure picks. No 0.5 gate.
  const innocents = suspectIds.filter((s) => s !== killerId);
  // The shape to mirror onto decoys: the killer's tellable predicates if any,
  // else the full tellable set (defensive — the killer always has both m/o, so
  // killerTellShape is normally ["means","opportunity"]).
  const mirrorShape = killerTellShape.length > 0 ? killerTellShape : tellablePredicates;

  if (innocents.length > 0) {
    // Decoy count: at least 1, and — when there are enough innocents — a seeded
    // 1..min(2, innocents) so the killer is statistically indistinguishable by
    // the COUNT of fellow tell-bearers too. Always ≥1 (the 0.5 gate is gone).
    const maxDecoys = Math.min(2, innocents.length);
    const decoyCount = 1 + lrng.int(maxDecoys); // 1..maxDecoys, never 0
    const shuffledInnocents = lrng.shuffle([...innocents]);
    const decoys = shuffledInnocents.slice(0, decoyCount);

    for (const decoy of decoys) {
      const slice = sliceByNpc.get(decoy) ?? [];
      // Flip EXACTLY the decoy's own means/opportunity entries that mirror the
      // killer's tell shape — never a refuter (the alibi stays truthful). Because
      // every innocent owns both a means and an opportunity entry, the decoy can
      // always reproduce the killer's exact tell shape + count.
      for (const pred of mirrorShape) {
        const entry = slice.find((e) => {
          const f = facts.find((ff) => ff.id === e.factId);
          return !!f && f.subject === decoy && f.predicate === pred && e.statedAs === "true";
        });
        if (entry) entry.statedAs = "statedLie";
      }
    }
  }
  } // end opts.lies

  // Materialize NPC slices from the (now-complete) fact graph. The fact/clue graph is
  // FINAL at this point — nothing below may push facts/clues/slices.
  const npcs: Npc[] = template.roster.map((n) => ({ ...n, slice: sliceByNpc.get(n.id) ?? [] }));

  // QUIRKS (§2.5): flavor-only, dedicated rng stream, applied AFTER the graph is
  // sealed. Suppressible via opts.quirks === false. Because this stream is independent
  // and writes ONLY the (validator-ignored) `quirks` field, the fact graph is
  // byte-identical with or without quirks for a given seed (asserted in tests).
  if (opts?.quirks !== false) {
    const qrng = rngFromString(`quirks:${template.templateSeed}:${playerSeed}`);
    for (const n of npcs) {
      const count = 1 + qrng.int(2); // 1–2 quirks each
      const pool = qrng.shuffle(QUIRK_POOL);
      n.quirks = pool.slice(0, count);
    }
  }

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
