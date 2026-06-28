/**
 * Client ↔ server API DTOs (shared). CRITICAL SECURITY BOUNDARY: the client view
 * is a SANITIZED projection of a CaseInstance — it NEVER carries killerId,
 * solution, facts, clues, or NPC slices. The client learns clue text only as the
 * server reveals it (server-authoritative). See toClientView() below.
 */
import type { CaseInstance, ItemKind, MapDef, NpcTier, RoutineStep } from "./case.js";

export type NominationRole = "suspect" | "bystander" | "killer" | "unknown";

export interface ClientNpcView {
  id: string;
  name: string;
  blurb: string;
  voice: string;
  tier: NpcTier;
  homeZone: string;
  routine: RoutineStep[]; // positions are not secret — drives movement
}
export interface ClientItemView {
  id: string;
  kind: ItemKind;
  zone: string;
  coords: { x: number; y: number };
  // examineText intentionally omitted — revealed only via the examine endpoint
}
export interface ClientCaseView {
  caseId: string;
  dailySeed: string;
  setting: string;
  victim: string;
  map: MapDef;
  suspectIds: string[];
  npcs: ClientNpcView[];
  items: ClientItemView[];
}

/** The six inner-voice detective Faculties (Part 1.2). Logic + Empathy are SPINE. */
export type FacultyId = "logic" | "empathy" | "drama" | "perception" | "authority" | "encyclopedia";

/** A deterministic inner-voice interjection — the "tell". Fires from a structural
 *  `statedLie` + the player's faculty level, NEVER from RNG and NEVER parsed from the
 *  LLM. `intensity` is a cosmetic strength for the Phaser filter (never read by logic). */
export interface TellSignal {
  faculty: FacultyId;
  line: string;
  intensity: number; // 0..1, cosmetic only
}

export interface FacultyLevels {
  logic: number;
  empathy: number;
  drama: number;
  perception: number;
  authority: number;
  encyclopedia: number;
}

/** Player personality axes the Watcher infers from your behaviour (Part 5). Bipolar — a
 *  negative score leans the first pole, positive the second. FLAVOR/identity only; never
 *  gates solvability and never derived from the killer/solution. */
export type TraitAxis =
  | "ruthless_merciful"
  | "methodical_reckless"
  | "empathetic_cold"
  | "skeptical_credulous"
  | "bold_cautious";
export type TraitPole =
  | "ruthless" | "merciful"
  | "methodical" | "reckless"
  | "empathetic" | "cold"
  | "skeptical" | "credulous"
  | "bold" | "cautious";
/** The Watcher's emergent portrait of the player; persisted + accumulated across days. */
export interface TraitState {
  /** signed score per axis (sign picks the pole; |score| ≥ threshold ⇒ revealed) */
  scores: Partial<Record<TraitAxis, number>>;
  /** poles revealed so far (the dossier) */
  revealed: TraitPole[];
}
/** The Watcher's eerie one-line evaluation — templated or bounded-LLM-voiced, NEVER derived
 *  from the killer/solution (only your behaviour summary). `intensity` is cosmetic (Part 5.4). */
export interface WatcherLine {
  pole?: TraitPole;
  line: string;
  intensity: number;
}

/** Persistent detective sheet (Redis `detective:{playerId}`, sliding ≤30d TTL). */
export interface DetectiveState {
  faculties: FacultyLevels;
  xp: number;
  playStreak: number;
  solveStreak: number;
  unlocks: string[]; // e.g. "pressure", "magnifier", "hint"
  /** the Watcher's emergent portrait of you (Part 5); accumulates across days */
  traits?: TraitState;
}

export interface RevealedClue {
  id: string;
  text: string;
  /** templated reformat the notetaker pins as a board node (server-authored) */
  noteText?: string;
  /** which NPC surfaced this clue (drives the notetaker → board edge) */
  sourceNpcId?: string;
  /** present ⇒ the line carried a lie-tell the player's faculties could read */
  tell?: TellSignal;
}

// ── request/response shapes ──
export interface StartCaseRequest { dailySeed: string; }
export interface StartCaseResponse { view: ClientCaseView; }

export interface InterrogateRequest { caseId: string; dailySeed: string; npcId: string; message: string; }
export interface InterrogateResponse { reply: string; revealed: RevealedClue[]; moderated?: boolean; watcher?: WatcherLine; }

export interface ExamineRequest { caseId: string; dailySeed: string; itemId: string; }
export interface ExamineResponse { examineText: string; revealed: RevealedClue[]; }

