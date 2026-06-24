import { describe, it, expect } from "vitest";
import { CORPUS } from "./corpus.js";
import { validateInstance } from "./validate.js";

describe("validator on the known-answer corpus", () => {
  for (const entry of CORPUS) {
    it(`${entry.expectOk ? "accepts" : "rejects"}: ${entry.name}`, () => {
      const res = validateInstance(entry.instance);
      expect(res.ok).toBe(entry.expectOk);
      if (!entry.expectOk && entry.reasonHas) {
        expect(res.reason ?? "").toContain(entry.reasonHas);
      }
    });
  }

  it("scores 100% on the corpus (gate before trusting the generator)", () => {
    const score = CORPUS.filter((e) => validateInstance(e.instance).ok === e.expectOk).length;
    expect(score).toBe(CORPUS.length);
  });
});
