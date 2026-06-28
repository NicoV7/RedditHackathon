/**
 * src/client/state/fsm.ts — the game-state finite state machine. The SINGLE UI
 * authority: one transition table, a typed state union, and a pure reducer.
 *
 * Flow: Loading → Briefing → Exploring ⇄ Dialogue ⇄ Board → Accusing → Resolved
 *
 * The reducer is pure: no fetch, no clocks, no Math.random. Side effects (api
 * calls, the start clock) live in App.tsx, which dispatches results back in.
 * The client NEVER learns the killer — clues arrive only via REVEAL_CLUES, the
 * final verdict only via RESOLVED.
 */
import type {
  ClientCaseView,
  RevealedClue,
  NominationRole,
  AccuseResponse,
  DetectiveState,
  FacultyLevels,
  TellSignal,
  WatcherLine,
  TraitState,
  TraitPole,
} from "../../shared/api.js";

// ───────────────────────── Phases ─────────────────────────
export type Phase =
  | "Loading"
  | "Briefing"
  | "Exploring"
  | "Dialogue"
  | "Board"
  | "Accusing"
  | "Resolved";

/**
 * A board node derived from a revealed clue that carries `noteText`. The
 * notetaker pins these onto the Deduction Board; `sourceNpcId` (when present)
 * is a board edge back to the NPC that surfaced the clue. PURELY derived data —
 * the server authors `noteText`/`sourceNpcId`; the client never invents either.
 */
export interface BoardNode {
  clueId: string;
  /** server-authored, templated pin label (falls back to clue.text). */
  noteText: string;
  /** the NPC that surfaced the clue, if any (drives a board → NPC edge). */
  sourceNpcId?: string;
}

/** Data accumulated across the case; carried by every post-load state. */
export interface GameData {
  view: ClientCaseView;
  /** revealed clues, de-duped by id, in arrival order */
  clues: RevealedClue[];
  /** player's hypothesis tags per NPC */
  nominations: Record<string, NominationRole>;
  /** questions asked (drives the accuse payload + crowd scoring) */
  questions: number;
  /** items examined / collected for the accuse inventory */
  inventory: string[];
  /** logical case-start timestamp (ms); set once when the case loads */
  startedAtMs: number;
  /** true once the first clue lands — unlocks the Deduction Board */
  boardUnlocked: boolean;
  /** the avatar's current logical zone (server-authoritative via MOVE_PLAYER). */
  playerZone: string | null;
  /** persistent detective sheet (faculties, streaks); null until SET_DETECTIVE. */
  detective: DetectiveState | null;
  /**
   * latest tell per dialogue, keyed by npcId — drives the Faculties HUD lie-glow.
   * Cosmetic only: never read by win/lose logic. The tell rides in on REVEAL_CLUES.
   */
  tells: Record<string, TellSignal>;
  /**
   * The Watcher's latest interjection, keyed by npcId (the dialogue it spoke into).
   * It rides in on REVEAL_CLUES (interrogate) — see the `watcher` action field.
   * FLAVOR/identity only (Part 5): never read by win/lose logic, never gates
   * solvability. Server-authored prose; the client never derives a trait from it.
   */
  watcher: Record<string, WatcherLine>;
  /**
   * The Watcher's CLOSING line from the graded accusation (AccuseResponse.watcher),
   * if any — drives the Resolution dossier reveal. Null until RESOLVED. Cosmetic.
   */
  watcherClosing: WatcherLine | null;
  /**
   * The Watcher's emergent portrait of the player (revealed trait poles + signed
   * per-axis scores), carried off the persistent DetectiveState. FLAVOR/identity
   * only: never gates solvability, never derived from the killer/solution. Null
   * until the detective sheet loads (SET_DETECTIVE).
   */
  traits: TraitState | null;
  /**
   * true ⇒ the server REJECTED the last accusation as premature (gateNotMet).
   * Drives the Board's "need more evidence" prompt; cleared on the next accuse.
   */
  needMoreEvidence: boolean;
}

// ───────────────────── State union ─────────────────────
export interface LoadingState {
  phase: "Loading";
  error?: string;
}
export interface BriefingState extends GameData {
  phase: "Briefing";
}
export interface ExploringState extends GameData {
  phase: "Exploring";
}
export interface DialogueState extends GameData {
  phase: "Dialogue";
  npcId: string;
}
export interface BoardState extends GameData {
  phase: "Board";
}
export interface AccusingState extends GameData {
  phase: "Accusing";
  nominatedKillerId: string;
}
export interface ResolvedState extends GameData {
  phase: "Resolved";
  result: AccuseResponse;
}

