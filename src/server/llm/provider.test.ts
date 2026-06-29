import { describe, it, expect } from "vitest";
import {
  MockProvider,
  createProvider,
  type CompletionRequest,
} from "./provider.js";

// ──────────────────────────────────────────────────────────────────────────
// MockProvider
// ──────────────────────────────────────────────────────────────────────────

describe("MockProvider", () => {
  describe("complete()", () => {
    it("records every call in order", async () => {
      const mock = new MockProvider();

      const req1: CompletionRequest = { system: "sys-a", user: "user-a" };
      const req2: CompletionRequest = { system: "sys-b", user: "user-b", maxSentences: 3 };

      await mock.complete(req1);
      await mock.complete(req2);

      expect(mock.calls).toHaveLength(2);
      expect(mock.calls[0]).toEqual(req1);
      expect(mock.calls[1]).toEqual(req2);
    });

    it("returns the default reply when no custom reply factory is given", async () => {
      const mock = new MockProvider();
      const result = await mock.complete({ system: "s", user: "u" });
      expect(result).toBe("I have nothing to add.");
    });

    it("returns the value produced by a custom reply factory", async () => {
      const mock = new MockProvider((r) => `echo: ${r.user}`);
      const result = await mock.complete({ system: "s", user: "hello" });
      expect(result).toBe("echo: hello");
    });

    it("passes the full request object to the reply factory", async () => {
      let captured: CompletionRequest | null = null;
      const mock = new MockProvider((r) => {
        captured = r;
        return "captured";
      });

      const req: CompletionRequest = { system: "sys", user: "usr", maxSentences: 2 };
      await mock.complete(req);

      expect(captured).toEqual(req);
    });

    it("starts with an empty calls array before any completions", () => {
      const mock = new MockProvider();
      expect(mock.calls).toHaveLength(0);
    });

    it("accumulates calls across multiple invocations", async () => {
      const mock = new MockProvider();
      for (let i = 0; i < 5; i++) {
        await mock.complete({ system: "s", user: `turn-${i}` });
      }
      expect(mock.calls).toHaveLength(5);
      expect(mock.calls.map((c) => c.user)).toEqual([
        "turn-0", "turn-1", "turn-2", "turn-3", "turn-4",
      ]);
    });
  });

  describe("moderate()", () => {
    it('flags text containing "kill yourself"', async () => {
      const mock = new MockProvider();
      const result = await mock.moderate("You should kill yourself.");
      expect(result.flagged).toBe(true);
      expect(result.categories).toContain("harassment");
    });

    it('flags text containing "slur-token"', async () => {
      const mock = new MockProvider();
      const result = await mock.moderate("That slur-token is awful.");
      expect(result.flagged).toBe(true);
      expect(result.categories).toContain("harassment");
    });

    it("is case-insensitive when flagging", async () => {
      const mock = new MockProvider();
      const upper = await mock.moderate("KILL YOURSELF");
      expect(upper.flagged).toBe(true);

      const mixed = await mock.moderate("Kill Yourself");
      expect(mixed.flagged).toBe(true);
    });

    it("passes benign text through without flagging", async () => {
      const mock = new MockProvider();
      const result = await mock.moderate("Good morning, detective.");
      expect(result.flagged).toBe(false);
      expect(result.categories).toBeUndefined();
    });

    it("passes an empty string without flagging", async () => {
      const mock = new MockProvider();
      const result = await mock.moderate("");
      expect(result.flagged).toBe(false);
    });

    it("does not flag text that merely contains a substring of the banned phrase", async () => {
      // "kill" alone is not the full word-boundary phrase "kill yourself"
      const mock = new MockProvider();
      const result = await mock.moderate("The killer left tracks.");
      expect(result.flagged).toBe(false);
    });
  });

  it('has the name "mock"', () => {
    const mock = new MockProvider();
    expect(mock.name).toBe("mock");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// createProvider
// ──────────────────────────────────────────────────────────────────────────

describe("createProvider", () => {
  it("throws when PARLOR_LLM_KEY is absent (no key in env)", () => {
    expect(() => createProvider({})).toThrowError(
      /no PARLOR_LLM_KEY set for provider/,
    );
  });

  it("includes the provider name in the no-key error message", () => {
    expect(() =>
      createProvider({ PARLOR_LLM_PROVIDER: "gemini" }),
    ).toThrowError(/gemini/);
  });

  it("mentions the default provider (gemini) in the no-key error when none is specified", () => {
    expect(() => createProvider({})).toThrowError(/gemini/);
  });

  it('throws the "wired in runtime" error when a key IS provided', () => {
    expect(() =>
      createProvider({ PARLOR_LLM_KEY: "test-api-key" }),
    ).toThrowError(/wired in the Devvit server runtime/);
  });

  it('throws the "wired in runtime" error for an explicit gemini provider with a key', () => {
    expect(() =>
      createProvider({ PARLOR_LLM_KEY: "gk-123", PARLOR_LLM_PROVIDER: "gemini" }),
    ).toThrowError(/wired in the Devvit server runtime/);
  });

  it('throws the "wired in runtime" error for an explicit openai provider with a key', () => {
    expect(() =>
      createProvider({ PARLOR_LLM_KEY: "sk-abc", PARLOR_LLM_PROVIDER: "openai" }),
    ).toThrowError(/wired in the Devvit server runtime/);
  });

  it("no-key error message includes the provider name from PARLOR_LLM_PROVIDER", () => {
    expect(() =>
      createProvider({ PARLOR_LLM_PROVIDER: "openai" }),
    ).toThrowError(/openai/);
  });

  it("does not return a provider object — always throws", () => {
    // Both paths must throw; calling createProvider must never resolve silently.
    const withKey = () => createProvider({ PARLOR_LLM_KEY: "key" });
    const withoutKey = () => createProvider({});
    expect(withKey).toThrow();
    expect(withoutKey).toThrow();
  });
});
