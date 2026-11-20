import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Where a message is delivered is decided by the envelope nodemailer builds
 * from `to`, through its address parser. These are address spellings that a
 * standards-conformant reader takes as one mailbox at the intended domain but
 * that nodemailer before 10.1.4 read as a different recipient (published
 * advisories GHSA-85x2-q946-cp5h, GHSA-8c8m-p3m8-cjg8 and
 * GHSA-m943-m63m-w62w). Each one goes through sendEmail with a transport
 * that records the envelope, and only the intended recipient may appear.
 *
 * The app's own address checks (app/login/sign-in.ts, lib/invitations.ts)
 * already refuse these spellings before they reach sendEmail; this test
 * covers the mail call itself, so the parser is not trusted on their word.
 */

const recorded = vi.hoisted(() => ({ envelopes: [] as { from: string; to: string[] }[] }));

vi.mock('nodemailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nodemailer')>();
  // The real Mailer (and so the real address parser), with a transport that
  // keeps the envelope instead of opening an SMTP connection.
  const createTransport = () =>
    actual.createTransport({
      name: 'envelope-recorder',
      version: '1',
      send(mail: { message: { getEnvelope(): { from: string; to: string[] } } }, done: (err: Error | null, info: unknown) => void) {
        const envelope = mail.message.getEnvelope();
        recorded.envelopes.push(envelope);
        done(null, { envelope, messageId: '<recorded@test>' });
      },
    } as never);
  return { ...actual, default: { ...actual, createTransport }, createTransport };
});

const { sendEmail } = await import('./email');

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

const forms = [
  { advisory: 'GHSA-85x2-q946-cp5h', to: '<"a@evil.com>"@good.com>', domain: 'good.com' },
  { advisory: 'GHSA-8c8m-p3m8-cjg8', to: 'Victim (x(y) <evil@evil.com>) <v@victim.com>', domain: 'victim.com', exact: 'v@victim.com' },
  { advisory: 'GHSA-m943-m63m-w62w', to: 'G: (a; <evil@evil.com>) <v@victim.com>;', domain: 'victim.com', exact: 'v@victim.com' },
  { advisory: 'GHSA-m943-m63m-w62w', to: 'G: "a;" "<evil@evil.com>" <v@victim.com>;', domain: 'victim.com', exact: 'v@victim.com' },
];

describe('sendEmail recipients', () => {
  const saved = { SMTP_URL: process.env.SMTP_URL, EMAIL_FROM: process.env.EMAIL_FROM };

  beforeAll(() => {
    process.env.SMTP_URL = 'smtp://127.0.0.1:1';
    process.env.EMAIL_FROM = 'deep-fryer <no-reply@example.gov>';
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each(forms)('delivers $to only to its intended mailbox ($advisory)', async ({ to, domain, exact }) => {
    recorded.envelopes.length = 0;
    await sendEmail({ to, subject: 'Sign in', text: 'link' });

    expect(recorded.envelopes).toHaveLength(1);
    const recipients = recorded.envelopes[0]!.to;
    expect(recipients).toHaveLength(1);
    expect(recipients.map(domainOf)).toEqual([domain]);
    if (exact) expect(recipients).toEqual([exact]);
    expect(domainOf(recorded.envelopes[0]!.from)).toBe('example.gov');
  });
});