export type GameState =
  | LoadingState
  | BriefingState
  | ExploringState
  | DialogueState
  | BoardState
  | AccusingState
  | ResolvedState;

// ───────────────────── Actions ─────────────────────
export type GameAction =
  | { type: "CASE_LOADED"; view: ClientCaseView; startedAtMs: number }
  | { type: "LOAD_FAILED"; error: string }
  | { type: "START_INTERROGATING" } // Briefing → Exploring (or straight into first NPC)
  | { type: "ENTER_DIALOGUE"; npcId: string }
  | { type: "EXIT_DIALOGUE" } // back to Exploring
  | { type: "OPEN_BOARD" }
  | { type: "CLOSE_BOARD" } // Board → Exploring
  | { type: "ASKED" } // a question was sent (await started)
  | {
      // clues revealed by an interrogate/examine turn. `watcher` (interrogate only)
      // rides in here — the Watcher's interjection for the active dialogue (Part 5);
      // FLAVOR/identity only, never read by win/lose logic.
      type: "REVEAL_CLUES";
      clues: RevealedClue[];
      fromItemId?: string;
      watcher?: WatcherLine;
    }
  | {
      // a present-an-item-to-an-NPC result: reveal clues + record the lie-catch
      type: "PRESENT_RESULT";
      clues: RevealedClue[];
      npcId: string;
      caughtInLie: boolean;
    }
  | { type: "MOVE_PLAYER"; zoneId: string } // server-confirmed logical zone
  | { type: "SET_DETECTIVE"; detective: DetectiveState } // detective sheet loaded
  | { type: "TAG_NPC"; npcId: string; role: NominationRole }
  | { type: "BEGIN_ACCUSE"; nominatedKillerId: string }
  | { type: "CANCEL_ACCUSE" } // Accusing → Board
  | { type: "GATE_REJECTED" } // server rejected a premature accuse → back to Board
  | { type: "RESOLVED"; result: AccuseResponse };

// ───────────────────── Helpers ─────────────────────
function carry(s: GameData): GameData {
  return {
    view: s.view,
    clues: s.clues,
    nominations: s.nominations,
    questions: s.questions,
    inventory: s.inventory,
    startedAtMs: s.startedAtMs,
    boardUnlocked: s.boardUnlocked,
    playerZone: s.playerZone,
    detective: s.detective,
    tells: s.tells,
    watcher: s.watcher,
    watcherClosing: s.watcherClosing,
    traits: s.traits,
    needMoreEvidence: s.needMoreEvidence,
  };
}

function mergeClues(existing: RevealedClue[], incoming: RevealedClue[]): RevealedClue[] {
  const seen = new Set(existing.map((c) => c.id));
  const merged = existing.slice();
  for (const c of incoming) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  }
  return merged;
}

/**
 * Fold any tell carried by `incoming` clues into the per-NPC tells map, keyed by
 * `sourceNpcId`. The latest tell for a dialogue wins (drives the Faculties HUD
 * glow). Cosmetic-only: this map is never read by win/lose logic.
 */
function foldTells(
  existing: Record<string, TellSignal>,
  incoming: RevealedClue[],
  fallbackNpcId?: string,
): Record<string, TellSignal> {
  let next = existing;
  for (const c of incoming) {
    if (!c.tell) continue;
    const npcId = c.sourceNpcId ?? fallbackNpcId;
    if (!npcId) continue;
    if (next === existing) next = { ...existing };
    next[npcId] = c.tell;
  }
  return next;
}

/** True once the player holds a state that carries game data (post-load). */
function isLoaded(s: GameState): s is Exclude<GameState, LoadingState> {
  return s.phase !== "Loading";
}

export const initialState: GameState = { phase: "Loading" };

