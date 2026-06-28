/**
 * Redis-cached translation (Workstream C). A translated phrase is computed once and
 * cached so the steady state is zero backend calls — this is what keeps a future
 * cloud backend from adding a per-turn LLM call. Every cache key carries a ≤30-day
 * TTL (compliance: EVERY Redis key class expires).
 */
import { hashSeed } from "../../shared/prng.js";
import { TTL_30D, type RedisLike } from "../redis/redis.js";
import type { Translator, TranslateRequest } from "./translator.js";

/** Cache key for a (language, phrase) pair. Hashed so arbitrary phrases stay key-safe. */
export function translationKey(req: TranslateRequest): string {
  return `xlate:${req.targetLang}:${hashSeed(req.text)}`;
}

/**
 * Translate with a Redis-backed cache. On a miss the translator is called once and
 * the result is stored with a ≤30-day TTL; subsequent identical requests hit the
 * cache (translator not called again).
 */
export async function translateCached(
  redis: RedisLike,
  translator: Translator,
  req: TranslateRequest,
  ttlSeconds: number = TTL_30D,
): Promise<string> {
  const key = translationKey(req);
  const hit = await redis.get(key);
  if (hit != null) return hit;
  const out = await translator.translate(req);
  // Atomic set+TTL: the key can never exist without a <=30d expiry (compliance).
  await redis.set(key, out, { expiration: ttlSeconds });
  return out;
}
