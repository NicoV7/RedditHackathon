/**
 * src/client/App.tsx — wires the FSM + screens and mounts the Phaser world +
 * board via the PhaserBridge INTERFACE (never the Phaser implementation).
 *
 * Responsibilities (the React shell owns game state; Phaser owns pixels):
 *  - drive the FSM reducer; run all side effects (api calls, the start clock)
 *  - mount the living-world scene in Exploring/Dialogue; the board in Board
 *  - translate Phaser intents (approach NPC, examine item, MOVE the avatar, PRESENT
 *    an item, tag, accuse) into FSM actions + server calls
 *  - fetch the persistent detective sheet on load; debounce-persist the mid-case
 *    session on each verb and resume it on entry (Part 1.4)
 *  - handle the Part 1.5 accuse gate: a server `gateNotMet` keeps the player IN the
 *    case (GATE_REJECTED → Board "need more evidence"); only a graded verdict RESOLVES.
 *
 * The client has NO knowledge of the killer: it sends nominations/accusations and
 * renders only server-revealed clues + the final reveal. Every Phaser FX it triggers
 * (the portrait lie-tell filter, the gotcha shake) is a cosmetic projection of a
 * server-authoritative signal — never read back into game logic.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PhaserBridge, WorldHandle, BoardHandle, BoardCard } from "./bridge.js";
import type { NominationRole, RevealedClue } from "../shared/api.js";
import { api } from "./api.js";
import {
  reducer,
  initialState,
  deductionStrength,
  latestTell,
  boardNodes,
  type GameState,
  type GameData,
} from "./state/fsm.js";
import { Briefing } from "./ui/Briefing.js";
import { Interrogation, type InterrogationLine } from "./ui/Interrogation.js";
import { BoardPanel } from "./ui/BoardPanel.js";
import { Resolution } from "./ui/Resolution.js";
import { Inventory } from "./ui/Inventory.js";
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

/** Debounce window for the mid-case save (Part 1.4): coalesce rapid verbs. */
const SAVE_DEBOUNCE_MS = 1200;

