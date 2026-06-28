/**
 * Named, portable PRNG — a CLAUDE.md / contract invariant.
 *
 * All seeded generation and logical motion MUST use this (never Math.random /
 * Date.now / float accumulation), so the same seed yields byte-identical results
 * across devices, server, and tests. Integer-pure: deterministic on any JS engine.
 */

/** Hash an arbitrary string seed to a 32-bit unsigned integer (xmur3 step). */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** A small, fast, deterministic PRNG. Returns floats in [0, 1). */
export type Rng = {
  /** next float in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  /** pick one element */
  pick<T>(arr: readonly T[]): T;
  /** Fisher–Yates shuffle (returns a new array) */
  shuffle<T>(arr: readonly T[]): T[];
};

/** mulberry32 — the project's canonical PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) throw new Error("pick() on empty array");
    return arr[int(arr.length)]!;
  };
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { next, int, pick, shuffle };
}

/** Construct an Rng from a string seed (the common case). */
export function rngFromString(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}

/**
 * Deterministically pick one element from `items` using a namespaced string seed.
 * Integer-pure (mulberry32). Returns `undefined` for an empty array. The single
 * home for the "seeded pick from an array" idiom (mood / interjection / deflection).
 */
export function seededPick<T>(seedKey: string, items: readonly T[]): T | undefined {
  return items.length ? items[rngFromString(seedKey).int(items.length)] : undefined;
}
