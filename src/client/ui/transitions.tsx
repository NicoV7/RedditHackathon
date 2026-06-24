/**
 * src/client/ui/transitions.tsx — screen-transition states ("fade through a cold veil").
 *
 * Screens hard-cut today (App.tsx renders by FSM phase). This adds a dependency-free
 * cross-dissolve: a `displayedPhase` LAGS the real phase so the screen — and its
 * expensive Phaser canvas — swaps UNDER an opaque cold veil (so the remount is never
 * seen and two Phaser scenes never coexist), then the veil clears and the new screen
 * rises in (`.parlor-screen` keyframe in index.html).
 *
 * `prefers-reduced-motion` → instant swap, no veil (accessibility). Crimson is reserved
 * for the lie-tell/red-string, so the veil is abyss-black + a faint witch-green, never red.
 */
import { useEffect, useRef, useState } from "react";
import type { GameState } from "../state/fsm.js";
import { noir } from "./theme.js";

const VEIL_IN = 210; // ms the veil takes to cover before we swap the screen under it
const VEIL_OUT = 240; // ms the veil takes to clear after the swap
const FADE = 200; // CSS opacity transition duration (constant, both directions)

/** True when the OS requests reduced motion; updates live if the user toggles it. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export type VeilState = "idle" | "in" | "out";

/**
 * Drives the cross-dissolve. Returns `displayed` — a snapshot of GameState that the
 * screens + Phaser mounts render from. Within a phase it mirrors live `state` (so
 * in-phase updates — new transcript lines, revealed clues — show immediately). On a
 * phase CHANGE it lags: veil covers → `displayed` swaps under cover → veil clears.
 * Carrying the whole GameState keeps the discriminated-union narrowing valid for the
 * lagged screen (e.g. `displayed.npcId` only exists when `displayed.phase === "Dialogue"`).
 */
export function useScreenTransition(state: GameState): {
  displayed: GameState;
  veil: VeilState;
} {
  const reduced = useReducedMotion();
  const [displayed, setDisplayed] = useState<GameState>(state);
  const [veil, setVeil] = useState<VeilState>("idle");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // same phase → mirror live updates (no veil)
    if (state.phase === displayed.phase) {
      if (state !== displayed) setDisplayed(state);
      return;
    }
    // phase changed → cross-dissolve through the veil
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    if (reduced) {
      setDisplayed(state);
      setVeil("idle");
      return;
    }

    setVeil("in"); // cover
    timers.current.push(
      window.setTimeout(() => {
        setDisplayed(state); // swap screen + Phaser canvas while fully covered
        setVeil("out");
        timers.current.push(window.setTimeout(() => setVeil("idle"), VEIL_OUT));
      }, VEIL_IN),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reduced]);

  // clear any pending timers on unmount
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  return { displayed, veil };
}

/** The full-screen veil. Abyss-black with a faint witch-green bloom — never crimson. */
export function TransitionVeil({ veil }: { veil: VeilState }): React.JSX.Element {
  return (
    <div
      className="parlor-veil"
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
        opacity: veil === "in" ? 0.97 : 0,
        transition: `opacity ${FADE}ms ease`,
        background: `radial-gradient(120% 90% at 50% 38%, ${noir.green}26, transparent 60%), ${noir.ink}`,
      }}
    />
  );
}
