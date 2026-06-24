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
  set(key: string, value: string): Promise<void>;
  incrBy(key: string, by: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hIncrBy(key: string, field: string, by: number): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  zAdd(key: string, member: string, score: number): Promise<void>;
  zIncrBy(key: string, member: string, by: number): Promise<number>;
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
  async set(key: string, value: string) {
    this.str.set(key, value);
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