export function App({ bridge, dailySeed: seedProp }: AppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  // `displayed` lags `state` across phase changes so the screen (and its Phaser
  // canvas) swaps UNDER the transition veil; within a phase it mirrors live state.
  const { displayed, veil } = useScreenTransition(state);
  const [thinking, setThinking] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  // increments on every caught-in-a-lie present-result → the Interrogation panel
  // plays a cosmetic "gotcha" shake (Pillar 4 camera-shake analog in the React layer).
  const [gotcha, setGotcha] = useState(0);
  const dialogueRef = useRef<Record<string, DialogueMemory>>({});

  const dailySeed = seedProp ?? new Date().toISOString().slice(0, 10);

  const worldHostRef = useRef<HTMLDivElement | null>(null);
  const boardHostRef = useRef<HTMLDivElement | null>(null);
  const worldHandle = useRef<WorldHandle | null>(null);
  const boardHandle = useRef<BoardHandle | null>(null);

  // keep a ref to state for async closures that must not capture stale state
  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── load the case once, then resume any saved session + the detective sheet ──
  useEffect(() => {
    let alive = true;
    // resume runs in parallel: it tells us whether to load fresh / a prior session.
    void api.resume({ dailySeed, dayId: dailySeed }).catch(() => null);
    api
      .startCase({ dailySeed })
      .then((res) => {
        if (alive) dispatch({ type: "CASE_LOADED", view: res.view, startedAtMs: Date.now() });
      })
      .catch((e: unknown) => {
        if (alive) dispatch({ type: "LOAD_FAILED", error: String(e) });
      });
    // detective sheet (faculties/streaks/unlocks) — best-effort, non-blocking.
    api
      .detective({})
      .then((res) => {
        if (alive && res?.detective) dispatch({ type: "SET_DETECTIVE", detective: res.detective });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dailySeed]);

  // ── debounced mid-case save (Part 1.4): persist on each completed verb. The
  //    server is authoritative; this is best-effort and never blocks the UI. ──
  const saveTimer = useRef<number | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.phase === "Loading" || s.phase === "Briefing" || s.phase === "Resolved") return;
      void api
        .saveState({
          dailySeed,
          dayId: dailySeed,
          posZone: s.playerZone ?? "",
          // server-authored note pins are the durable board graph projection.
          boardGraph: boardNodes(s),
          inventory: s.inventory,
          transcriptRef: "", // transcripts are UI-local; server keeps its own log
          questionsUsed: s.questions,
          elapsedMs: Date.now() - s.startedAtMs,
        })
        .catch(() => {});
    }, SAVE_DEBOUNCE_MS);
  }, [dailySeed]);

  // flush any pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  // ── mount/unmount the living-world scene — kept ALIVE across every in-case
  //    phase (Exploring/Dialogue/Board/Accusing). The host div lives in a
  //    PERSISTENT layer (see render) hidden behind the opaque dialogue/board, so
  //    the Phaser scene is created ONCE and never torn down mid-case. While away
  //    it is paused (see the pause/resume effect below), keeping its integer tick
  //    / NPC positions / camera frozen in place. It is destroyed only when we
  //    leave the case entirely (Loading/Briefing/Resolved).
  useEffect(() => {
    const inWorld =
      displayed.phase === "Exploring" ||
      displayed.phase === "Dialogue" ||
      displayed.phase === "Board" ||
      displayed.phase === "Accusing";
    if (inWorld && worldHostRef.current && !worldHandle.current) {
      worldHandle.current = bridge.mountWorld(worldHostRef.current, displayed.view, {
        onApproachNpc: (npcId) => dispatch({ type: "ENTER_DIALOGUE", npcId }),
        onExamineItem: (itemId) => void examine(itemId),
        // the walkable avatar arrived in a zone → record the logical position
        // (server-authoritative perception model, Part 2.3).
        onMovePlayer: (zoneId) => void movePlayer(zoneId),
        // present a held item to an NPC from the world (the in-dialogue Present
        // affordance is the primary path; this supports a world-side present too).
        onPresentItem: (itemId, npcId) => void present(itemId, npcId),
      });
    }
    if (!inWorld && worldHandle.current) {
      worldHandle.current.destroy();
      worldHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed.phase]);

  // ── save+pause the overworld while the player is away (Dialogue/Board/Accusing),
  //    resume it on return to Exploring. Declared AFTER the mount effect so the
  //    handle exists; the world.ts guards make repeated pause/resume idempotent. ──
  useEffect(() => {
    if (displayed.phase === "Exploring") worldHandle.current?.resume();
    else worldHandle.current?.pause();
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
      // pin the notetaker notes the server authored (addNote? is optional on the bridge)
      for (const note of boardNodes(data)) {
        boardHandle.current.addNote?.(note.clueId, note.noteText, note.sourceNpcId);
      }
    }
    if (displayed.phase !== "Board" && boardHandle.current) {
      boardHandle.current.destroy();
      boardHandle.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed.phase]);

  // ── push live deduction-strength meters + new notes to the board on change ──
  const pinnedNotes = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (displayed.phase !== "Board" || !boardHandle.current) return;
    for (const n of displayed.view.npcs) {
      boardHandle.current.setStrength(n.id, deductionStrength(displayed, n.id));
    }
    // pin any newly-arrived notetaker note (idempotent via the pinned set)
    for (const note of boardNodes(displayed)) {
      if (pinnedNotes.current.has(note.clueId)) continue;
      pinnedNotes.current.add(note.clueId);
      boardHandle.current.addNote?.(note.clueId, note.noteText, note.sourceNpcId);
    }
    // gate the Phaser board's own Accuse affordance to match the React gate
    boardHandle.current.setAccuseEnabled?.(
      displayed.phase === "Board" && nominatedKillerReady(displayed),
    );
  }, [displayed]);

  // reset the pinned-notes ledger whenever the board is torn down (new mount)
  useEffect(() => {
    if (displayed.phase !== "Board") pinnedNotes.current = new Set();
  }, [displayed.phase]);

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
  const tag = useCallback(
    (npcId: string, role: NominationRole) => {
      dispatch({ type: "TAG_NPC", npcId, role });
      // best-effort persist; UI does not block on it
      void api.nominate({ caseId: caseIdOf(stateRef.current), npcId, role }).catch(() => {});
      scheduleSave();
    },
    [scheduleSave],
  );

  // record the avatar's logical zone (drives the perception model server-side).
  const movePlayer = useCallback(
    async (zoneId: string) => {
      const s = stateRef.current;
      if (s.phase === "Loading") return;
      // optimistic local update so perception-dependent UI reacts immediately
      dispatch({ type: "MOVE_PLAYER", zoneId });
      try {
        // a logical tick proxy: the world owns the integer clock, but move is a
        // discrete event; we send a monotonic tick derived from question count so
        // logic stays integer-pure (never a float / Date.now in logical state).
        await api.move({ caseId: s.view.caseId, dailySeed, zoneId, tick: s.questions });
      } catch {
        /* swallow — movement is non-blocking, the server reconciles */
      }
      scheduleSave();
    },
    [dailySeed, scheduleSave],
  );

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
        scheduleSave();
      }
    },
    [dailySeed, scheduleSave],
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
      } finally {
        scheduleSave();
      }
    },
    [dailySeed, scheduleSave],
  );

  // present a held item to an NPC (the "gotcha") → fires presentReactions server-side.
  const present = useCallback(
    async (itemId: string, npcId: string) => {
      const s = stateRef.current;
      if (s.phase === "Loading") return;
      setThinking(true);
      try {
        const res = await api.present({ caseId: s.view.caseId, dailySeed, itemId, npcId });
        // surface the reaction prose as an NPC line in the transcript
        const m = ensureMem(dialogueRef.current, npcId);
        m.transcript.push({ speaker: "you", text: `*presents the evidence*` });
        m.transcript.push({ speaker: "npc", text: res.reactionText });
        m.freshClueIds = res.revealed.map((c) => c.id);
        dispatch({
          type: "PRESENT_RESULT",
          clues: res.revealed,
          npcId,
          caughtInLie: res.caughtInLie,
        });
        // a caught lie → the cosmetic "gotcha" (Pillar 4 camera-shake analog). The
        // portrait's own lie-tell filter also fires if the reveal carried a tell.
        if (res.caughtInLie) setGotcha((g) => g + 1);
      } catch {
        /* swallow — present is non-blocking */
      } finally {
        setThinking(false);
        scheduleSave();
      }
    },
    [dailySeed, scheduleSave],
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
        // Part 1.5: a non-null `gateNotMet` is a SPOILER-SAFE rejection (the server
        // made no state change). Keep the player in the case — back to the Board
        // with a "need more evidence" nudge. Only a graded verdict RESOLVES.
        if (res.gateNotMet) {
          dispatch({ type: "GATE_REJECTED" });
        } else {
          dispatch({ type: "RESOLVED", result: res });
        }
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
    content = (
      <Resolution result={displayed.result} dailySeed={dailySeed} detective={displayed.detective} />
    );
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
        tell={latestTell(displayed, npcId)}
        inventory={displayed.inventory}
        items={displayed.view.items}
        bridge={bridge}
        gotcha={gotcha}
        onAsk={(m) => void ask(npcId, m)}
        onPresent={(itemId) => void present(itemId, npcId)}
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
      {/* Persistent living-world layer — present across every in-case phase
          (Exploring/Dialogue/Board/Accusing) so the Phaser scene (integer tick /
          NPC positions / camera) survives every round-trip. When not Exploring it
          is HIDDEN (not unmounted) behind the opaque dialogue/board and PAUSED,
          keeping its state frozen; it is torn down only when we leave the case
          entirely. The nav lives here too so it travels with the world. */}
      {(displayed.phase === "Exploring" ||
        displayed.phase === "Dialogue" ||
        displayed.phase === "Board" ||
        displayed.phase === "Accusing") && (
        <div style={worldVisible ? worldLayer : worldLayerHidden}>
          <div ref={worldHostRef} style={worldHost} />
          <nav style={exploreNav}>
            <span style={exploreHint}>Tap a guest to interrogate. Examine what's left behind.</span>
            <Inventory
              inventory={displayed.inventory}
              items={displayed.view.items}
              open={invOpen}
              onToggle={() => setInvOpen((o) => !o)}
            />
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
          Exploring renders null here (the persistent world layer above is its screen).
          The `parlorRise` transform gives this wrapper a stacking context that paints
          ABOVE the absolute world layer — so when it's empty (Exploring) it must be
          pointer-transparent, or it would swallow taps meant for the world + nav. */}
      <div
        key={displayed.phase}
        className="parlor-screen"
        style={displayed.phase === "Exploring" ? screenPassThrough : undefined}
      >
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

/** Advisory: is a killer tagged with enough deduction strength to enable Accuse? */
function nominatedKillerReady(s: GameData): boolean {
  for (const [npcId, role] of Object.entries(s.nominations)) {
    if (role === "killer" && deductionStrength(s, npcId) >= 0.6) return true;
  }
  return false;
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
// During Exploring the keyed wrapper is empty; let taps fall through it to the
// persistent world layer (canvas + nav) beneath. (It paints above the world layer
// because the parlorRise transform gives it a stacking context.)
const screenPassThrough: React.CSSProperties = { pointerEvents: "none" };
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
