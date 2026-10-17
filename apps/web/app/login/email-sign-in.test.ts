import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The email sign-in flow through the real Auth.js configuration (auth.ts),
 * against the dev database: the route Auth.js serves at
 * /api/auth/signin/nodemailer — the one a script would call directly, past
 * the sign-in form — sends the email the form would, and refuses with the
 * sign-in page's reason once a limit of lib/sign-in-limit.ts is reached,
 * before any email or token — and the sign-in form's server action, which
 * calls next-auth's signIn() in process, lands on the same answers.
 *
 * next/headers is the request the callback reads the network address from;
 * outside Next there is no request, so it is stubbed with the address the
 * test is "calling from". Without SMTP outside production, lib/email prints
 * the message to the log, which the test reads.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const ORIGIN = 'http://localhost:3000';
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

let callingFrom = '198.51.100.1';
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  headers: async () => new Headers({ 'x-forwarded-for': callingFrom }),
  // next-auth's signIn() (the sign-in form's path) copies Auth.js's cookies
  // into the response; an email request sets none that matter here.
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

describe.skipIf(!hasDb)('email sign-in through Auth.js', () => {
  const saved = { AUTH_SECRET: process.env.AUTH_SECRET, AUTH_URL: process.env.AUTH_URL, SMTP_URL: process.env.SMTP_URL };
  const addresses: string[] = [];
  const emails: string[] = [];
  const network = () => {
    const a = `2001:db8:5::${uniq()}`;
    addresses.push(a);
    return a;
  };
  const inbox = () => {
    const e = `flow-${uniq()}@limit.example.org`;
    emails.push(e);
    return e;
  };

  beforeAll(() => {
    process.env.AUTH_SECRET = 'email-sign-in-test-secret';
    process.env.AUTH_URL = ORIGIN;
    delete process.env.SMTP_URL;
  });
  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { inArray } = await import('drizzle-orm');
    const { signInAddressHash } = await import('@/lib/sign-in-limit');
    const db = m.getDb();
    if (addresses.length) {
      await db.delete(m.signInRequests).where(inArray(m.signInRequests.ipHash, addresses.map(signInAddressHash)));
    }
    if (emails.length) await db.delete(m.verificationTokens).where(inArray(m.verificationTokens.identifier, emails));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Ask Auth.js for a link the way a browser or script would: CSRF token first, then the form post. */
  async function requestLink(email: string, callbackUrl: string) {
    const { handlers } = await import('@/auth');
    const csrf = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const res = await handlers.POST(
        new NextRequest(`${ORIGIN}/api/auth/signin/nodemailer`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
          body: new URLSearchParams({ email, csrfToken, callbackUrl }),
        }),
      );
      const mail = log.mock.calls.map((args) => String(args[0])).find((line) => line.startsWith('[dev mail]'));
      const location = new URL(res.headers.get('location') ?? '', ORIGIN);
      // Sent: Auth.js's own verify-request hop (which forwards to /login/check-email).
      const sent = location.pathname === '/api/auth/verify-request' && !location.searchParams.has('error');
      return { location, sent, mail };
    } finally {
      log.mockRestore();
    }
  }

  it('sends a link that names the product and, from /start, its purpose', async () => {
    callingFrom = network();
    const email = inbox();
    const { sent, mail } = await requestLink(email, '/start?portrait=gotham');
    expect(sent).toBe(true);
    expect(mail).toContain(`to=${email}`);
    expect(mail).toContain('subject="Sign in to deep-fryer to set up your city’s doughnut"');
    expect(mail).not.toMatch(/subject="[^"]*localhost/);

    const plain = await requestLink(inbox(), '/nyc/dim/housing');
    expect(plain.mail).toContain('subject="Sign in to deep-fryer"');
  });

  it('sends ten emails an hour from one network, then refuses on the sign-in page without sending', async () => {
    callingFrom = network();
    for (let i = 0; i < 10; i++) {
      const { sent, mail } = await requestLink(inbox(), '/nyc');
      expect(sent, `request ${i + 1}`).toBe(true);
      expect(mail).toBeDefined();
    }
    const refused = await requestLink(inbox(), '/nyc');
    expect(`${refused.location.pathname}${refused.location.search}`).toBe('/login?error=TooManyEmails');
    expect(refused.mail).toBeUndefined();

    // Another network is unaffected.
    callingFrom = network();
    expect((await requestLink(inbox(), '/nyc')).sent).toBe(true);
  });

  it('gives the sign-in form the same answers, with its next kept (the page’s emailLink action)', async () => {
    const { signIn } = await import('@/auth');
    const { afterEmailSignIn } = await import('./sign-in');
    callingFrom = network();
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const viaForm = async () =>
        afterEmailSignIn(String(await signIn('nodemailer', { email: inbox(), redirectTo: '/start', redirect: false })), '/start');
      for (let i = 0; i < 10; i++) expect(await viaForm()).toBe('/login/check-email?next=%2Fstart');
      expect(await viaForm()).toBe('/login?error=TooManyEmails&next=%2Fstart');
    } finally {
      log.mockRestore();
    }
  });

  it('keeps at most three outstanding links per inbox, and makes no token for a refused one', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    callingFrom = network();
    const email = inbox();
    for (let i = 0; i < 3; i++) expect((await requestLink(email, '/nyc')).sent).toBe(true);
    const refused = await requestLink(email, '/nyc');
    expect(`${refused.location.pathname}${refused.location.search}`).toBe('/login?error=TooManyLinks');
    expect(refused.mail).toBeUndefined();
    const tokens = await m.getDb().select().from(m.verificationTokens).where(eq(m.verificationTokens.identifier, email));
    expect(tokens).toHaveLength(3);
  });
});
