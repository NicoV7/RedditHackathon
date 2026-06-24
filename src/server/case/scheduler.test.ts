/**
 * Scheduler pool logic (J3, PLAN §2.6). The off-request pre-gen job's pure core:
 * generate + validate templates ahead of time, then pick a ready one at serve time.
 */
import { describe, it, expect } from "vitest";
import { drawInstance } from "./procedural.js";
import { validateInstance } from "./validate.js";
import { prepareCasePool, prepareTemplate, pickReadyCase, drawFromReady } from "./scheduler.js";

describe("scheduler pool", () => {
  const seeds = ["2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27"];

  it("prepareTemplate validates the probe (every generated template is ready)", () => {
    for (const s of seeds) {
      const { validation } = prepareTemplate(s);
      expect(validation.ok, `${s}: ${validation.reason}`).toBe(true);
    }
  });

  it("prepareCasePool generates one ready entry per seed, none rejected", () => {
    const pool = prepareCasePool(seeds);
    expect(pool.ready.length).toBe(seeds.length);
    expect(pool.rejected.length).toBe(0);
    expect(pool.ready.map((r) => r.dailySeed)).toEqual(seeds); // order preserved
  });

  it("every pooled template's probe re-validates (no stale/broken entries ship)", () => {
    const pool = prepareCasePool(seeds);
    for (const r of pool.ready) {
      expect(validateInstance(r.probeInstance).ok, r.dailySeed).toBe(true);
    }
  });

  it("is pure & deterministic: same seeds ⇒ byte-identical pool", () => {
    expect(JSON.stringify(prepareCasePool(seeds))).toBe(JSON.stringify(prepareCasePool(seeds)));
  });

  it("pickReadyCase prefers an exact daily-seed match", () => {
    const pool = prepareCasePool(seeds);
    const picked = pickReadyCase(pool, "2026-06-26");
    expect(picked?.dailySeed).toBe("2026-06-26");
  });

  it("pickReadyCase falls back to a pre-pooled spare when no exact match", () => {
    const pool = prepareCasePool(seeds);
    const picked = pickReadyCase(pool, "9999-99-99");
    expect(picked?.dailySeed).toBe(seeds[0]); // first spare, never null when pool non-empty
  });

  it("pickReadyCase returns null on an empty pool (caller falls back to on-demand)", () => {
    expect(pickReadyCase({ ready: [], rejected: [] }, "any")).toBeNull();
  });

  it("drawFromReady matches the request-path draw for the same template+seed", () => {
    const pool = prepareCasePool(seeds);
    const ready = pickReadyCase(pool, "2026-06-25")!;
    const viaScheduler = drawFromReady(ready, "player-42");
    const viaDirect = drawInstance(ready.template, "player-42");
    expect(JSON.stringify(viaScheduler)).toBe(JSON.stringify(viaDirect));
    expect(validateInstance(viaScheduler).ok).toBe(true);
    expect(viaScheduler.killerId).toBe(viaDirect.killerId);
  });
});
