/**
 * src/client/App.tsx — wires the FSM + screens and mounts the Phaser world +
 * board via the PhaserBridge INTERFACE (never the Phaser implementation).
 *
 * Responsibilities (the React shell owns game state; Phaser owns pixels):
 *  - drive the FSM reducer; run all side effects (api calls, the start clock)
 *  - mount the living-world scene in Exploring/Dialogue; the board in Board
 *  - translate Phaser intents (approach NPC, examine item, tag, accuse) into
 *    FSM actions + server calls
 *
 * The client has NO knowledge of the killer: it sends nominations/accusations
 * and renders only server-revealed clues + the final reveal.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PhaserBridge, WorldHandle, BoardHandle, BoardCard } from "./bridge.js";
import type { NominationRole, RevealedClue } from "../shared/api.js";
import { api } from "./api.js";
import {
  reducer,
  initialState,
  deductionStrength,
  type GameState,
  type GameData,
} from "./state/fsm.js";
import { Briefing } from "./ui/Briefing.js";
import { Interrogation, type InterrogationLine } from "./ui/Interrogation.js";
import { BoardPanel } from "./ui/BoardPanel.js";
import { Resolution } from "./ui/Resolution.js";
import { noir, font } from "./ui/theme.js";

export interface AppProps {
  bridge: PhaserBridge;
  /** the day's seed; defaults to today (UTC) if not injected by the host */
  dailySeed?: string;
}

/** Local per-NPC dialogue memory (transcripts/asked chips) — UI-only, not game state. */
interface DialogueMemory {
  transcript: InterrogationLine[];
  askedChips: string[];
  freshClueIds: string[];
}

