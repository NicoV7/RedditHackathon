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
import { useScreenTransition, TransitionVeil } from "./ui/transitions.js";

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
  // `displayed` lags `state` across phase changes so the screen (and its Phaser
  // canvas) swaps UNDER the transition veil; within a phase it mirrors live state.
  const { displayed, veil } = useScreenTransition(state);
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

  // ── mount/unmount the living-world scene for the Exploring + Dialogue phases ──
  //    The world host div lives in a PERSISTENT layer (see render) that stays in
  //    the DOM across BOTH phases — hidden behind the dialogue, never unmounted —
  //    so the Phaser scene is not torn down on the chat round-trip. That keeps its
  //    integer tick / NPC positions / camera alive (a stateful overworld). The
  //    scene is only destroyed when we leave the world entirely (Board/Resolved).
  useEffect(() => {
    const inWorld = displayed.phase === "Exploring" || displayed.phase === "Dialogue";
    if (inWorld && worldHostRef.current && !worldHandle.current) {
      worldHandle.current = bridge.mountWorld(worldHostRef.current, displayed.view, {
        onApproachNpc: (npcId) => dispatch({ type: "ENTER_DIALOGUE", npcId }),
        onExamineItem: (itemId) => void examine(itemId),
      });
    }
    if (!inWorld && worldHandle.current) {
      worldHandle.current.destroy();
      worldHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed.phase]);

  // ── mount/unmount the deduction board for the Board phase ──
  useEffect(() => {
    if (displayed.phase === "Board" && boardHostRef.current && !boardHandle.current) {
      const data = displayed;
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
    if (displayed.phase !== "Board" && boardHandle.current) {
      boardHandle.current.destroy();
      boardHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed.phase]);

  // ── push live deduction-strength meters to the board when tags/clues change ──
  useEffect(() => {
    if (displayed.phase !== "Board" || !boardHandle.current) return;
    for (const n of displayed.view.npcs) {
      boardHandle.current.setStrength(n.id, deductionStrength(displayed, n.id));
    }
  }, [displayed]);

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

  // ── render the displayed screen (it lags `state` across phase changes so the
  //    swap happens under the transition veil; within a phase it mirrors live state) ──
  let content: React.JSX.Element | null;
  if (displayed.phase === "Loading") {
    content = (
      <div style={center}>
        {displayed.error ? (
          <span style={{ color: noir.crimson }}>Couldn't open the parlor. {displayed.error}</span>
        ) : (
          <span style={{ color: noir.amber }}>Opening the parlor…</span>
        )}
      </div>
    );
  } else if (displayed.phase === "Briefing") {
    content = (
      <Briefing view={displayed.view} onStart={() => dispatch({ type: "START_INTERROGATING" })} />
    );
  } else if (displayed.phase === "Resolved") {
    content = <Resolution result={displayed.result} dailySeed={dailySeed} />;
  } else if (displayed.phase === "Dialogue") {
    const npc = displayed.view.npcs.find((n) => n.id === displayed.npcId);
    const mem = ensureMem(dialogueRef.current, displayed.npcId);
    const npcId = displayed.npcId;
    content = npc ? (
      <Interrogation
        npc={npc}
        transcript={mem.transcript}
        clues={displayed.clues}
        freshClueIds={mem.freshClueIds}
        askedChips={mem.askedChips}
        thinking={thinking}
        onAsk={(m) => void ask(npcId, m)}
        onBack={() => dispatch({ type: "EXIT_DIALOGUE" })}
      />
    ) : (
      <div style={center}>NPC not found.</div>
    );
  } else if (displayed.phase === "Board" || displayed.phase === "Accusing") {
    content = (
      <BoardPanel
        data={displayed as GameData}
        boardHostRef={boardHostRef}
        onTag={tag}
        onClose={() => dispatch({ type: "CLOSE_BOARD" })}
        onAccuse={(npcId) => void accuse(npcId)}
      />
    );
  } else {
    // Exploring — rendered by the persistent world layer below (not here), so the
    // Phaser canvas is never inside the keyed wrapper that re-mounts per phase.
    content = null;
  }

  const worldVisible = displayed.phase === "Exploring";
  return (
    <div style={shell}>
      {/* Persistent living-world layer — present across BOTH Exploring and Dialogue
          so the Phaser scene (integer tick / NPC positions / camera) survives the
          chat round-trip. During Dialogue it is HIDDEN (not unmounted) behind the
          opaque dialogue, keeping its state; it is torn down only when we leave the
          world entirely. The nav lives here too so it travels with the world. */}
      {(displayed.phase === "Exploring" || displayed.phase === "Dialogue") && (
        <div style={worldVisible ? worldLayer : worldLayerHidden}>
          <div ref={worldHostRef} style={worldHost} />
          <nav style={exploreNav}>
            <span style={exploreHint}>Tap a guest to interrogate. Examine what's left behind.</span>
            <button
              type="button"
              disabled={!displayed.boardUnlocked}
              style={{ ...boardBtn, ...(displayed.boardUnlocked ? null : boardBtnLocked) }}
              onClick={() => dispatch({ type: "OPEN_BOARD" })}
            >
              {displayed.boardUnlocked ? "Open the board" : "Board (find a clue first)"}
            </button>
          </nav>
        </div>
      )}
      {/* keyed so each screen change re-triggers the `parlorRise` enter animation;
          Exploring renders null here (the persistent world layer above is its screen) */}
      <div key={displayed.phase} className="parlor-screen">
        {content}
      </div>
      <TransitionVeil veil={veil} />
    </div>
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
// The persistent world layer fills the shell and stacks under the keyed screen
// wrapper. It is `position:absolute` so it overlaps (rather than stacks below)
// the in-flow screen wrapper; during Exploring it paints on top and owns input.
const worldLayer: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
};
// Dialogue: hide (don't unmount) the world. `visibility:hidden` keeps the layout
// size so Phaser's FIT scaler doesn't recompute to 0; `pointerEvents:none` lets
// the dialogue beneath it own all input.
const worldLayerHidden: React.CSSProperties = {
  ...worldLayer,
  visibility: "hidden",
  pointerEvents: "none",
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
