import { afterAll, describe, expect, it } from 'vitest';

/**
 * The sign-in request ledger (migration 0016) and its limit: requests from
 * one address are admitted up to the limit within the window and refused
 * after, a burst of parallel requests cannot slip extra emails past the
 * count, and the table is system-only — the app role can neither read nor
 * write it.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniqHash = () => `test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(!hasDb)('sign-in requests', () => {
  const hashes: string[] = [];
  const hash = () => {
    const h = uniqHash();
    hashes.push(h);
    return h;
  };
  afterAll(async () => {
    const m = await import('./index.js');
    const { inArray } = await import('drizzle-orm');
    if (hashes.length) await m.getDb().delete(m.signInRequests).where(inArray(m.signInRequests.ipHash, hashes));
  });

  it('admits an address up to the limit within the window, records only what it admits, and admits it again once the window has passed', async () => {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const ipHash = hash();
    const other = hash();
    const t0 = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    const limit = { limit: 3, windowMs: 60 * 60_000 };
    const rows = async (h: string) => db.select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, h));

    expect(await m.admitSignInRequest(db, { ipHash, ...limit, now: at(0) })).toEqual({ admitted: true, recent: 1 });
    expect(await m.admitSignInRequest(db, { ipHash, ...limit, now: at(10) })).toEqual({ admitted: true, recent: 2 });
    expect(await m.admitSignInRequest(db, { ipHash, ...limit, now: at(20) })).toEqual({ admitted: true, recent: 3 });
    expect(await m.admitSignInRequest(db, { ipHash, ...limit, now: at(30) })).toEqual({ admitted: false, recent: 3 });
    expect(await rows(ipHash)).toHaveLength(3);
    // Another address has its own count.
    expect(await m.admitSignInRequest(db, { ipHash: other, ...limit, now: at(30) })).toEqual({ admitted: true, recent: 1 });

    // An hour after the first request it has left the window: one more is
    // admitted, and the expired row is gone.
    expect(await m.admitSignInRequest(db, { ipHash, ...limit, now: at(61) })).toEqual({ admitted: true, recent: 3 });
    const kept = await rows(ipHash);
    expect(kept.map((r) => r.createdAt.getTime()).sort()).toEqual([at(10), at(20), at(61)].map((d) => d.getTime()));
  });

  it('lets no more than the limit through when requests from one address arrive at once', async () => {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const ipHash = hash();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => m.admitSignInRequest(db, { ipHash, limit: 3, windowMs: 60 * 60_000 })),
    );
    expect(results.filter((r) => r.admitted)).toHaveLength(3);
    expect(await db.select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, ipHash))).toHaveLength(3);
  });

  it('prunes only rows older than the cutoff', async () => {
    const m = await import('./index.js');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    const old = hash();
    const fresh = hash();
    const cutoff = new Date(Date.UTC(2026, 9, 1));
    await db.insert(m.signInRequests).values([
      { ipHash: old, createdAt: new Date(cutoff.getTime() - 1_000) },
      { ipHash: fresh, createdAt: new Date(cutoff.getTime() + 1_000) },
    ]);
    expect(await m.pruneSignInRequests(db, cutoff)).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, old))).toHaveLength(0);
    expect(await db.select().from(m.signInRequests).where(inArray(m.signInRequests.ipHash, [fresh]))).toHaveLength(1);
  });

  it('sweeps what the sign-in path no longer needs: requests outside the window, and expired links with their addresses', async () => {
    const m = await import('./index.js');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    const now = new Date();
    const minutes = (n: number) => new Date(now.getTime() + n * 60_000);
    const gone = hash();
    const kept = hash();
    await db.insert(m.signInRequests).values([
      { ipHash: gone, createdAt: new Date(now.getTime() - m.SIGN_IN_EMAIL_WINDOW_MS - 60_000) },
      { ipHash: kept, createdAt: new Date(now.getTime() - m.SIGN_IN_EMAIL_WINDOW_MS + 60_000) },
    ]);
    // An unused link that expired a minute ago, and one still usable: Auth.js deletes a row only when its link is used.
    const expired = `${uniqHash()}@stranger.example.gov`;
    const live = `${uniqHash()}@example.gov`;
    await db.insert(m.verificationTokens).values([
      { identifier: expired, token: uniqHash(), expires: minutes(-1) },
      { identifier: live, token: uniqHash(), expires: minutes(10) },
    ]);
    try {
      const swept = await m.pruneExpiredSignInRecords(db, now);
      expect(swept.signInRequests).toBeGreaterThanOrEqual(1);
      expect(swept.verificationTokens).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, gone))).toHaveLength(0);
      expect(await db.select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, kept))).toHaveLength(1);
      const tokens = await db
        .select({ identifier: m.verificationTokens.identifier })
        .from(m.verificationTokens)
        .where(inArray(m.verificationTokens.identifier, [expired, live]));
      expect(tokens).toEqual([{ identifier: live }]);
    } finally {
      await db.delete(m.verificationTokens).where(inArray(m.verificationTokens.identifier, [expired, live]));
    }
  });

  it('is out of the app role’s reach entirely', async () => {
    const m = await import('./index.js');
    const db = m.getDb();
    await expect(m.withAuthContext(db, null, (tx) => tx.select().from(m.signInRequests))).rejects.toThrow(/permission denied/);
    await expect(
      m.withAuthContext(db, null, (tx) => tx.insert(m.signInRequests).values({ ipHash: hash() })),
    ).rejects.toThrow(/permission denied/);
    await expect(
      m.withAuthContext(db, null, (tx) => m.admitSignInRequest(tx, { ipHash: hash(), limit: 1, windowMs: 1_000 })),
    ).rejects.toThrow(/permission denied/);
  });
});