// ───────────────────── Pure reducer (the transition table) ─────────────────────
export function reducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "CASE_LOADED": {
      if (state.phase !== "Loading") return state;
      return {
        phase: "Briefing",
        view: action.view,
        clues: [],
        nominations: {},
        questions: 0,
        inventory: [],
        startedAtMs: action.startedAtMs,
        boardUnlocked: false,
        playerZone: null,
        detective: null,
        tells: {},
        watcher: {},
        watcherClosing: null,
        traits: null,
        needMoreEvidence: false,
      };
    }

    case "LOAD_FAILED": {
      if (state.phase !== "Loading") return state;
      return { phase: "Loading", error: action.error };
    }

    case "START_INTERROGATING": {
      if (state.phase !== "Briefing") return state;
      return { phase: "Exploring", ...carry(state) };
    }

    case "ENTER_DIALOGUE": {
      // reachable from Exploring or Board (tap an NPC anywhere)
      if (state.phase !== "Exploring" && state.phase !== "Board") return state;
      return { phase: "Dialogue", npcId: action.npcId, ...carry(state) };
    }

    case "EXIT_DIALOGUE": {
      if (state.phase !== "Dialogue") return state;
      return { phase: "Exploring", ...carry(state) };
    }

    case "OPEN_BOARD": {
      // progressive disclosure: the board only opens once unlocked
      if (!isLoaded(state) || !state.boardUnlocked) return state;
      if (state.phase === "Board" || state.phase === "Accusing") return state;
      return { phase: "Board", ...carry(state) };
    }

    case "CLOSE_BOARD": {
      if (state.phase !== "Board") return state;
      return { phase: "Exploring", ...carry(state) };
    }

    case "ASKED": {
      if (!isLoaded(state)) return state;
      return { ...state, questions: state.questions + 1 } as GameState;
    }

    case "REVEAL_CLUES": {
      if (!isLoaded(state)) return state;
      const clues = mergeClues(state.clues, action.clues);
      const inventory =
        action.fromItemId && !state.inventory.includes(action.fromItemId)
          ? [...state.inventory, action.fromItemId]
          : state.inventory;
      // first clue unlocks the board (one-way latch)
      const boardUnlocked = state.boardUnlocked || clues.length > 0;
      // surface any lie-tell carried by the clues for the Faculties HUD.
      // When in dialogue, the active NPC is the fallback source for the tell.
      const fallbackNpcId = state.phase === "Dialogue" ? state.npcId : undefined;
      const tells = foldTells(state.tells, action.clues, fallbackNpcId);
      // the Watcher's interjection (interrogate only) is keyed to the active
      // dialogue NPC; latest wins. FLAVOR-only — never read by win/lose logic.
      const watcher =
        action.watcher && fallbackNpcId
          ? { ...state.watcher, [fallbackNpcId]: action.watcher }
          : state.watcher;
      return { ...state, clues, inventory, boardUnlocked, tells, watcher } as GameState;
    }

    case "PRESENT_RESULT": {
      if (!isLoaded(state)) return state;
      const clues = mergeClues(state.clues, action.clues);
      const boardUnlocked = state.boardUnlocked || clues.length > 0;
      // a caught lie is a tell against the presented-to NPC; otherwise fold any
      // tell the revealed clues carry (sourceNpcId wins, else the present target).
      const tells = foldTells(state.tells, action.clues, action.npcId);
      return { ...state, clues, boardUnlocked, tells } as GameState;
    }

    case "MOVE_PLAYER": {
      if (!isLoaded(state)) return state;
      return { ...state, playerZone: action.zoneId } as GameState;
    }

    case "SET_DETECTIVE": {
      if (!isLoaded(state)) return state;
      // carry the Watcher's emergent portrait (revealed trait poles) off the sheet
      // so the Dossier can render it. FLAVOR/identity only; never gates solvability.
      const traits = action.detective.traits ?? state.traits;
      return { ...state, detective: action.detective, traits } as GameState;
    }

    case "TAG_NPC": {
      if (!isLoaded(state)) return state;
      return {
        ...state,
        nominations: { ...state.nominations, [action.npcId]: action.role },
      } as GameState;
    }

    case "BEGIN_ACCUSE": {
      // only from the Board, and only when the nominated NPC is tagged 'killer'
      if (state.phase !== "Board") return state;
      if (state.nominations[action.nominatedKillerId] !== "killer") return state;
      // clear any prior "need more evidence" flag — this is a fresh attempt.
      return {
        phase: "Accusing",
        nominatedKillerId: action.nominatedKillerId,
        ...carry(state),
        needMoreEvidence: false,
      };
    }

    case "CANCEL_ACCUSE": {
      if (state.phase !== "Accusing") return state;
      return { phase: "Board", ...carry(state) };
    }

    case "GATE_REJECTED": {
      // server rejected a premature accusation (AccuseResponse.gateNotMet): no
      // state change server-side, so keep the player in the case. Return to the
      // Board with a "need more evidence" flag for the UI to surface.
      if (state.phase !== "Accusing" && state.phase !== "Board") return state;
      return { phase: "Board", ...carry(state), needMoreEvidence: true };
    }

    case "RESOLVED": {
      if (state.phase !== "Accusing") return state;
      // the Watcher's closing line rides in on the graded AccuseResponse (Part 5);
      // surface it for the Resolution dossier reveal. FLAVOR-only.
      return {
        phase: "Resolved",
        result: action.result,
        ...carry(state),
        watcherClosing: action.result.watcher ?? state.watcherClosing,
      };
    }

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// ───────────────────── Derived selectors (pure) ─────────────────────
/** Deduction strength 0..1 for an NPC: how committed the player's tag is. */
export function deductionStrength(s: GameData, npcId: string): number {
  const role = s.nominations[npcId];
  const clueWeight = Math.min(s.clues.length / 5, 1); // more clues ⇒ firmer ground
  switch (role) {
    case "killer":
      return Math.min(0.5 + 0.5 * clueWeight, 1);
    case "suspect":
      return 0.3 + 0.3 * clueWeight;
    case "bystander":
      return 0.2 + 0.2 * clueWeight;
    case "unknown":
    case undefined:
    default:
      return 0;
  }
}

