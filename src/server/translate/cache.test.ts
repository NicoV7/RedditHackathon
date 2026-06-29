import { describe, it, expect } from "vitest";
import { FakeRedis, TTL_30D } from "../redis/redis.js";
import { MockTranslator } from "./translator.js";
import { translateCached, translationKey } from "./cache.js";

describe("translateCached", () => {
  it("first call invokes the translator and returns the translation", async () => {
    const redis = new FakeRedis();
    const translator = new MockTranslator();
    const req = { text: "Good evening", targetLang: "it" };

    const result = await translateCached(redis, translator, req);

    expect(result).toBe("[it] Good evening");
    expect(translator.calls).toHaveLength(1);
    expect(translator.calls[0]).toEqual(req);
  });

  it("second identical call hits the cache (translator is NOT called again)", async () => {
    const redis = new FakeRedis();
    const translator = new MockTranslator();
    const req = { text: "Good evening", targetLang: "it" };

    const first = await translateCached(redis, translator, req);
    const second = await translateCached(redis, translator, req);

    expect(second).toBe(first);
    // translator.calls.length must remain 1 — the second request hit the cache
    expect(translator.calls).toHaveLength(1);
  });

  it("cache key carries a TTL <= 30 days", async () => {
    const redis = new FakeRedis();
    const translator = new MockTranslator();
    const req = { text: "Good evening", targetLang: "it" };

    await translateCached(redis, translator, req);

    const key = translationKey(req);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL_30D);
  });

  it("different (lang, text) pairs get different cache keys", () => {
    const reqA = { text: "Good evening", targetLang: "it" };
    const reqB = { text: "Good morning", targetLang: "it" };
    const reqC = { text: "Good evening", targetLang: "ga" };

    const keyA = translationKey(reqA);
    const keyB = translationKey(reqB);
    const keyC = translationKey(reqC);

    // different text → different key
    expect(keyA).not.toBe(keyB);
    // different lang → different key
    expect(keyA).not.toBe(keyC);
    // all three are distinct
    expect(keyB).not.toBe(keyC);
  });

  it("different (lang, text) pairs are cached and translated independently", async () => {
    const redis = new FakeRedis();
    const translator = new MockTranslator();
    const reqIt = { text: "Farewell", targetLang: "it" };
    const reqGa = { text: "Farewell", targetLang: "ga" };

    const itResult = await translateCached(redis, translator, reqIt);
    const gaResult = await translateCached(redis, translator, reqGa);

    // both delegated to the translator — 2 calls total
    expect(translator.calls).toHaveLength(2);
    expect(itResult).toBe("[it] Farewell");
    expect(gaResult).toBe("[ga] Farewell");

    // subsequent calls for either must still hit the cache (no additional translator calls)
    await translateCached(redis, translator, reqIt);
    await translateCached(redis, translator, reqGa);
    expect(translator.calls).toHaveLength(2);
  });

  it("cache key is stable: same (lang, text) always maps to the same key", () => {
    const req = { text: "In nomine legis", targetLang: "la" };
    expect(translationKey(req)).toBe(translationKey(req));
  });

  it("custom ttlSeconds is respected and still within the 30-day compliance ceiling", async () => {
    const redis = new FakeRedis();
    const translator = new MockTranslator();
    const req = { text: "Until we meet again", targetLang: "la" };
    const customTtl = 60 * 60; // 1 hour

    await translateCached(redis, translator, req, customTtl);

    const ttl = await redis.ttl(translationKey(req));
    expect(ttl).toBe(customTtl);
    expect(ttl).toBeLessThanOrEqual(TTL_30D);
  });
});
