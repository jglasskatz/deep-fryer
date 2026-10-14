import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import { composePolicyEmail, type PolicyNotice } from './policy-analyze.js';
import { startSmtpSink } from '../test/smtp-sink.js';

/**
 * The policy-analysis task end to end against Postgres, with the Claude
 * Agent SDK session mocked: what the model answers is the input under test
 * (a valid projection, prose, a schema-invalid result, a dead session), and
 * everything after it — parsing, validation, re-scoring against the
 * published thresholds, settling the row, emailing the requester — is the
 * production code path.
 */
const session = vi.hoisted(() => ({ resultText: '', succeeded: true, calls: 0 }));
vi.mock('../session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session.js')>()),
  runSessionWithRetry: vi.fn(async () => {
    session.calls += 1;
    return {
      resultText: session.resultText,
      succeeded: session.succeeded,
      transcript: Buffer.from('transcript'),
      usage: { input_tokens: 1200, output_tokens: 340 },
    };
  }),
}));

const notice: PolicyNotice = {
  tenantName: 'Manhattan',
  tenantSlug: 'manhattan',
  analysisId: 'a-1',
  title: 'Congestion\npricing',
  status: 'complete',
  error: null,
  impacts: 3,
  quantified: 1,
};

describe('composePolicyEmail', () => {
  it('links the result, labels it a projection, and keeps the subject on one line', () => {
    const e = composePolicyEmail(notice, 'https://app.example.gov/');
    expect(e.subject).toBe('Policy analysis ready — Congestion pricing');
    expect(e.text).toContain('3 projected impacts');
    expect(e.text).toContain('1 quantified against published indicators');
    expect(e.text).toContain('not a measurement');
    expect(e.text).toContain('https://app.example.gov/manhattan/admin/policy/a-1');
  });

  it('explains a failure and that it is not billed', () => {
    const e = composePolicyEmail({ ...notice, status: 'failed', error: 'The session did not complete.' }, 'https://x');
    expect(e.subject).toBe('Policy analysis failed — Congestion pricing');
    expect(e.text).toContain('What happened: The session did not complete.');
    expect(e.text).toContain('not counted against your plan');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const RENT = 'Renter households paying over 30% of income on housing';
const helpers = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
} as unknown as JobHelpers;

describe.skipIf(!hasDb)('policyAnalyze (Postgres, mocked session)', () => {
  let sink: Awaited<ReturnType<typeof startSmtpSink>>;
  const cleanup: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    sink = await startSmtpSink();
    process.env.SMTP_URL = `smtp://127.0.0.1:${sink.port}`;
    process.env.EMAIL_FROM = 'deep-fryer <no-reply@example.gov>';
    process.env.APP_URL = 'https://app.example.gov';
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    await sink.close();
    for (const k of ['SMTP_URL', 'EMAIL_FROM', 'APP_URL']) delete process.env[k];
  });

  /**
   * A portrait with one published dimension (housing) whose indicator
   * carries real scoring — 52% rent-burdened against target 30 / scale 30 —
   * and a queued analysis requested by a staff member with an email.
   */
  async function seed() {
    const m = await import('@deep-fryer/db');
    const core = await import('@deep-fryer/core');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const [requester] = await db.insert(m.users).values({ email: `${uniq()}@staff.gov` }).returning();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Policy City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
      await db.delete(m.users).where(eq(m.users.id, requester!.id));
    });

    const housingId = dimensions.find((d) => d.slug === 'housing')!.dimensionId;
    const { level_pct, scoring } = core.computeScoring(52, 'housing.cost-burdened-renters', {
      function: 'lower_is_better',
      target: 30,
      scale: 30,
      rationale: '',
    });
    const data = {
      name: 'Housing',
      icon: '',
      description: '',
      context: '',
      actions: [],
      indicators: [
        {
          name: RENT,
          value: 52,
          unit: '%',
          year: 2023,
          target: 30,
          level_pct,
          scoring,
          source: 'ACS',
          source_url: 'https://data.census.gov',
          confidence: 'high' as const,
          geographic_scale: 'city' as const,
        },
      ],
    };
    const version = await m.appendDimensionVersion(db, {
      dimensionId: housingId,
      status: 'published',
      data,
      vizLevel: core.deriveVizLevel(data),
      origin: 'import',
      publishedAt: new Date(),
    });
    await db.update(m.dimensions).set({ publishedVersionId: version.id }).where(eq(m.dimensions.id, housingId));

    const [analysis] = await db
      .insert(m.policyAnalyses)
      .values({
        tenantId: tenant.id,
        title: 'Rent stabilization expansion',
        brief: 'Extend rent stabilization to every building with six or more units built before 2010.',
        requestedBy: requester!.id,
      })
      .returning();
    return { tenant, requester: requester!, analysis: analysis! };
  }

  async function run(analysisId: string) {
    const { policyAnalyze } = await import('./policy-analyze.js');
    await policyAnalyze({ analysisId }, helpers);
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.policyAnalyses).where(eq(m.policyAnalyses.id, analysisId));
    return row!;
  }

  function mailTo(address: string) {
    const mail = sink.mails.find((x) => x.to.includes(address.toLowerCase()) || x.to.includes(address));
    return mail ? mail.data.replace(/=\r?\n/g, '') : null;
  }

  it('completes a valid result and re-scores the quantified indicator with the published threshold', async () => {
    const { tenant, requester, analysis } = await seed();
    session.succeeded = true;
    session.resultText = [
      'Here is the analysis.',
      '```json',
      JSON.stringify({
        summary: 'Stabilization slows rent growth for covered units.',
        impacts: [
          {
            dimension_slug: 'housing',
            direction: 'improves',
            magnitude: 'moderate',
            confidence: 'medium',
            rationale: 'Covered units see capped increases, reducing cost burden over time.',
            indicator: RENT,
            projected_value: 46,
            projected_year: 2030,
            sources: [{ title: 'Furman Center', url: 'https://furmancenter.org/research' }],
          },
          {
            dimension_slug: 'energy',
            direction: 'worsens',
            magnitude: 'small',
            confidence: 'low',
            rationale: 'Owners may defer efficiency upgrades.',
            sources: [],
          },
        ],
        assumptions: ['Enforcement keeps pace with coverage.'],
        risks: ['Reduced new construction.'],
      }),
      '```',
    ].join('\n');

    const row = await run(analysis.id);
    expect(row.status).toBe('complete');
    expect(row.error).toBeNull();
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.tokenUsage).toEqual({ input_tokens: 1200, output_tokens: 340 });
    expect(row.transcript?.toString()).toBe('transcript');
    expect(row.result?.impacts).toHaveLength(2);

    const housing = row.projections!.find((p) => p.dimension_slug === 'housing')!;
    // 52% → 46% against target 30 / scale 30: level_pct 73.3 → 53.3.
    expect(housing.current_viz).toBeCloseTo(123.3, 1);
    expect(housing.projected_viz).toBeCloseTo(103.3, 1);
    expect(housing.indicator_changes).toEqual([
      { indicator: RENT, unit: '%', current_value: 52, projected_value: 46, projected_year: 2030 },
    ]);
    // Energy is not published on this portrait: direction only, with the reason.
    const energy = row.projections!.find((p) => p.dimension_slug === 'energy')!;
    expect(energy.direction).toBe('worsens');
    expect(energy.projected_viz).toBeNull();
    expect(energy.unquantified_reasons[0]).toMatch(/not published/);

    const mail = mailTo(requester.email!);
    expect(mail).not.toBeNull();
    expect(mail).toMatch(/Subject: =\?UTF-8\?Q\?Policy_analysis_ready/);
    expect(mail).toContain(`https://app.example.gov/${tenant.slug}/admin/policy/${analysis.id}`);
  });

  it('fails an answer with no JSON in it, keeping what the session cost', async () => {
    const { requester, analysis } = await seed();
    session.succeeded = true;
    session.resultText = 'I am unable to assess this policy without more detail.';
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/without a structured result/);
    expect(row.result).toBeNull();
    expect(row.tokenUsage).toEqual({ input_tokens: 1200, output_tokens: 340 });
    expect(row.transcript).not.toBeNull();
    expect(mailTo(requester.email!)).toMatch(/Subject: =\?UTF-8\?Q\?Policy_analysis_failed/);
  });

  it('fails a schema-invalid result and names the problem without a stack trace', async () => {
    const { analysis } = await seed();
    session.succeeded = true;
    session.resultText = JSON.stringify({
      summary: 's',
      impacts: [{ dimension_slug: 'mars', direction: 'improves', magnitude: 'small', confidence: 'low', rationale: 'r' }],
    });
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('failed validation');
    expect(row.error).toContain('impacts › #1 › dimension_slug: unexpected value “mars”');
    expect(row.error).not.toMatch(/\bat\s+\S+\s+\(/);
    expect(row.projections).toBeNull();
  });

  it('fails a session that did not complete', async () => {
    const { analysis } = await seed();
    session.succeeded = false;
    session.resultText = '';
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/did not complete/);
  });

  it('runs a job once: a settled analysis is skipped, an interrupted one is failed', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { analysis } = await seed();
    session.succeeded = true;
    session.resultText = JSON.stringify({ summary: 's', impacts: [] });
    await run(analysis.id);
    const before = session.calls;
    const again = await run(analysis.id);
    expect(again.status).toBe('complete');
    expect(session.calls).toBe(before);

    // A job redelivered after a crash finds its row still running.
    const { analysis: interrupted } = await seed();
    await m
      .getDb()
      .update(m.policyAnalyses)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(m.policyAnalyses.id, interrupted.id));
    const row = await run(interrupted.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/interrupted/);
    expect(session.calls).toBe(before);
  });
});
