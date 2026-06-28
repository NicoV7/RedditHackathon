/**
 * Redis abstraction (C6). The real Devvit Redis satisfies `RedisLike`; tests use
 * `FakeRedis` (in-memory). Compliance: EVERY key class carries a ≤30-day TTL
 * (CLAUDE.md). Repos must call `expire` on every write; FakeRedis tracks it so
 * tests can assert the discipline.
 */
export const TTL_30D = 30 * 24 * 60 * 60; // seconds — the compliance ceiling

export interface ZMember {
  member: string;
  score: number;
}

export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** Set a value, optionally with an atomic TTL (seconds) so a key can never exist
   *  without an expiry — the Devvit adapter maps `{ expiration }` to its set option. */
  set(key: string, value: string, opts?: { expiration?: number }): Promise<void>;
  incrBy(key: string, by: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  zAdd(key: string, member: string, score: number): Promise<void>;
  zIncrBy(key: string, member: string, by: number): Promise<number>;
  /**
   * Remove a single member from a sorted set (no-op if absent/missing). Needed by
   * the deletion purge to drop a player's leaderboard membership from the SHARED
   * `lb:{caseId}` set without touching other players' scores. The real Devvit
   * Redis adapter MUST map this to its `zRem`.
   */
  zRem(key: string, member: string): Promise<void>;
  zScore(key: string, member: string): Promise<number | null>;
  zRevRange(key: string, start: number, stop: number): Promise<ZMember[]>;
  zRevRank(key: string, member: string): Promise<number | null>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>; // seconds; -1 = no ttl, -2 = missing
}

export class FakeRedis implements RedisLike {
  private str = new Map<string, string>();
  private hash = new Map<string, Map<string, string>>();
  private zset = new Map<string, Map<string, number>>();
  private ttls = new Map<string, number>();

  private touch(key: string): void {
    if (!this.exists(key)) this.ttls.delete(key);
  }
  private exists(key: string): boolean {
    return this.str.has(key) || this.hash.has(key) || this.zset.has(key);
  }

  async get(key: string) {
    return this.str.get(key) ?? null;
  }
  async set(key: string, value: string, opts?: { expiration?: number }) {
    this.str.set(key, value);
    if (opts?.expiration != null) this.ttls.set(key, opts.expiration); // atomic TTL
  }
  async incrBy(key: string, by: number) {
    const v = (Number(this.str.get(key) ?? "0") || 0) + by;
    this.str.set(key, String(v));
    return v;
  }
  async hGet(key: string, field: string) {
    return this.hash.get(key)?.get(field) ?? null;
  }
  async hSet(key: string, field: string, value: string) {
    const h = this.hash.get(key) ?? new Map();
    h.set(field, value);
    this.hash.set(key, h);
  }
  async hIncrBy(key: string, field: string, by: number) {
    const h = this.hash.get(key) ?? new Map();
    const v = (Number(h.get(field) ?? "0") || 0) + by;
    h.set(field, String(v));
    this.hash.set(key, h);
    return v;
  }
  async hGetAll(key: string) {
    return Object.fromEntries(this.hash.get(key) ?? new Map());
  }
  async zAdd(key: string, member: string, score: number) {
    const z = this.zset.get(key) ?? new Map();
    z.set(member, score);
    this.zset.set(key, z);
  }
  async zIncrBy(key: string, member: string, by: number) {
    const z = this.zset.get(key) ?? new Map();
    const v = (z.get(member) ?? 0) + by;
    z.set(member, v);
    this.zset.set(key, z);
    return v;
  }
  async zRem(key: string, member: string) {
    const z = this.zset.get(key);
    if (!z) return;
    z.delete(member);
    if (z.size === 0) {
      this.zset.delete(key);
      this.touch(key); // drop a now-empty set's TTL bookkeeping
    }
  }
  async zScore(key: string, member: string) {
    return this.zset.get(key)?.get(member) ?? null;
  }
  private sorted(key: string): ZMember[] {
    return [...(this.zset.get(key) ?? new Map())]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score || a.member.localeCompare(b.member));
  }
  async zRevRange(key: string, start: number, stop: number) {
    const all = this.sorted(key);
    const end = stop < 0 ? all.length + stop + 1 : stop + 1;
    return all.slice(start, end);
  }
  async zRevRank(key: string, member: string) {
    const i = this.sorted(key).findIndex((m) => m.member === member);
    return i < 0 ? null : i;
  }
  async expire(key: string, seconds: number) {
    this.touch(key);
    if (this.exists(key)) this.ttls.set(key, seconds);
  }
  async ttl(key: string) {
    if (!this.exists(key)) return -2;
    return this.ttls.get(key) ?? -1;
  }
}
