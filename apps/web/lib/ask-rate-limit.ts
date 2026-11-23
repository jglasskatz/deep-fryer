/**
 * Bounded in-memory sliding-window rate limiter for `POST /api/portraits/[tenant]/ask`.
 *
 * Keys are capped at `maxEntries` (oldest buckets evicted first, mirroring
 * `lib/ttl-cache.ts`), so high-cardinality traffic can never grow the heap
 * without bound.
 */

export const ASK_RATE_LIMIT_MAX_REQUESTS = 20;
export const ASK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
export const ASK_RATE_LIMIT_MAX_KEYS = 2_000;

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class BoundedRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  check(key: string, now: number = Date.now()): RateLimitVerdict {
    const cutoff = now - this.windowMs;
    const prev = this.buckets.get(key) ?? [];
    const recent = prev.filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      // Refresh LRU position while keeping the bucket intact.
      this.buckets.delete(key);
      this.buckets.set(key, recent);
      const oldestInWindow = recent[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + this.windowMs - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    recent.push(now);
    this.buckets.delete(key);
    if (this.buckets.size >= this.maxKeys) {
      for (const [oldestKey, timestamps] of this.buckets) {
        const active = timestamps.filter((ts) => ts > cutoff);
        if (active.length === 0 || this.buckets.size >= this.maxKeys) {
          this.buckets.delete(oldestKey);
        }
        if (this.buckets.size < this.maxKeys) break;
      }
    }
    this.buckets.set(key, recent);

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - recent.length),
      retryAfterSec: 0,
    };
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

export const askPortraitLimiter = new BoundedRateLimiter(
  ASK_RATE_LIMIT_MAX_REQUESTS,
  ASK_RATE_LIMIT_WINDOW_MS,
  ASK_RATE_LIMIT_MAX_KEYS,
);