export function App({ bridge, dailySeed: seedProp }: AppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [thinking, setThinking] = useState(false);
  const dialogueRef = useRef<Record<string, DialogueMemory>>({});

  const dailySeed = seedProp ?? new Date().toISOString().slice(0, 10);

  const worldHostRef = useRef<HTMLDivElement | null>(null);
  const boardHostRef = useRef<HTMLDivElement | null>(null);
  const worldHandle = useRef<WorldHandle | null>(null);
  const boardHandle = useRef<BoardHandle | null>(null);

  // ── load the case once ──
  useEffect(() => {
    let alive = true;
    api
      .startCase({ dailySeed })
      .then((res) => {
        if (alive) dispatch({ type: "CASE_LOADED", view: res.view, startedAtMs: Date.now() });
      })
      .catch((e: unknown) => {
        if (alive) dispatch({ type: "LOAD_FAILED", error: String(e) });
      });
    return () => {
      alive = false;
    };
  }, [dailySeed]);

  // ── mount/unmount the living-world scene for explore/dialogue phases ──
  useEffect(() => {
    const inWorld = state.phase === "Exploring" || state.phase === "Dialogue";
    if (inWorld && worldHostRef.current && !worldHandle.current) {
      worldHandle.current = bridge.mountWorld(worldHostRef.current, state.view, {
        onApproachNpc: (npcId) => dispatch({ type: "ENTER_DIALOGUE", npcId }),
        onExamineItem: (itemId) => void examine(itemId),
      });
    }
    if (!inWorld && worldHandle.current) {
      worldHandle.current.destroy();
      worldHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // ── mount/unmount the deduction board for the Board phase ──
  useEffect(() => {
    if (state.phase === "Board" && boardHostRef.current && !boardHandle.current) {
      const data = state;
      const cards: BoardCard[] = [
        ...data.view.npcs.map<BoardCard>((n) => ({ id: n.id, label: n.name, kind: "npc" })),
        ...data.clues.map<BoardCard>((c) => ({ id: c.id, label: c.text, kind: "clue" })),
      ];
      boardHandle.current = bridge.mountBoard(boardHostRef.current, { cards }, {
        onTagNpc: (npcId, role) => tag(npcId, role),
        onLink: () => {
          /* linking is a cosmetic hypothesis aid; deduction is structural server-side */
        },
        onAccuse: (npcId) => void accuse(npcId),
      });
      // seed the strength meters
      for (const n of data.view.npcs) {
        boardHandle.current.setStrength(n.id, deductionStrength(data, n.id));
      }
    }
    if (state.phase !== "Board" && boardHandle.current) {
      boardHandle.current.destroy();
      boardHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // ── push live deduction-strength meters to the board when tags/clues change ──
  useEffect(() => {
    if (state.phase !== "Board" || !boardHandle.current) return;
    for (const n of state.view.npcs) {
      boardHandle.current.setStrength(n.id, deductionStrength(state, n.id));
    }
  }, [state]);

  // ── tear everything down on unmount ──
  useEffect(() => {
    return () => {
      worldHandle.current?.destroy();
      boardHandle.current?.destroy();
      worldHandle.current = null;
      boardHandle.current = null;
    };
  }, []);

  // ── side-effecting intents ──
  const tag = useCallback((npcId: string, role: NominationRole) => {
    dispatch({ type: "TAG_NPC", npcId, role });
    // best-effort persist; UI does not block on it
    void api.nominate({ caseId: caseIdOf(stateRef.current), npcId, role }).catch(() => {});
  }, []);

  // keep a ref to state for async closures that must not capture stale state
  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const ask = useCallback(
    async (npcId: string, message: string) => {
      const s = stateRef.current;
      if (s.phase === "Loading") return;
      const mem = ensureMem(dialogueRef.current, npcId);
      mem.transcript.push({ speaker: "you", text: message });
      if (!mem.askedChips.includes(message)) mem.askedChips.push(message);
      dispatch({ type: "ASKED" });
      setThinking(true);
      try {
        const res = await api.interrogate({ caseId: s.view.caseId, dailySeed, npcId, message });
        const m = ensureMem(dialogueRef.current, npcId);
        m.transcript.push({ speaker: "npc", text: res.reply });
        m.freshClueIds = res.revealed.map((c) => c.id);
        if (res.revealed.length > 0) dispatch({ type: "REVEAL_CLUES", clues: res.revealed });
      } catch (e) {
        ensureMem(dialogueRef.current, npcId).transcript.push({
          speaker: "npc",
          text: "…(they fall silent — try again).",
        });
        void e;
      } finally {
        setThinking(false);
      }
    },
    [dailySeed],
  );

  const examine = useCallback(
    async (itemId: string) => {
      const s = stateRef.current;
      if (s.phase === "Loading") return;
      try {
        const res = await api.examine({ caseId: s.view.caseId, dailySeed, itemId });
        if (res.revealed.length > 0) {
          dispatch({ type: "REVEAL_CLUES", clues: res.revealed, fromItemId: itemId });
        }
      } catch {
        /* swallow — examine is non-blocking */
      }
    },
    [dailySeed],
  );

  const accuse = useCallback(
    async (npcId: string) => {
      const s = stateRef.current;
      if (s.phase === "Loading") return;
      dispatch({ type: "BEGIN_ACCUSE", nominatedKillerId: npcId });
      try {
        const res = await api.accuse({
          caseId: s.view.caseId,
          dailySeed,
          nominatedKillerId: npcId,
          nominations: s.nominations,
          discoveredClueIds: s.clues.map((c) => c.id),
          inventory: s.inventory,
          questions: s.questions,
          timeMs: Date.now() - s.startedAtMs,
        });
        dispatch({ type: "RESOLVED", result: res });
      } catch {
        dispatch({ type: "CANCEL_ACCUSE" });
      }
    },
    [dailySeed],
  );

  // ── render by phase ──
  if (state.phase === "Loading") {
    return (
      <Shell>
        <div style={center}>
          {state.error ? (
            <span style={{ color: noir.crimson }}>Couldn't open the parlor. {state.error}</span>
          ) : (
            <span style={{ color: noir.amber }}>Opening the parlor…</span>
          )}
        </div>
      </Shell>
    );
  }

  if (state.phase === "Briefing") {
    return (
      <Shell>
        <Briefing view={state.view} onStart={() => dispatch({ type: "START_INTERROGATING" })} />
      </Shell>
    );
  }

  if (state.phase === "Resolved") {
    return (
      <Shell>
        <Resolution result={state.result} dailySeed={dailySeed} />
      </Shell>
    );
  }

  if (state.phase === "Dialogue") {
    const npc = state.view.npcs.find((n) => n.id === state.npcId);
    const mem = ensureMem(dialogueRef.current, state.npcId);
    return (
      <Shell>
        {npc ? (
          <Interrogation
            npc={npc}
            transcript={mem.transcript}
            clues={state.clues}
            freshClueIds={mem.freshClueIds}
            askedChips={mem.askedChips}
            thinking={thinking}
            onAsk={(m) => void ask(state.npcId, m)}
            onBack={() => dispatch({ type: "EXIT_DIALOGUE" })}
          />
        ) : (
          <div style={center}>NPC not found.</div>
        )}
      </Shell>
    );
  }

  if (state.phase === "Board" || state.phase === "Accusing") {
    return (
      <Shell>
        <BoardPanel
          data={state as GameData}
          boardHostRef={boardHostRef}
          onTag={tag}
          onClose={() => dispatch({ type: "CLOSE_BOARD" })}
          onAccuse={(npcId) => void accuse(npcId)}
        />
      </Shell>
    );
  }

  // Exploring
  return (
    <Shell>
      <div style={exploreScreen}>
        <div ref={worldHostRef} style={worldHost} />
        <nav style={exploreNav}>
          <span style={exploreHint}>Tap a guest to interrogate. Examine what's left behind.</span>
          <button
            type="button"
            disabled={!state.boardUnlocked}
            style={{ ...boardBtn, ...(state.boardUnlocked ? null : boardBtnLocked) }}
            onClick={() => dispatch({ type: "OPEN_BOARD" })}
          >
            {state.boardUnlocked ? "Open the board" : "Board (find a clue first)"}
          </button>
        </nav>
      </div>
    </Shell>
  );
}

// ── helpers ──
function ensureMem(store: Record<string, DialogueMemory>, npcId: string): DialogueMemory {
  let m = store[npcId];
  if (!m) {
    m = { transcript: [], askedChips: [], freshClueIds: [] };
    store[npcId] = m;
  }
  return m;
}

function caseIdOf(s: GameState): string {
  return s.phase === "Loading" ? "" : s.view.caseId;
}

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div style={shell}>{children}</div>;
}

const shell: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: noir.room,
  color: noir.paper,
  fontFamily: font,
  overflow: "hidden",
};
const center: React.CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 24,
  fontSize: 18,
};
const exploreScreen: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
};
const worldHost: React.CSSProperties = { flex: 1, minHeight: 0, background: noir.ink };
const exploreNav: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: 12,
  borderTop: `1px solid ${noir.ink}`,
};
const exploreHint: React.CSSProperties = { flex: 1, fontSize: 13, color: noir.paperDim };
const boardBtn: React.CSSProperties = {
  background: noir.amber,
  color: noir.ink,
  border: "none",
  borderRadius: 10,
  padding: "12px 16px",
  fontSize: 14,
  fontWeight: 700,
  fontFamily: font,
  cursor: "pointer",
  minHeight: 48,
};
const boardBtnLocked: React.CSSProperties = {
  background: noir.ink,
  color: noir.paperDim,
  cursor: "not-allowed",
};

// re-export for tooling/tests
export type { RevealedClue };
