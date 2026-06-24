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
  | { type: "REVEAL_CLUES"; clues: RevealedClue[]; fromItemId?: string }
  | { type: "TAG_NPC"; npcId: string; role: NominationRole }
  | { type: "BEGIN_ACCUSE"; nominatedKillerId: string }
  | { type: "CANCEL_ACCUSE" } // Accusing → Board
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
      return { ...state, clues, inventory, boardUnlocked } as GameState;
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
      return {
        phase: "Accusing",
        nominatedKillerId: action.nominatedKillerId,
        ...carry(state),
      };
    }

    case "CANCEL_ACCUSE": {
      if (state.phase !== "Accusing") return state;
      return { phase: "Board", ...carry(state) };
    }

    case "RESOLVED": {
      if (state.phase !== "Accusing") return state;
      return { phase: "Resolved", result: action.result, ...carry(state) };
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
