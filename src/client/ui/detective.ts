/**
 * src/client/ui/detective.ts — pure helpers for the detective sheet display
 * (Part 1.2 "XP→level" + 1.3 progression). NO React, NO DOM — pure functions over
 * the server-authoritative `DetectiveState`, so they're unit-testable headlessly.
 *
 * The level curve is a DISPLAY projection only: it never feeds game logic (the
 * server owns faculty levels + unlocks). It mirrors the spec's "simple cumulative-
 * XP curve" so the Resolution card can show a level + progress-to-next.
 */
import type { DetectiveState, FacultyLevels } from "../../shared/api.js";
import { facultyMeta } from "./theme.js";

/** XP needed to reach detective level `n` (n ≥ 1): a gentle quadratic ramp. */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  // 0, 100, 250, 450, 700, … — each level costs 50 more than the last step.
  return 50 * (n - 1) * n;
}

export interface DetectiveLevel {
  /** the detective's current level (≥ 1). */
  level: number;
  /** xp banked into the current level. */
  intoLevel: number;
  /** xp span of the current level (intoLevel / span = progress 0..1). */
  span: number;
  /** progress through the current level, 0..1 (1 at the cap). */
  progress: number;
}

/** Project a cumulative XP total onto a level + progress-to-next (display only). */
export function detectiveLevel(xp: number): DetectiveLevel {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  // walk up while the next threshold is cleared (bounded — levels grow quadratically)
  while (xpForLevel(level + 1) <= safeXp && level < 999) level += 1;
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const intoLevel = safeXp - floor;
  const progress = Math.max(0, Math.min(1, intoLevel / span));
  return { level, intoLevel, span, progress };
}

export interface FacultyRow {
  id: keyof FacultyLevels;
  label: string;
  glyph: string;
  level: number;
}

/** Faculties as ordered display rows (Logic + Empathy first — the SPINE pair). */
export function facultyRows(levels: FacultyLevels): FacultyRow[] {
  const order: (keyof FacultyLevels)[] = [
    "logic",
    "empathy",
    "drama",
    "perception",
    "authority",
    "encyclopedia",
  ];
  return order.map((id) => {
    const meta = facultyMeta(id);
    return { id, label: meta.label, glyph: meta.glyph, level: levels[id] ?? 0 };
  });
}

/**
 * A one-line recap opener + a cliffhanger teaser for the Resolution card
 * (Part 1.4 "recap + cliffhanger"). PURELY presentational — derived from the
 * server-authoritative solved flag + streaks; never names the killer here.
 */
export function recapOpener(solved: boolean, solveStreak: number): string {
  if (solved) {
    if (solveStreak >= 5) return "The room exhales. You named them cold — and the Order took note.";
    if (solveStreak >= 2) return "Another envelope sealed. The parlor learns your face.";
    return "You drew the line taut and it held. Case closed.";
  }
  return "The lamps gutter. Someone walked out clean tonight — and they know you watched.";
}

/** A spoiler-safe cliffhanger that teases tomorrow's case (never names anyone). */
export function cliffhanger(): string {
  return "Before dawn, the Order leaves another envelope outside the Drowned Lily. Tomorrow, a new body. A new lie. Come back and read it.";
}

/** Convenience: derive the level for a loaded detective sheet (or level 1). */
export function levelOf(d: DetectiveState | null): DetectiveLevel {
  return detectiveLevel(d?.xp ?? 0);
}
