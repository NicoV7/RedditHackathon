/**
 * Pure-logic tests for the detective-sheet display helpers (src/client/ui/detective.ts).
 *
 * Scope: the XP→level curve, faculty row ordering, and the spoiler-safe recap /
 * cliffhanger copy. All pure functions over the server-authoritative DetectiveState
 * — no DOM, no WebGL, no React. The level curve is a DISPLAY projection only and
 * never feeds game logic (the server owns real faculty levels + unlocks).
 */
import { describe, it, expect } from "vitest";
import type { DetectiveState, FacultyLevels } from "../../shared/api.js";
import {
  xpForLevel,
  detectiveLevel,
  facultyRows,
  recapOpener,
  cliffhanger,
  levelOf,
} from "./detective.js";

const levels: FacultyLevels = {
  logic: 3,
  empathy: 2,
  drama: 1,
  perception: 0,
  authority: 0,
  encyclopedia: 0,
};

describe("xpForLevel", () => {
  it("level 1 costs 0; the curve is monotonic", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(0)).toBe(0);
    let prev = -1;
    for (let n = 1; n <= 10; n++) {
      const v = xpForLevel(n);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("detectiveLevel", () => {
  it("0 xp ⇒ level 1, no progress", () => {
    const d = detectiveLevel(0);
    expect(d.level).toBe(1);
    expect(d.intoLevel).toBe(0);
    expect(d.progress).toBe(0);
  });

  it("exactly at a threshold ⇒ that level, 0 into it", () => {
    const floor = xpForLevel(3);
    const d = detectiveLevel(floor);
    expect(d.level).toBe(3);
    expect(d.intoLevel).toBe(0);
  });

  it("between thresholds ⇒ progress is the fraction into the level", () => {
    const floor = xpForLevel(2);
    const ceil = xpForLevel(3);
    const mid = floor + Math.floor((ceil - floor) / 2);
    const d = detectiveLevel(mid);
    expect(d.level).toBe(2);
    expect(d.progress).toBeGreaterThan(0);
    expect(d.progress).toBeLessThan(1);
    expect(d.intoLevel).toBe(mid - floor);
    expect(d.span).toBe(ceil - floor);
  });

  it("clamps progress to 0..1 and tolerates junk xp", () => {
    expect(detectiveLevel(-5).level).toBe(1);
    expect(detectiveLevel(Number.NaN).level).toBe(1);
    expect(detectiveLevel(Number.POSITIVE_INFINITY).progress).toBeLessThanOrEqual(1);
  });

  it("levelOf reads xp off a (possibly null) sheet", () => {
    expect(levelOf(null).level).toBe(1);
    const sheet: DetectiveState = {
      faculties: levels,
      xp: xpForLevel(4),
      playStreak: 1,
      solveStreak: 1,
      unlocks: [],
    };
    expect(levelOf(sheet).level).toBe(4);
  });
});

describe("facultyRows", () => {
  it("orders Logic + Empathy first (the SPINE pair) and carries levels", () => {
    const rows = facultyRows(levels);
    expect(rows.map((r) => r.id)).toEqual([
      "logic",
      "empathy",
      "drama",
      "perception",
      "authority",
      "encyclopedia",
    ]);
    expect(rows[0]).toMatchObject({ id: "logic", level: 3, label: "Logic" });
    expect(rows[1]).toMatchObject({ id: "empathy", level: 2 });
    // every row carries a non-empty glyph for the rail
    for (const r of rows) expect(r.glyph.length).toBeGreaterThan(0);
  });
});

describe("recap copy (spoiler-safe)", () => {
  it("solved vs stumped opener differs; neither names anyone", () => {
    const won = recapOpener(true, 3);
    const lost = recapOpener(false, 3);
    expect(won).not.toEqual(lost);
    // a long solve streak gets its own flavor
    expect(recapOpener(true, 9)).not.toEqual(recapOpener(true, 1));
  });

  it("cliffhanger is non-empty and teases tomorrow without spoilers", () => {
    const c = cliffhanger();
    expect(c.length).toBeGreaterThan(0);
    expect(c.toLowerCase()).toContain("tomorrow");
  });
});
