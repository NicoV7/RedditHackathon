/**
 * src/shared/case.ts — THE CONTRACT (component C1).
 *
 * Single source of truth between generator (C2), validator + blind solver (C3),
 * NPC harness (C5), world/items (C18/C19), and the client. Frozen before Wave 1.
 *
 * Deduction model (PLAN L2): boolean **means × opportunity** per suspect.
 *   killer  = the unique suspect with means ∧ opportunity that stays UNREFUTED.
 *   innocent = has at least one PLAYER-REACHABLE refuter (alibi/means-accounted).
 * Solvability is STRUCTURAL: the validator runs on this typed graph, never on prose.
 *
 * Template vs. instance (anti-spoiler, PLAN L1/L2): the shared daily *template*
 * carries prose/cast/map/items; the per-player *instance* randomizes the killer +
 * which refuters are active so each player gets a uniquely-solvable case.
 */

// ───────────────────────── IDs ─────────────────────────
export type NpcId = string;
export type SuspectId = NpcId; // suspects ⊆ npcs
export type FactId = string;
export type ClueId = string;
export type ItemId = string;
export type ZoneId = string;

// ─────────────────── Deduction substrate ───────────────────
/** A fact is the single source of VALUE. Truthfulness lives on the slice entry. */
export type Predicate = "means" | "opportunity" | "refutesMeans" | "refutesOpportunity";

export interface Fact {
  id: FactId;
  subject: SuspectId;
  predicate: Predicate;
  note?: string; // optional flavor; never load-bearing for deduction
}

/** How a given NPC *states* a shared fact (per-projection, not per-fact). */
export type StatedAs = "true" | "statedLie";
export interface SliceEntry {
  factId: FactId;
  statedAs: StatedAs; // killer's lies are pre-baked here; harness never knows the killer
}

// ───────── Reachability: edges of the ONE union graph ─────────
/** A clue/item/fact becomes reachable when its precondition is satisfied.
 *  The validator AND the blind solver traverse the same graph (C3). */
export type Precondition =
  | { kind: "always" }
  | { kind: "clue"; clueId: ClueId }
  | { kind: "inspectItem"; itemId: ItemId }
  | { kind: "enterZone"; zoneId: ZoneId }
  | { kind: "askTopic"; npcId: NpcId; topic: string }
  | { kind: "presentItemTo"; itemId: ItemId; npcId: NpcId };

export interface Clue {
  id: ClueId;
  revealsFactIds: FactId[];
  unlockedBy: Precondition;
}

// ───────────────────────── Items (C18) ─────────────────────────
export type ItemKind = "drink" | "food" | "trash" | "effect" | "document" | "weapon";
export interface PresentReaction {
  npcId: NpcId;
  revealsFactIds: FactId[]; // showing the item to this NPC unlocks these (pre-authored)
}
export interface Item {
  id: ItemId;
  kind: ItemKind;
  zone: ZoneId;
  coords: { x: number; y: number };
  examineText: string; // pre-rendered (zero runtime LLM)
  revealsFactIds: FactId[]; // examining unlocks these; [] = red herring
  presentReactions: PresentReaction[];
}

// ───────────────────────── Map (C10) ─────────────────────────
export interface Zone {
  id: ZoneId;
  name: string;
  tags: string[]; // semantic tags FEED generation (persona/knowledge)
  mood?: string;
  bounds: { x: number; y: number; w: number; h: number };
  locked?: boolean; // if true, the zone (and its items) are not player-reachable
}
/** Pinned: cellSize + origin + units so generation/pathfinding/coords agree. */
export interface NavGrid {
  cellSize: number;
  origin: { x: number; y: number };
  cols: number;
  rows: number;
  blocked?: number[]; // blocked cell indices (row * cols + col)
}
/** A door links two zones. An optional precondition gates traversal — a locked
 *  door is a first-class reachability gate the validator understands (it lowers to
 *  an `enterZone`/precondition edge in the union graph). Omitted ⇒ always open. */
export interface Door {
  from: ZoneId;
  to: ZoneId;
  coords: { x: number; y: number };
  unlockedBy?: Precondition;
}
export interface MapDef {
  zones: Zone[];
  navGrid: NavGrid;
  doors?: Door[];
}

// ───────────────────────── NPCs (C5/C10) ─────────────────────────
export type NpcTier = "principal" | "supporting" | "ambient";
/** Per-instance flavor trait the player discovers during a run. FLAVOR ONLY:
 *  never read by the validator/solver, never alters the fact graph. A quirk may
 *  *mimic* a lie-tell (deliberate ambiguity) but changes nothing structural. */
export type QuirkTag = string;
export interface RoutineStep {
  zoneId: ZoneId;
  fromTick: number; // logical ticks; tick 0 = case start
  toTick: number;
  activity: string;
}
export interface Persona {
  name: string;
  blurb: string;
  voice: string;
}
export interface Npc {
  id: NpcId;
  persona: Persona;
  tier: NpcTier;
  homeZone: ZoneId;
  routine: RoutineStep[];
  slice: SliceEntry[]; // projection over the instance's facts
  quirks?: QuirkTag[]; // per-instance flavor; never read by the validator/solver
}

export interface RelationshipEdge {
  from: NpcId;
  to: NpcId;
  kind: "knows" | "trusts" | "distrusts" | "related";
  gating: boolean; // typed marker: does this edge gate reachability, or flavor only?
}

// ─────────────── Template (shared) ───────────────
export interface CaseTemplate {
  id: string;
  templateSeed: string;
  setting: string;
  victim: string;
  map: MapDef;
  suspectIds: SuspectId[]; // ≤8; all are tier 'principal'
  roster: Npc[]; // personas/tiers/routines (slices filled per-instance) — prose, shared
  items: Item[]; // prose + base placement, shared
  relationships: RelationshipEdge[];
}

// ─────────────── Instance (per-player, materialized + solvable) ───────────────
export interface CaseInstance {
  templateId: string;
  instanceSeed: string;
  suspectIds: SuspectId[];
  killerId: SuspectId; // ∈ suspectIds; NEVER placed in any prompt
  facts: Fact[];
  clues: Clue[];
  items: Item[]; // per-instance placement (inherits template, may tweak)
  npcs: Npc[]; // slices materialized for this instance
  lockedZones?: ZoneId[]; // zones (and their items) not player-reachable this instance
  solution: { killerId: SuspectId; supportingClueIds: ClueId[] };
}

/** What the player can actually reach — the input to the blind solver. */
export interface PlayerSurface {
  reachableFactIds: Set<FactId>;
  reachableClueIds: Set<ClueId>;
}

export const MAX_SUSPECTS = 8;
