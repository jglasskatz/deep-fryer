import { afterAll, describe, expect, it } from 'vitest';
import { addressHash } from './client-address';
import {
  MAX_OUTSTANDING_LINKS,
  PRUNE_AFTER_MS,
  SIGN_IN_EMAIL_WINDOW_MS,
  SIGN_IN_EMAILS_PER_ADDRESS,
  signInAddressHash,
  signInEmailRefusal,
} from './sign-in-limit';

/**
 * The limits on sign-in emails, against the dev database: at most ten an
 * hour from one network address however the requests arrive (one by one or
 * all at once), other networks unaffected, at most three outstanding links
 * per inbox without spending the network's allowance, and old rows swept
 * now and then.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

describe('signInAddressHash', () => {
  it('is stable, 32 hex characters, never the address, and not the involvement form’s hash of it', () => {
    const h = signInAddressHash('203.0.113.7');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(signInAddressHash(' 203.0.113.7 ')).toBe(h);
    expect(signInAddressHash('2001:DB8::1')).toBe(signInAddressHash('2001:db8::1'));
    expect(h).not.toContain('203.0.113.7');
    expect(h).not.toBe(addressHash('203.0.113.7'));
  });
});

describe.skipIf(!hasDb)('signInEmailRefusal', () => {
  const addresses: string[] = [];
  const emails: string[] = [];
  /** A network address of its own for one test (documentation range, random suffix). */
  const network = () => {
    const a = `2001:db8::${uniq()}`;
    addresses.push(a);
    return a;
  };
  const inbox = () => {
    const e = `sign-in-${uniq()}@limit.example.org`;
    emails.push(e);
    return e;
  };
  /** Never prunes, so a test sees only its own rows change. */
  const noPrune = () => 1;

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (addresses.length) {
      await db.delete(m.signInRequests).where(inArray(m.signInRequests.ipHash, addresses.map(signInAddressHash)));
    }
    if (emails.length) await db.delete(m.verificationTokens).where(inArray(m.verificationTokens.identifier, emails));
  });

  async function recorded(address: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return m.getDb().select().from(m.signInRequests).where(eq(m.signInRequests.ipHash, signInAddressHash(address)));
  }

  it('sends at most ten sign-in emails an hour from one network, records nothing it refuses, and leaves other networks alone', async () => {
    expect(SIGN_IN_EMAILS_PER_ADDRESS).toBe(10);
    const office = network();
    const elsewhere = network();
    const t0 = new Date(Date.now() - 3 * SIGN_IN_EMAIL_WINDOW_MS);
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    for (let i = 0; i < SIGN_IN_EMAILS_PER_ADDRESS; i++) {
      expect(await signInEmailRefusal({ email: inbox(), address: office, now: at(i), random: noPrune })).toBeNull();
    }
    expect(await signInEmailRefusal({ email: inbox(), address: office, now: at(30), random: noPrune })).toBe('TooManyEmails');
    expect(await signInEmailRefusal({ email: inbox(), address: office, now: at(59), random: noPrune })).toBe('TooManyEmails');
    expect(await recorded(office)).toHaveLength(SIGN_IN_EMAILS_PER_ADDRESS);

    // Another network has its own allowance.
    expect(await signInEmailRefusal({ email: inbox(), address: elsewhere, now: at(30), random: noPrune })).toBeNull();
    expect(await recorded(elsewhere)).toHaveLength(1);

    // An hour after the first email it has left the window: one more goes.
    expect(await signInEmailRefusal({ email: inbox(), address: office, now: at(60.5), random: noPrune })).toBeNull();
    expect(await signInEmailRefusal({ email: inbox(), address: office, now: at(60.6), random: noPrune })).toBe('TooManyEmails');
  });

  it('holds the limit when a burst of requests from one network arrives at once', async () => {
    const office = network();
    const elsewhere = network();
    // One request from another network arrives in the middle of the burst.
    const [fromElsewhere, ...burst] = await Promise.all([
      signInEmailRefusal({ email: inbox(), address: elsewhere, random: noPrune }),
      ...Array.from({ length: 25 }, () => signInEmailRefusal({ email: inbox(), address: office, random: noPrune })),
    ]);
    expect(burst.filter((r) => r === null)).toHaveLength(SIGN_IN_EMAILS_PER_ADDRESS);
    expect(burst.filter((r) => r === 'TooManyEmails')).toHaveLength(25 - SIGN_IN_EMAILS_PER_ADDRESS);
    expect(await recorded(office)).toHaveLength(SIGN_IN_EMAILS_PER_ADDRESS);
    expect(fromElsewhere).toBeNull();
    expect(await recorded(elsewhere)).toHaveLength(1);
  });

  it('refuses a fourth outstanding link to one inbox, without spending the network’s allowance', async () => {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const now = new Date();
    const later = new Date(now.getTime() + 10 * 60_000);
    const earlier = new Date(now.getTime() - 60_000);
    const full = inbox();
    const stale = inbox();
    await db.insert(m.verificationTokens).values([
      ...Array.from({ length: MAX_OUTSTANDING_LINKS }, (_, i) => ({ identifier: full, token: `live-${i}-${uniq()}`, expires: later })),
      // Expired links are not outstanding.
      ...Array.from({ length: MAX_OUTSTANDING_LINKS }, (_, i) => ({ identifier: stale, token: `old-${i}-${uniq()}`, expires: earlier })),
    ]);
    const home = network();
    expect(await signInEmailRefusal({ email: full, address: home, now, random: noPrune })).toBe('TooManyLinks');
    expect(await recorded(home)).toHaveLength(0);
    expect(await signInEmailRefusal({ email: stale, address: home, now, random: noPrune })).toBeNull();
    expect(await recorded(home)).toHaveLength(1);
  });

  it('sweeps rows outside the limit’s window now and then, and only those', async () => {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const now = new Date();
    const gone = network();
    const recent = network();
    const insertAt = (address: string, ageMs: number) =>
      db.insert(m.signInRequests).values({ ipHash: signInAddressHash(address), createdAt: new Date(now.getTime() - ageMs) });
    await insertAt(gone, PRUNE_AFTER_MS + 60_000);
    await insertAt(recent, PRUNE_AFTER_MS - 60_000);

    // A draw that does not sweep leaves other addresses' old rows alone.
    expect(await signInEmailRefusal({ email: inbox(), address: network(), now, random: () => 0.5 })).toBeNull();
    expect(await recorded(gone)).toHaveLength(1);

    // One that does removes what is past the window, and keeps what is not.
    expect(PRUNE_AFTER_MS).toBe(SIGN_IN_EMAIL_WINDOW_MS);
    expect(await signInEmailRefusal({ email: inbox(), address: network(), now, random: () => 0 })).toBeNull();
    expect(await recorded(gone)).toHaveLength(0);
    expect(await recorded(recent)).toHaveLength(1);
  });
});
