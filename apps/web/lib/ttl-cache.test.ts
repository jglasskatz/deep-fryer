import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('answers until an entry expires, then forgets it', () => {
    const cache = new TtlCache<boolean>(1_000, 10);
    cache.set('tenant:nyc', true, 0);
    expect(cache.get('tenant:nyc', 999)).toBe(true);
    expect(cache.get('tenant:nyc', 1_000)).toBeUndefined();
    expect(cache.size).toBe(0);
    // A cached `false` is an answer, not a miss.
    cache.set('tenant:ithaca', false, 0);
    expect(cache.get('tenant:ithaca', 1)).toBe(false);
  });

  it('never holds more than its cap, however many keys arrive, dropping the oldest first', () => {
    const cache = new TtlCache<number>(60_000, 3);
    for (let i = 0; i < 1_000; i++) cache.set(`tenant:made-up-${i}`, i, i);
    expect(cache.size).toBe(3);
    expect(cache.get('tenant:made-up-996', 1_000)).toBeUndefined();
    expect([997, 998, 999].map((i) => cache.get(`tenant:made-up-${i}`, 1_000))).toEqual([997, 998, 999]);
  });

  it('treats a refreshed key as the newest, and drops expired entries on the way even below the cap', () => {
    const cache = new TtlCache<string>(100, 3);
    cache.set('a', 'a1', 0);
    cache.set('b', 'b1', 50);
    cache.set('a', 'a2', 60);
    // 'b' is now the oldest, so the cap takes it, not the refreshed 'a'.
    cache.set('c', 'c1', 70);
    cache.set('d', 'd1', 80);
    expect(cache.get('b', 80)).toBeUndefined();
    expect(cache.get('a', 80)).toBe('a2');

    const roomy = new TtlCache<string>(100, 10);
    roomy.set('a', 'a1', 0);
    roomy.set('b', 'b1', 50);
    // At 120 'a' has expired and goes, though there is room; 'b' has not.
    roomy.set('c', 'c1', 120);
    expect(roomy.size).toBe(2);
    expect(roomy.get('b', 120)).toBe('b1');
  });
});