/** The single NPC currently tagged as the killer, if any (accuse precondition). */
export function nominatedKiller(s: GameData): string | null {
  for (const [npcId, role] of Object.entries(s.nominations)) {
    if (role === "killer") return npcId;
  }
  return null;
}

/**
 * Default deduction-strength threshold for the client-side accuse gate. The
 * SERVER enforces the real gate (AccuseResponse.gateNotMet, on solution-edge
 * clue coverage); this is only a UI affordance so the button isn't a footgun.
 */
export const ACCUSE_THRESHOLD = 0.6;

/**
 * Pure client-side accuse gate (Part 1.5). True ⇒ a killer is tagged AND that
 * killer's deduction-strength meter clears the threshold. This is advisory only:
 * the server independently re-checks and may still return `gateNotMet`, which we
 * handle via GATE_REJECTED. Defaulting `threshold` keeps existing callers working.
 */
export function canAccuse(s: GameData, threshold: number = ACCUSE_THRESHOLD): boolean {
  const killerId = nominatedKiller(s);
  if (!killerId) return false;
  return deductionStrength(s, killerId) >= threshold;
}

/**
 * Notetaker board nodes: every revealed clue that carries server-authored
 * `noteText` becomes a pin (with an optional `sourceNpcId` edge back to the NPC).
 * Pure projection over `clues` — the notetaker never invents text. Clues without
 * `noteText` are intentionally omitted (they're not board-pinnable notes).
 */
export function boardNodes(s: GameData): BoardNode[] {
  const nodes: BoardNode[] = [];
  for (const c of s.clues) {
    if (!c.noteText) continue;
    nodes.push({ clueId: c.id, noteText: c.noteText, sourceNpcId: c.sourceNpcId });
  }
  return nodes;
}

/** The latest lie-tell recorded for an NPC's dialogue, if any (Faculties HUD). */
export function latestTell(s: GameData, npcId: string): TellSignal | null {
  return s.tells[npcId] ?? null;
}

/** Convenience: the player's current faculty levels (or null until loaded). */
export function faculties(s: GameData): FacultyLevels | null {
  return s.detective?.faculties ?? null;
}

/**
 * The Watcher's latest interjection for an NPC's dialogue, if any (Part 5.5 — the
 * cold/eldritch rail in Interrogation). FLAVOR/identity only: never read by
 * win/lose logic. Mirrors `latestTell` but for the Watcher voice.
 */
export function latestWatcher(s: GameData, npcId: string): WatcherLine | null {
  return s.watcher[npcId] ?? null;
}

/**
 * The Watcher's emergent self-portrait of the player (Part 5.5 Dossier). Pure
 * projection over the loaded `traits`: the revealed poles (the dossier so far) plus
 * the signed per-axis scores. FLAVOR/identity only — never gates solvability and
 * never derived from the killer/solution. `revealed` is empty until the first pole
 * crosses its threshold; `scores` is empty until the sheet loads.
 */
export interface DossierView {
  /** poles the Watcher has surfaced about you so far (in reveal order). */
  revealed: TraitPole[];
  /** signed score per axis (sign picks the pole; |score| ≥ threshold ⇒ revealed). */
  scores: TraitState["scores"];
}
export function dossier(s: GameData): DossierView {
  const t = s.traits;
  return { revealed: t?.revealed ?? [], scores: t?.scores ?? {} };
}
