// ════════════════════════════════════════════════════════════
// Redis utility — Upstash REST-based Redis client
//
// Singleton client using UPSTASH_REDIS_REST_URL + TOKEN env vars.
// Provides: locking, rate limiting, caching.
// ════════════════════════════════════════════════════════════

import { Redis } from '@upstash/redis';

// Singleton client
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

/**
 * Acquire a distributed lock.
 * Returns true if lock was acquired, false if already held.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  const lockKey = `lock:${key}`;
  // SET NX with PX expiry — atomic acquire
  const result = await redis.set(lockKey, '1', { nx: true, px: ttlMs });
  return result === 'OK';
}

/**
 * Release a distributed lock.
 */
export async function releaseLock(key: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`lock:${key}`);
}

/**
 * Sliding-window rate limiter.
 * Returns { allowed: boolean, remaining: number, resetMs: number }
 */
export async function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const redis = getRedis();
  const rlKey = `rl:${key}`;
  const now = Date.now();

  // Use a sorted set with timestamps as scores
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(rlKey, 0, now - windowMs); // remove expired
  pipeline.zadd(rlKey, { score: now, member: `${now}:${Math.random()}` }); // add current
  pipeline.zcard(rlKey); // count in window
  pipeline.pexpire(rlKey, windowMs); // auto-cleanup

  const results = await pipeline.exec();
  const count = results[2] as number;

  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetMs: windowMs,
  };
}

/**
 * Get a cached value (parsed from JSON).
 */
export async function getCache<T = unknown>(key: string): Promise<T | null> {
  const redis = getRedis();
  const value = await redis.get<T>(`cache:${key}`);
  return value ?? null;
}

/**
 * Set a cached value with TTL.
 */
export async function setCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  const redis = getRedis();
  await redis.set(`cache:${key}`, value, { px: ttlMs });
}
