import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { send } from './notify.js';
import { startSmtpSink } from './test/smtp-sink.js';

/**
 * Where a message is delivered is decided by the envelope nodemailer builds
 * from each address, through its address parser. These are address spellings
 * that a standards-conformant reader takes as one mailbox at the intended
 * domain but that nodemailer before 10.1.4 read as a different recipient
 * (published advisories GHSA-85x2-q946-cp5h, GHSA-8c8m-p3m8-cjg8 and
 * GHSA-m943-m63m-w62w). Each one goes through the worker's mail path to a
 * local SMTP sink that records the RCPT TO commands, and only the intended
 * recipient may appear.
 *
 * The worker's recipients are stored user addresses (runRecipients), which
 * the sign-in form and the invitation check refuse in these spellings; this
 * test covers the mail call itself. Its own file because send() keeps one
 * transport per module, and notify.test.ts points it at another sink.
 */

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

const forms = [
  { advisory: 'GHSA-85x2-q946-cp5h', to: '<"a@evil.com>"@good.com>', domain: 'good.com' },
  { advisory: 'GHSA-8c8m-p3m8-cjg8', to: 'Victim (x(y) <evil@evil.com>) <v@victim.com>', domain: 'victim.com', exact: 'v@victim.com' },
  { advisory: 'GHSA-m943-m63m-w62w', to: 'G: (a; <evil@evil.com>) <v@victim.com>;', domain: 'victim.com', exact: 'v@victim.com' },
  { advisory: 'GHSA-m943-m63m-w62w', to: 'G: "a;" "<evil@evil.com>" <v@victim.com>;', domain: 'victim.com', exact: 'v@victim.com' },
];

describe('send recipients', () => {
  const saved = { SMTP_URL: process.env.SMTP_URL, EMAIL_FROM: process.env.EMAIL_FROM };
  let sink: Awaited<ReturnType<typeof startSmtpSink>>;

  beforeAll(async () => {
    sink = await startSmtpSink();
    process.env.SMTP_URL = `smtp://127.0.0.1:${sink.port}`;
    process.env.EMAIL_FROM = 'deep-fryer <no-reply@example.gov>';
  });

  afterAll(async () => {
    await sink.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each(forms)('delivers $to only to its intended mailbox ($advisory)', async ({ to, domain, exact }) => {
    sink.mails.length = 0;
    await send([to], { subject: 'Research run complete', text: 'Open the review queue.' });

    expect(sink.mails).toHaveLength(1);
    const recipients = sink.mails[0]!.to;
    expect(recipients).toHaveLength(1);
    expect(recipients.map(domainOf)).toEqual([domain]);
    if (exact) expect(recipients).toEqual([exact]);
  });
});