export interface NominateRequest { caseId: string; npcId: string; role: NominationRole; }
export interface NominateResponse { ok: true; }

export interface AccuseRequest {
  caseId: string;
  dailySeed: string;
  nominatedKillerId: string;
  nominations: Record<string, NominationRole>;
  discoveredClueIds: string[];
  inventory: string[];
  questions: number;
  timeMs: number;
}
export interface AccuseResponse {
  solved: boolean;
  score: number;
  rank: number | null;
  streak: { count: number; freeze: number };
  /** spoiler-safe end-of-game reveal + summary card data */
  summary: {
    killerName: string;
    yourClueCount: number;
    crowd: { total: number; killerRightPct: number };
  };
  /**
   * Present (and non-null) ⇒ the server REJECTED a premature accusation (the
   * Part 1.5 confidence gate was not met) and made NO state change. The client
   * should keep the player in the case. `summary` is spoiler-safe (no killerName)
   * when the accusation is rejected. Absent on a real (graded) accusation.
   */
  gateNotMet?: {
    reason: "gateNotMet";
    /** solution-edge clues required in discoveredClueIds (default = supportingClueIds.length). */
    needed: number;
    /** solution-edge clues actually present in discoveredClueIds. */
    have: number;
    /** true ⇒ the player hadn't even tagged a killer (the other half of the gate). */
    killerTagged: boolean;
  };
  /** the Watcher's closing evaluation of how you ran the case (cosmetic; Part 5). */
  watcher?: WatcherLine;
}

// ── present an item to an NPC (B2a) ──
export interface PresentRequest { caseId: string; dailySeed: string; itemId: string; npcId: string; tick?: number; }
export interface PresentResponse {
  /** spoiler-safe reaction prose (templated/pre-rendered, never the LLM). */
  reactionText: string;
  /** clues the present-reaction unlocked (server-authoritative). */
  revealed: RevealedClue[];
  /** present ⇒ a reaction revealed a refuter ⇒ the NPC was caught in a lie. */
  caughtInLie: boolean;
  moderated?: boolean;
}

// ── record the player's logical zone for a tick (drives perception) (B2a) ──
export interface MoveRequest { caseId: string; dailySeed: string; zoneId: string; tick: number; }
export interface MoveResponse {
  /** the zone now recorded as the player's logical position. */
  zoneId: string;
  /** NPC ids that witnessed the player entering this zone at this tick. */
  witnessedBy: string[];
}

// ── mid-case save/resume (B2a) ──
export interface SaveStateRequest {
  dailySeed: string;
  dayId: string;
  posZone: string;
  boardGraph: unknown;
  inventory: string[];
  transcriptRef: string;
  questionsUsed: number;
  elapsedMs: number;
  facultyXp?: Partial<FacultyLevels>;
}
export interface SaveStateResponse { ok: true }

export interface ResumeRequest { dailySeed: string; dayId: string; }
export interface ResumeResponse {
  /** the saved session for today, if any (null ⇒ start fresh). */
  state: {
    posZone: string;
    boardGraph: unknown;
    inventory: string[];
    transcriptRef: string;
    questionsUsed: number;
    elapsedMs: number;
    facultyXp: Partial<FacultyLevels>;
  } | null;
  /** true ⇒ a prior-day session is forfeit/read-only (no streak penalty). */
  readOnly: boolean;
  /** true ⇒ the client should load a fresh case for `dayId`. */
  startFresh: boolean;
}

// ── persistent detective sheet (B2a) ──
export interface DetectiveRequest { /* playerId comes from the session */ }
export interface DetectiveResponse { detective: DetectiveState; }

/** Strip everything secret. The ONLY place an instance becomes a client payload. */
export function toClientView(instance: CaseInstance, dailySeed: string): ClientCaseView {
  return {
    caseId: instance.templateId,
    dailySeed,
    setting: "", // filled by the endpoint from the template
    victim: "",
    map: { zones: [], navGrid: { cellSize: 16, origin: { x: 0, y: 0 }, cols: 25, rows: 25 } },
    suspectIds: instance.suspectIds,
    npcs: instance.npcs.map((n) => ({
      id: n.id,
      name: n.persona.name,
      blurb: n.persona.blurb,
      voice: n.persona.voice,
      tier: n.tier,
      homeZone: n.homeZone,
      routine: n.routine,
    })),
    items: instance.items.map((i) => ({ id: i.id, kind: i.kind, zone: i.zone, coords: i.coords })),
  };
}
