/**
 * The Watcher — structural player-trait inference (Part 5.2–5.3).
 *
 * A PURE, deterministic projection of the player's BEHAVIOUR event log onto ~5
 * bipolar personality axes. The Watcher's portrait of YOU; identity/retention
 * only.
 *
 * Hard invariants (CLAUDE.md / PLAN §5.8):
 *  - FLAVOR ONLY: traits NEVER gate solvability and are NEVER fed back into game
 *    logic. The structural deduction skeleton does not read them.
 *  - Integer-pure + deterministic: scores are integer deltas accumulated from the
 *    event log. NO Math.random / Date.now. Same events ⇒ same traits, byte-for-byte.
 *  - Zero-knowledge: inference takes ONLY the player's own behaviour. It NEVER
 *    receives killerId / solution / an NPC slice. Trait scores are identical no
 *    matter who the killer is (the event log carries no guilt) — asserted in tests.
 *  - Derived from the player's OWN behaviour (no Reddit-data training).
 */
import type { TraitAxis, TraitPole, TraitState } from "../../shared/api.js";

// ─────────────────────────── Behaviour vocabulary ───────────────────────────
// The Watcher reads a small, closed set of behaviour signals. This is a SUPERSET
// of the `PlayerEventKind` log (tookItem/presentedItem/enteredZone/askedTopic/
// caughtInLie) plus the accusation OUTCOME, which the endpoint stamps after a
// graded accuse. Defined structurally here (like the harness's MemoryEvent) so
// inference compiles without importing the metrics/repos modules.
//
// NONE of these carry guilt: an outcome's `solved`/`fullEvidence`/`early` flags
// describe HOW the player accused, never WHO the killer is.

export type TraitEventKind =
  | "tookItem"
  | "presentedItem"
  | "enteredZone"
  | "askedTopic"
  | "caughtInLie"
  | "accuse";

/** Deterministic tone of a pre-authored question chip (Part 5.3). Chips are
 *  authored, so each carries a fixed tone tag; free-text defaults to "neutral". */
export type AskTone = "aggressive" | "gentle" | "neutral";

export interface TraitEvent {
  kind: TraitEventKind;
  /** logical tick (integer); used only for ordering/early-accuse heuristics. */
  tick?: number;
  /** for `askedTopic`: the chip's authored tone (aggressive/gentle/neutral). */
  tone?: AskTone;
  /** for `tookItem`: a "thorough" examine (e.g. a magnifier/deep inspect). */
  thorough?: boolean;
  /** for `accuse`: did the player solve it? (outcome flavor, NOT the solution). */
  solved?: boolean;
  /** for `accuse`: did the player have the full required evidence on the board? */
  fullEvidence?: boolean;
  /** for `accuse`: was the accusation made early / under-evidenced? */
  early?: boolean;
}

// ─────────────────────────── Axis model (closed) ───────────────────────────
// Each axis is a signed integer score. A NEGATIVE score leans the FIRST pole of
// its name, a POSITIVE score the SECOND (matching the `axis = "a_b"` ordering in
// shared/api.ts). A pole REVEALS when |score| crosses REVEAL_THRESHOLD.

export const REVEAL_THRESHOLD = 6;

/** The closed axis vocabulary, with the pole each sign maps to. */
const AXES: Record<TraitAxis, { neg: TraitPole; pos: TraitPole }> = {
  ruthless_merciful: { neg: "ruthless", pos: "merciful" },
  methodical_reckless: { neg: "methodical", pos: "reckless" },
  empathetic_cold: { neg: "empathetic", pos: "cold" },
  skeptical_credulous: { neg: "skeptical", pos: "credulous" },
  bold_cautious: { neg: "bold", pos: "cautious" },
};

const AXIS_IDS = Object.keys(AXES) as TraitAxis[];

/** The pole a signed score selects (0 ⇒ none; sign picks neg/pos). */
export function poleForScore(axis: TraitAxis, score: number): TraitPole | null {
  if (score === 0) return null;
  return score < 0 ? AXES[axis].neg : AXES[axis].pos;
}

// ─────────────────────────── Behaviour → axis deltas ───────────────────────────
// Each behaviour nudges one or more axes by an INTEGER delta (PLAN §5.3). Deltas
// are intentionally small so a single action never instantly reveals; a habit does.

type Delta = Partial<Record<TraitAxis, number>>;

