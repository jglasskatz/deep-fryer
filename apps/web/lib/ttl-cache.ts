/**
 * A small time-limited cache with a hard cap on its size, for the lookups
 * middleware makes on every request (lib/translation-policy.ts,
 * lib/embed-policy.ts).
 *
 * Those caches are keyed by part of the request path, which anyone can choose:
 * an unbounded Map grows by one entry per new path for as long as the process
 * lives, so a client looping over random paths could fill the heap until the
 * process is killed. Here an entry lasts `ttlMs`, and once `maxEntries` are
 * held the oldest go first.
 *
 * Every entry lives for the same `ttlMs`, and `set` always re-inserts at the
 * end, so the Map's insertion order is also the order entries were written
 * in: the oldest — and so any that have expired — are always at the front,
 * and eviction never has to scan past what it removes.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  /** The cached value, or undefined when there is none or it has expired. */
  get(key: string, now: number = Date.now()): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, now: number = Date.now()): void {
    // Deleting first moves a refreshed key to the end, keeping the order above.
    this.entries.delete(key);
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size < this.maxEntries && now - entry.at < this.ttlMs) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, at: now });
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
