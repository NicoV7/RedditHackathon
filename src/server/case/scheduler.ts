/**
 * Generation scheduler — pure pool logic (C2, PLAN §2.6).
 *
 * Generation runs OFF the request path: a scheduled job (the Devvit cron track, wired
 * elsewhere) pre-builds and validator-verifies a pool of daily templates *ahead* of the
 * UTC rollover, so the per-player instance draw at request time is a zero-LLM, integer-
 * pure seeded projection over an already-ready template (≤8 principals + ~20–30 items
 * stay inside Devvit's 30s budget). This module is the deterministic, side-effect-free
 * CORE of that job — no Redis, no cron, no clock — so it is unit-testable in isolation.
 * The Devvit track persists the returned pool with a ≤30-day TTL per CLAUDE.md.
 *
 * Determinism: every draw flows through mulberry32 via the daily seed string; the same
 * (seeds, opts) always yields a byte-identical pool. No Math.random / Date.now / floats.
 */
import type { CaseInstance, CaseTemplate } from "../../shared/case.js";
import { drawInstance, generateTemplate } from "./procedural.js";
import { validateInstance, type ValidationResult } from "./validate.js";

/** A template that has PASSED validation against a self-check instance — i.e. it is
 *  ready to back per-player draws. `probeInstance` is the seed-0 draw used to prove it. */
export interface ReadyTemplate {
  dailySeed: string;
  template: CaseTemplate;
  /** The validator-proven probe instance (seed `pool-probe`); discard before storage. */
  probeInstance: CaseInstance;
}

/** A template generated but REJECTED by the validator (must never ship). */
export interface RejectedTemplate {
  dailySeed: string;
  reason: string;
}

export interface CasePool {
  /** Templates proven solvable-and-unique, in the order their seeds were supplied. */
  ready: ReadyTemplate[];
  /** Any seed whose generated template failed validation (should be empty in practice). */
  rejected: RejectedTemplate[];
}

/** A single deterministic probe seed: the same string ⇒ the same probe instance. */
const PROBE_SEED = "pool-probe";

/**
 * Generate + validate ONE template for `dailySeed`. The probe instance is drawn with a
 * fixed seed and run through the full structural validator (referential integrity +
 * acyclic reachability + blind-solver uniqueness). The template is "ready" iff the probe
 * validates. Pure: no I/O, no clock, deterministic in `dailySeed`/`opts`.
 */
export function prepareTemplate(
  dailySeed: string,
  opts?: { suspects?: number; extras?: number },
): { template: CaseTemplate; probeInstance: CaseInstance; validation: ValidationResult } {
  const template = generateTemplate(dailySeed, opts);
  const probeInstance = drawInstance(template, PROBE_SEED);
  const validation = validateInstance(probeInstance);
  return { template, probeInstance, validation };
}

/**
 * Pre-generate + validate a pool of templates ahead of time (the off-request job's
 * core). Each seed in `dailySeeds` becomes a `ReadyTemplate` if its probe validates,
 * else a `RejectedTemplate`. Order is preserved; the function is pure & deterministic.
 *
 * Devvit track (not here): persist `ready` to Redis keyed by `dailySeed` with a ≤30-day
 * TTL, refresh ahead of each UTC rollover, and purge on the deletion triggers.
 */
export function prepareCasePool(
  dailySeeds: readonly string[],
  opts?: { suspects?: number; extras?: number },
): CasePool {
  const ready: ReadyTemplate[] = [];
  const rejected: RejectedTemplate[] = [];
  for (const dailySeed of dailySeeds) {
    const { template, probeInstance, validation } = prepareTemplate(dailySeed, opts);
    if (validation.ok) ready.push({ dailySeed, template, probeInstance });
    else rejected.push({ dailySeed, reason: validation.reason ?? "unknown" });
  }
  return { ready, rejected };
}

/**
 * Select the ready template to serve for `wantedSeed` (typically today's UTC date).
 *
 *  1. Exact match: a ready template whose `dailySeed === wantedSeed` (the normal path).
 *  2. Fallback: the first ready template in the pool (a pre-pooled spare), so a missed
 *     scheduled run never leaves players with no case.
 *  3. None ready ⇒ `null` (caller falls back to on-demand `generateTemplate`).
 *
 * Pure selection over the pool — no generation, no I/O.
 */
export function pickReadyCase(pool: CasePool, wantedSeed: string): ReadyTemplate | null {
  const exact = pool.ready.find((r) => r.dailySeed === wantedSeed);
  if (exact) return exact;
  return pool.ready[0] ?? null;
}

/** Convenience: derive a per-player instance from a picked ready template. Mirrors the
 *  request-path draw so the scheduler and the live server agree on instance shape. */
export function drawFromReady(ready: ReadyTemplate, playerSeed: string): CaseInstance {
  return drawInstance(ready.template, playerSeed);
}
