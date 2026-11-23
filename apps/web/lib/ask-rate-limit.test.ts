import { describe, expect, it } from 'vitest';
import { BoundedRateLimiter } from './ask-rate-limit';

describe('BoundedRateLimiter', () => {
  it('enforces per-key sliding window limits and resets after window expiry', () => {
    const limiter = new BoundedRateLimiter(2, 10_000, 10);
    expect(limiter.check('ip:1', 1_000)).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
    expect(limiter.check('ip:1', 2_000)).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
    const blocked = limiter.check('ip:1', 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(8);

    // After first request leaves window (t=11_001), request is allowed again.
    expect(limiter.check('ip:1', 11_001).allowed).toBe(true);
  });

  it('caps tracked keys at maxKeys to prevent unbounded memory growth', () => {
    const limiter = new BoundedRateLimiter(5, 60_000, 3);
    limiter.check('k1', 1_000);
    limiter.check('k2', 2_000);
    limiter.check('k3', 3_000);
    limiter.check('k4', 4_000);
    expect(limiter.size).toBe(3);
  });
});