/** The integer axis nudges for a single behaviour event (pure, no I/O). */
function deltasForEvent(e: TraitEvent): Delta {
  switch (e.kind) {
    case "askedTopic": {
      // pressure / aggressive tone → +ruthless/+cold; gentle → +merciful/+empathetic.
      if (e.tone === "aggressive") return { ruthless_merciful: -2, empathetic_cold: +2 };
      if (e.tone === "gentle") return { ruthless_merciful: +2, empathetic_cold: -2 };
      return {};
    }
    case "tookItem":
      // examining evidence is methodical; a thorough examine more so.
      return { methodical_reckless: e.thorough ? -2 : -1 };
    case "presentedItem":
      // proving via evidence reads as skeptical + methodical.
      return { skeptical_credulous: -2, methodical_reckless: -1 };
    case "caughtInLie":
      // catching a lie via evidence reads as skeptical + methodical.
      return { skeptical_credulous: -2, methodical_reckless: -1 };
    case "enteredZone":
      // exploration is mildly methodical (you canvass the scene).
      return { methodical_reckless: -1 };
    case "accuse": {
      const d: Delta = {};
      const add = (axis: TraitAxis, v: number) => {
        d[axis] = (d[axis] ?? 0) + v;
      };
      if (e.fullEvidence) {
        // full-evidence accuse → +methodical / +cautious.
        add("methodical_reckless", -3);
        add("bold_cautious", +3);
      }
      if (e.early) {
        // early / under-evidenced accuse → +reckless / +bold.
        add("methodical_reckless", +3);
        add("bold_cautious", -3);
      }
      if (e.solved === false) {
        // a wrong accusation → +reckless.
        add("methodical_reckless", +3);
      }
      return d;
    }
  }
}

// ─────────────────────────── Inference (pure) ───────────────────────────

/** Clone a score map (so a passed `prior` is never mutated). Deterministic. */
function cloneScores(scores: Partial<Record<TraitAxis, number>>): Partial<Record<TraitAxis, number>> {
  const out: Partial<Record<TraitAxis, number>> = {};
  for (const axis of AXIS_IDS) {
    const v = scores[axis];
    if (typeof v === "number" && v !== 0) out[axis] = Math.trunc(v);
  }
  return out;
}

/** The revealed poles for a score map, in stable axis order (deterministic). */
export function revealedPoles(scores: Partial<Record<TraitAxis, number>>): TraitPole[] {
  const out: TraitPole[] = [];
  for (const axis of AXIS_IDS) {
    const score = scores[axis] ?? 0;
    if (Math.abs(score) >= REVEAL_THRESHOLD) {
      const pole = poleForScore(axis, score);
      if (pole) out.push(pole);
    }
  }
  return out;
}

/**
 * Infer the Watcher's structural trait portrait from the player's behaviour
 * `events`, optionally accumulated on top of a `prior` (the persisted
 * `TraitState`, so the portrait deepens across days).
 *
 * PURE + deterministic + integer-pure. NO killerId / solution / slice input — the
 * result is invariant to the case solution (the event log carries no guilt).
 *
 * Returns the new `{ scores, revealed }`. `revealed` is the full closed-vocabulary
 * set of poles crossed (not just newly-crossed) so callers can diff against the
 * prior to detect a *fresh* reveal (see `newlyRevealed`).
 */
export function inferTraits(events: readonly TraitEvent[], prior?: TraitState): TraitState {
  const scores = cloneScores(prior?.scores ?? {});

  for (const e of events) {
    const d = deltasForEvent(e);
    for (const axis of AXIS_IDS) {
      const delta = d[axis];
      if (!delta) continue;
      scores[axis] = (scores[axis] ?? 0) + Math.trunc(delta);
    }
  }

  // Drop axes that landed back on exactly 0 (keeps the map minimal + stable).
  for (const axis of AXIS_IDS) if (scores[axis] === 0) delete scores[axis];

  return { scores, revealed: revealedPoles(scores) };
}

/** Poles revealed in `next` that were NOT revealed in `prior` (a *fresh* reveal). */
export function newlyRevealed(prior: TraitState | undefined, next: TraitState): TraitPole[] {
  const before = new Set(prior?.revealed ?? []);
  return next.revealed.filter((p) => !before.has(p));
}

// ─────────────────── Chip → tone tag helper (Part 5.3) ───────────────────
// Question chips are PRE-AUTHORED, so their tone is a deterministic property of
// the chip, not an inference. This maps a chip's intent/id to a tone the Watcher
// reads. Aggressive = pressure/accuse-leaning; gentle = reassure/empathize. The
// mapping is a fixed keyword table (deterministic, no RNG). Free-text or an
// unrecognized chip is neutral (no trait nudge), so unbounded input can never
// steer the portrait beyond the bounded chip vocabulary.

const AGGRESSIVE_HINTS = ["pressure", "accuse", "threaten", "demand", "confront", "interrogate", "force", "liar", "lying", "alibi"];
const GENTLE_HINTS = ["reassure", "comfort", "empathize", "gentle", "console", "trust", "apologize", "thank", "sympathize"];

/** Deterministic tone for a pre-authored chip, keyed by its id/label keywords. */
export function chipTone(chip: { id?: string; label?: string; tone?: AskTone }): AskTone {
  if (chip.tone) return chip.tone; // an explicit authored tag always wins.
  const hay = `${chip.id ?? ""} ${chip.label ?? ""}`.toLowerCase();
  for (const h of AGGRESSIVE_HINTS) if (hay.includes(h)) return "aggressive";
  for (const h of GENTLE_HINTS) if (hay.includes(h)) return "gentle";
  return "neutral";
}
