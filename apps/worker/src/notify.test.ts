import { describe, expect, it } from 'vitest';
import { composeRunEmail, type RunSummary } from './notify.js';
import { startSmtpSink } from './test/smtp-sink.js';

const base: RunSummary = {
  tenantName: 'The Bronx',
  tenantSlug: 'bronx',
  runId: 'run-1',
  status: 'complete',
  funding: 'plan',
  sessions: 22,
  failedSessions: 0,
  findings: 30,
  flagged: 4,
  gaps: 3,
};
const all = { email_on_run_complete: true, email_on_flagged_finding: true };

describe('composeRunEmail', () => {
  it('summarizes a completed run with a review link and the human gate', () => {
    const e = composeRunEmail(base, all, 'https://app.example.gov/')!;
    expect(e.subject).toBe('Research run complete — The Bronx: 30 findings, 4 flagged');
    expect(e.text).toContain('https://app.example.gov/bronx/admin/review?run=run-1');
    expect(e.text).toContain('Nothing is public until a reviewer approves');
  });

  it('sends only flags when run-complete mail is off, and nothing when there are none', () => {
    const flagsOnly = { email_on_run_complete: false, email_on_flagged_finding: true };
    expect(composeRunEmail(base, flagsOnly, 'https://x')!.subject).toBe('4 flagged findings to review — The Bronx');
    expect(composeRunEmail({ ...base, flagged: 0 }, flagsOnly, 'https://x')).toBeNull();
    expect(composeRunEmail(base, { email_on_run_complete: false, email_on_flagged_finding: false }, 'https://x')).toBeNull();
  });

  it('reports failures without blaming the customer', () => {
    const e = composeRunEmail({ ...base, status: 'failed', failedSessions: 5 }, all, 'https://x')!;
    expect(e.subject).toBe('Research run failed — The Bronx');
    expect(e.text).toContain('Failed sessions are not counted against your plan');
    expect(e.text).toContain('Findings recorded before the failure');
  });

  it('points at configuration when a failed run recorded nothing', () => {
    const e = composeRunEmail({ ...base, status: 'failed', findings: 0, failedSessions: 7, sessions: 7 }, all, 'https://x')!;
    expect(e.text).toContain('7 of 7 sessions did not complete');
    expect(e.text).toContain('No findings were recorded');
    expect(e.text).not.toContain('Findings recorded before the failure');
  });

  it('points at the organization’s own key, not an administrator, when the run used it', () => {
    const nothing = composeRunEmail({ ...base, funding: 'organization_key', status: 'failed', findings: 0, failedSessions: 7, sessions: 7 }, all, 'https://x')!;
    expect(nothing.text).toContain("This run used your organization's own Anthropic API key, so none of it is counted against your plan.");
    expect(nothing.text).toContain('check that key first');
    expect(nothing.text).toContain('an organization owner can replace the key under Billing');
    // The administrator comes in only for the one reason that can be the
    // service's own setting (a model id the API did not find), and only after the key.
    expect(nothing.text).toContain("If the transcript says the model setting may be wrong instead, pass it on to your administrator.");
    expect(nothing.text.indexOf('administrator')).toBeGreaterThan(nothing.text.indexOf('check that key first'));
    expect(nothing.text).not.toMatch(/ask your administrator to check the research service configuration/);

    const some = composeRunEmail({ ...base, funding: 'organization_key', status: 'failed', failedSessions: 3 }, all, 'https://x')!;
    expect(some.text).toContain('Findings recorded before the failure (30) are in the review queue.');
    expect(some.text).toContain("each failed session's transcript says why");
    expect(some.text).not.toMatch(/administrator/);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('notifyRunFinished (Postgres + SMTP)', () => {
  it('emails portrait owners/editors and org owners — not viewers — one message each', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { notifyRunFinished } = await import('./notify.js');
    const db = m.getDb();
    const sink = await startSmtpSink();
    process.env.SMTP_URL = `smtp://127.0.0.1:${sink.port}`;
    process.env.EMAIL_FROM = 'deep-fryer <no-reply@example.gov>';
    process.env.APP_URL = 'https://app.example.gov';

    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Notify City' });
    const mk = async (email: string) => (await db.insert(m.users).values({ email }).returning())[0]!;
    const [owner, editor, viewer, orgOwner] = await Promise.all([
      mk(`${uniq()}@owner.gov`), mk(`${uniq()}@editor.gov`), mk(`${uniq()}@viewer.gov`), mk(`${uniq()}@org.gov`),
    ]);
    await db.insert(m.tenantMembers).values([
      { tenantId: tenant.id, userId: owner.id, role: 'owner' },
      { tenantId: tenant.id, userId: editor.id, role: 'editor' },
      { tenantId: tenant.id, userId: viewer.id, role: 'viewer' },
    ]);
    await db.insert(m.organizationMembers).values({ organizationId: tenant.organizationId, userId: orgOwner.id, role: 'owner' });

    const [run] = await db.insert(m.researchRuns).values({
      tenantId: tenant.id, status: 'complete', plan: { sessions: [], config_hash: 'h', plugin_version: 'v' }, configSnapshot: {} as never,
    }).returning();
    const [session] = await db.insert(m.researchSessions).values({ runId: run!.id, kind: 'dimension', status: 'complete' }).returning();
    const dimId = (await db.select().from(m.dimensions).where(eq(m.dimensions.tenantId, tenant.id)))[0]!.id;
    const ok = { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' as const };
    await db.insert(m.findings).values([
      { sessionId: session!.id, dimensionId: dimId, indicatorSlug: 'a', payload: { kind: 'indicator' } as never, verification: ok },
      { sessionId: session!.id, dimensionId: dimId, indicatorSlug: 'b', payload: { kind: 'indicator' } as never, verification: { ...ok, content_supported: 'uncertain' } },
      { sessionId: session!.id, dimensionId: dimId, indicatorSlug: 'c', payload: { kind: 'gap' } as never, verification: { ...ok, content_supported: 'uncertain' } },
    ]);

    await notifyRunFinished(run!.id);
    await sink.close();

    const recipients = sink.mails.flatMap((x) => x.to).sort();
    expect(recipients).toEqual([owner.email, editor.email, orgOwner.email].map((e) => e!.toLowerCase()).sort());
    expect(sink.mails.every((x) => x.to.length === 1)).toBe(true);
    // Subject is RFC 2047-encoded (it carries an em dash); the body is plain.
    const raw = sink.mails[0]!.data.replace(/=\r?\n/g, '');
    expect(raw).toMatch(/Subject: =\?UTF-8\?Q\?Research_run_complete/);
    expect(raw).toContain('3 findings (1 documented data gap)');
    expect(raw).toContain('1 finding flagged by verification');

    // Findings are immutable (no cleanup); the test rows live in a throwaway tenant.
    for (const k of ['SMTP_URL', 'EMAIL_FROM', 'APP_URL']) delete process.env[k];
  });
});
