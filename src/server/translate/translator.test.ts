import { describe, it, expect } from "vitest";
import {
  MockTranslator,
  LocalTranslator,
  createTranslator,
  type TranslateRequest,
} from "./translator.js";
import { LOCAL_DICTIONARY, CANONICAL_PHRASES } from "./dictionary.js";

// ──────────────────────────────────────────────────────────────────────────
// MockTranslator
// ──────────────────────────────────────────────────────────────────────────

describe("MockTranslator", () => {
  it('has the name "mock"', () => {
    const mock = new MockTranslator();
    expect(mock.name).toBe("mock");
  });

  it("starts with an empty calls array before any translations", () => {
    const mock = new MockTranslator();
    expect(mock.calls).toHaveLength(0);
  });

  it("records every call in order", async () => {
    const mock = new MockTranslator();

    const req1: TranslateRequest = { text: "You understand?", targetLang: "it" };
    const req2: TranslateRequest = { text: "Of course.", targetLang: "ga" };

    await mock.translate(req1);
    await mock.translate(req2);

    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]).toEqual(req1);
    expect(mock.calls[1]).toEqual(req2);
  });

  it("returns a deterministic default reply formatted as [lang] text when no factory is provided", async () => {
    const mock = new MockTranslator();
    const result = await mock.translate({ text: "Enough.", targetLang: "la" });
    expect(result).toBe("[la] Enough.");
  });

  it("returns the value produced by a custom reply factory", async () => {
    const mock = new MockTranslator((r) => `${r.targetLang}::${r.text}`);
    const result = await mock.translate({ text: "Listen to me.", targetLang: "it" });
    expect(result).toBe("it::Listen to me.");
  });

  it("passes the full request object to the reply factory", async () => {
    let captured: TranslateRequest | null = null;
    const mock = new MockTranslator((r) => {
      captured = r;
      return "captured";
    });

    const req: TranslateRequest = { text: "My friend.", targetLang: "ga" };
    await mock.translate(req);

    expect(captured).toEqual(req);
  });

  it("accumulates calls across multiple invocations", async () => {
    const mock = new MockTranslator();
    const phrases = ["You understand?", "Of course.", "My friend.", "God forgive me.", "I swear it."];
    for (const text of phrases) {
      await mock.translate({ text, targetLang: "it" });
    }
    expect(mock.calls).toHaveLength(5);
    expect(mock.calls.map((c) => c.text)).toEqual(phrases);
  });

  it("each instance maintains its own independent calls list", async () => {
    const mockA = new MockTranslator();
    const mockB = new MockTranslator();

    await mockA.translate({ text: "Enough.", targetLang: "it" });

    expect(mockA.calls).toHaveLength(1);
    expect(mockB.calls).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// LocalTranslator
// ──────────────────────────────────────────────────────────────────────────

describe("LocalTranslator", () => {
  it('has the name "local"', () => {
    const translator = new LocalTranslator();
    expect(translator.name).toBe("local");
  });

  it("returns the Italian translation for a known (it, text) pair", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "You understand?", targetLang: "it" });
    expect(result).toBe("Capisci?");
  });

  it("returns the Irish translation for a known (ga, text) pair", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "Of course.", targetLang: "ga" });
    expect(result).toBe("Ar ndóigh.");
  });

  it("returns the Latin translation for a known (la, text) pair", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "My friend.", targetLang: "la" });
    expect(result).toBe("Amice.");
  });

  it("covers all canonical phrases for every supported language in the dictionary", async () => {
    const translator = new LocalTranslator();
    const langs = Object.keys(LOCAL_DICTIONARY);

    for (const lang of langs) {
      for (const phrase of CANONICAL_PHRASES) {
        const result = await translator.translate({ text: phrase, targetLang: lang });
        expect(result).toBe(LOCAL_DICTIONARY[lang]![phrase]);
      }
    }
  });

  it("falls back to the English source text for an unknown targetLang", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "Enough.", targetLang: "zz" });
    expect(result).toBe("Enough.");
  });

  it("falls back to the English source text for a known lang but unknown text", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "This phrase is not in the dictionary.", targetLang: "it" });
    expect(result).toBe("This phrase is not in the dictionary.");
  });

  it("falls back to the English source text for both unknown lang and unknown text", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "Unknown phrase.", targetLang: "xx" });
    expect(result).toBe("Unknown phrase.");
  });

  it("does not throw for an empty text string — returns the empty string", async () => {
    const translator = new LocalTranslator();
    const result = await translator.translate({ text: "", targetLang: "it" });
    expect(result).toBe("");
  });

  it("accepts a custom dictionary override via the constructor", async () => {
    const customDict: Record<string, Record<string, string>> = {
      fr: { "Hello.": "Bonjour." },
    };
    const translator = new LocalTranslator(customDict);
    const found = await translator.translate({ text: "Hello.", targetLang: "fr" });
    const missing = await translator.translate({ text: "Hello.", targetLang: "it" });

    expect(found).toBe("Bonjour.");
    expect(missing).toBe("Hello."); // falls back to source
  });
});

// ──────────────────────────────────────────────────────────────────────────
// createTranslator
// ──────────────────────────────────────────────────────────────────────────

describe("createTranslator", () => {
  it("returns a LocalTranslator when no env is provided (defaults to local)", () => {
    const translator = createTranslator({});
    expect(translator.name).toBe("local");
    expect(translator).toBeInstanceOf(LocalTranslator);
  });

  it("returns a LocalTranslator when PARLOR_TRANSLATE_BACKEND is explicitly 'local'", () => {
    const translator = createTranslator({ PARLOR_TRANSLATE_BACKEND: "local" });
    expect(translator.name).toBe("local");
    expect(translator).toBeInstanceOf(LocalTranslator);
  });

  it("returns a LocalTranslator when called with no arguments at all (env defaults to {})", () => {
    const translator = createTranslator();
    expect(translator.name).toBe("local");
    expect(translator).toBeInstanceOf(LocalTranslator);
  });

  it("throws for PARLOR_TRANSLATE_BACKEND = 'gemini'", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gemini" })).toThrow();
  });

  it("includes the backend name 'gemini' in the thrown error message", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gemini" })).toThrowError(/gemini/);
  });

  it("mentions 'wired in the Devvit server runtime' in the gemini error", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gemini" })).toThrowError(
      /wired in the Devvit server runtime/,
    );
  });

  it("throws for PARLOR_TRANSLATE_BACKEND = 'gt'", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gt" })).toThrow();
  });

  it("includes the backend name 'gt' in the thrown error message", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gt" })).toThrowError(/gt/);
  });

  it("mentions 'wired in the Devvit server runtime' in the gt error", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "gt" })).toThrowError(
      /wired in the Devvit server runtime/,
    );
  });

  it("throws for any unknown backend value", () => {
    expect(() => createTranslator({ PARLOR_TRANSLATE_BACKEND: "openai" })).toThrow();
  });

  it("the returned LocalTranslator actually resolves known phrases correctly", async () => {
    const translator = createTranslator({ PARLOR_TRANSLATE_BACKEND: "local" });
    const result = await translator.translate({ text: "Listen to me.", targetLang: "la" });
    expect(result).toBe("Audi me.");
  });
});
