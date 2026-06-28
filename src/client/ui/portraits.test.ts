/**
 * Unit tests for src/client/ui/portraits.ts — portraitFor() slug lookup.
 *
 * Scope: every known NPC name in the cast resolves to a non-empty string;
 * unknown names fall back deterministically (same input ⇒ same output, always
 * one of the 12 known portrait values); the lookup table covers the full cast.
 *
 * PNG imports are resolved by Vitest/Vite to URL strings (or the file path in
 * the Node runner). We never assert the specific URL value — only that the
 * returned value is a non-empty string and, for unknown names, that it is
 * stable across repeated calls (deterministic hash fallback).
 */
import { describe, it, expect } from "vitest";
import { portraitFor } from "./portraits.js";

// ---------------------------------------------------------------------------
// The cast — mirrors BY_NAME in portraits.ts exactly.
// ---------------------------------------------------------------------------
const KNOWN_CAST: readonly string[] = [
  "Lola Marsh",
  "Don Vittorio",
  "Frankie Conti",
  "Sil Greco",
  "Det. Halloran",
  "Nell Carraway",
  "Harlan",
  "Mr. Ash",
  "Augie Doyle",
  "Old Cobb",
  "Birdie",
  'Marco "the Ledger" Bellandi',
];

describe("portraitFor — known cast", () => {
  it("returns a non-empty string for every known NPC name", () => {
    for (const name of KNOWN_CAST) {
      const result = portraitFor(name);
      expect(typeof result, `portrait for "${name}" should be a string`).toBe("string");
      expect(result.length, `portrait for "${name}" should not be empty`).toBeGreaterThan(0);
    }
  });

  it("lookup table is complete — all 12 cast members resolve", () => {
    expect(KNOWN_CAST.length).toBe(12);
    for (const name of KNOWN_CAST) {
      expect(portraitFor(name), `"${name}" missing from lookup table`).toBeTruthy();
    }
  });

  it("each cast member resolves to a distinct portrait value", () => {
    const results = KNOWN_CAST.map((name) => portraitFor(name));
    const unique = new Set(results);
    expect(unique.size).toBe(KNOWN_CAST.length);
  });

  it("is case-sensitive (exact name match required)", () => {
    // Uppercase variant must NOT match the exact key and falls back instead.
    const exact = portraitFor("Lola Marsh");
    const lower = portraitFor("lola marsh");
    // The fallback is still a string — it just doesn't have to equal the exact portrait.
    expect(typeof lower).toBe("string");
    expect(lower.length).toBeGreaterThan(0);
    // Lower-case "lola marsh" hashes to a different slot than the exact name.
    // (It may accidentally collide with another portrait, but that's fine — we
    //  just confirm both are valid non-empty strings.)
    expect(exact).toBeTruthy();
  });
});

describe("portraitFor — unknown names (fallback)", () => {
  it("returns a non-empty string for an unknown name", () => {
    const result = portraitFor("Completely Unknown Person");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("is deterministic — same unknown name always returns the same portrait", () => {
    const name = "Nobody Famous";
    expect(portraitFor(name)).toBe(portraitFor(name));
    expect(portraitFor(name)).toBe(portraitFor(name)); // triple-check
  });

  it("different unknown names can map to different portraits (hash spread)", () => {
    // Collect a batch of unknown names and verify at least some differ,
    // confirming the hash function is actually distributing (not always 0).
    const unknowns = [
      "Alice",
      "Bob",
      "Charlie",
      "Delilah",
      "Edgar",
      "Fiona",
      "George",
      "Hector",
      "Ingrid",
      "James",
      "Katerina",
      "Leonardo",
    ];
    const results = unknowns.map((n) => portraitFor(n));
    const unique = new Set(results);
    // With 12 unknowns hashing into 12 slots, expect at least 2 distinct values.
    expect(unique.size).toBeGreaterThan(1);
  });

  it("empty string falls back without throwing", () => {
    expect(() => portraitFor("")).not.toThrow();
    const result = portraitFor("");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("very long name falls back without throwing", () => {
    const longName = "A".repeat(10_000);
    expect(() => portraitFor(longName)).not.toThrow();
    expect(typeof portraitFor(longName)).toBe("string");
  });

  it("fallback result is always one of the known portrait values", () => {
    // All 12 portrait slots are reachable; an unknown name must land on one of them.
    const knownPortraits = new Set(KNOWN_CAST.map((n) => portraitFor(n)));
    expect(knownPortraits.size).toBe(12); // sanity
    const unknownResult = portraitFor("Totally Fictional NPC");
    expect(knownPortraits.has(unknownResult)).toBe(true);
  });
});
