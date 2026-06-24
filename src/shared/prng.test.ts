import { describe, it, expect } from "vitest";
import { mulberry32, rngFromString, hashSeed } from "./prng.js";

describe("mulberry32 PRNG (the pinned, portable generator)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces floats in [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("string seeds hash deterministically", () => {
    expect(hashSeed("parlor")).toBe(hashSeed("parlor"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("int/pick/shuffle are seed-stable", () => {
    const r1 = rngFromString("x");
    const r2 = rngFromString("x");
    expect(r1.shuffle([1, 2, 3, 4, 5])).toEqual(r2.shuffle([1, 2, 3, 4, 5]));
  });
});
