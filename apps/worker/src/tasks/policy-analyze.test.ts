import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import { POLICY_OUTPUT_LIMITS } from '@deep-fryer/core';
import { composePolicyEmail, fitToContract, type PolicyNotice } from './policy-analyze.js';
import { startSmtpSink } from '../test/smtp-sink.js';

/**
 * The policy-analysis task end to end against Postgres, with the Claude
 * Agent SDK session mocked: what the model answers is the input under test
 * (a valid projection, prose, a schema-invalid result, a dead session), and
 * everything after it — parsing, validation, re-scoring against the
 * published thresholds, settling the row, emailing the requester — is the
 * production code path.
 */
const session = vi.hoisted(() => ({
  resultText: '',
  succeeded: true,
  calls: 0,
  lastInput: null as null | { prompt: string; allowedTools: string[]; orchestrate?: boolean },
  /** The SDK's error for the session's last call, as runSessionWithRetry reports it. */
  apiError: undefined as string | undefined,
}));
vi.mock('../session.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session.js')>()),
  runSessionWithRetry: vi.fn(async (input: { prompt: string; allowedTools: string[]; orchestrate?: boolean }) => {
    session.calls += 1;
    session.lastInput = input;
    return {
      resultText: session.resultText,
      succeeded: session.succeeded,
      transcript: Buffer.from('transcript'),
      usage: { input_tokens: 1200, output_tokens: 340 },
      ...(session.apiError ? { apiError: session.apiError } : {}),
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

const L = POLICY_OUTPUT_LIMITS;
const validImpact = {
  dimension_slug: 'housing',
  direction: 'improves',
  magnitude: 'moderate',
  confidence: 'medium',
  rationale: 'Because.',
  sources: [],
};

describe('fitToContract', () => {
  it('leaves an answer that already fits untouched, with nothing to report', () => {
    const answer = { summary: 's', impacts: [validImpact], assumptions: ['a'], risks: ['r'] };
    expect(fitToContract(answer)).toEqual({ value: answer, adjustments: [] });
    expect(fitToContract('not an object')).toEqual({ value: 'not an object', adjustments: [] });
  });

  it('shortens over-long text at a word, inside the ceiling, and says so', () => {
    const long = 'The policy caps annual rent increases for covered units. '.repeat(40);
    const { value, adjustments } = fitToContract({
      summary: long,
      impacts: [{ ...validImpact, rationale: long }],
      assumptions: [long],
      risks: Array.from({ length: L.listItems + 3 }, (_, i) => `Risk ${i + 1}.`),
    }) as { value: { summary: string; impacts: { rationale: string }[]; assumptions: string[]; risks: string[] }; adjustments: string[] };
    expect(value.summary.length).toBeLessThanOrEqual(L.summaryChars);
    expect(value.summary.endsWith('…')).toBe(true);
    expect(value.summary).not.toMatch(/\s…$/);
    expect(value.impacts[0]!.rationale.length).toBeLessThanOrEqual(L.rationaleChars);
    expect(value.assumptions[0]!.length).toBeLessThanOrEqual(L.listItemChars);
    expect(value.risks).toHaveLength(L.listItems);
    expect(adjustments).toEqual([
      'The summary was shortened to 1,200 characters.',
      '1 rationale was shortened to 1,200 characters.',
      '1 assumption was shortened to 600 characters.',
      '3 risks beyond the 20 allowed were left out.',
    ]);
  });

  it('drops non-https and surplus sources, and sets aside impacts on unknown dimensions', () => {
    const sources = [
      { title: 'Insecure', url: 'http://example.gov/report' },
      { title: 'Not a link', url: 'see the appendix' },
      ...Array.from({ length: 13 }, (_, i) => ({ title: `Source ${i + 1}`, url: `https://example.gov/${i + 1}` })),
      { title: '', url: 'https://data.example.gov/x' },
    ];
    const { value, adjustments } = fitToContract({
      summary: 's',
      impacts: [
        { ...validImpact, sources },
        { ...validImpact, dimension_slug: 'Income & Work' },
        { ...validImpact, dimension_slug: 'nightlife' },
      ],
    }) as { value: { impacts: { dimension_slug: string; sources: { title: string; url: string }[] }[] }; adjustments: string[] };
    expect(value.impacts.map((i) => i.dimension_slug)).toEqual(['housing', 'income-work']);
    expect(value.impacts[0]!.sources).toHaveLength(L.sourcesPerImpact);
    expect(value.impacts[0]!.sources.every((x) => x.url.startsWith('https://'))).toBe(true);
    expect(adjustments).toEqual([
      'An impact on “nightlife”, which is not one of the doughnut\'s 21 dimensions, was set aside.',
      '2 cited sources were left out because they were not https links.',
      '2 sources beyond the 12 allowed per impact were left out.',
    ]);
  });

  it('keeps an impact whose projection is unusable, as direction only', () => {
    const { value, adjustments } = fitToContract({
      summary: 's',
      impacts: [
        { ...validImpact, indicator: 'Rent burden', projected_value: 'about half', projected_year: 2030 },
        { ...validImpact, indicator: 'Rent burden', projected_value: '46', projected_year: 1999 },
      ],
    }) as { value: { impacts: Record<string, unknown>[] }; adjustments: string[] };
    expect(value.impacts[0]).not.toHaveProperty('indicator');
    expect(value.impacts[0]).not.toHaveProperty('projected_value');
    // A numeric string is a number; a year outside the contract is dropped alone.
    expect(value.impacts[1]).toMatchObject({ indicator: 'Rent burden', projected_value: 46 });
    expect(value.impacts[1]).not.toHaveProperty('projected_year');
    expect(adjustments).toEqual(['2 projections with an unusable indicator name, value, or year were kept as direction only (or without a year).']);
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
    const { and, eq } = await import('drizzle-orm');
    const db = m.getDb();
    const [requester] = await db.insert(m.users).values({ email: `${uniq()}@staff.gov` }).returning();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Policy City' });
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
      await db.delete(m.users).where(eq(m.users.id, requester!.id));
    });

    // New portraits start with everything beyond core off; this one has policy analysis on.
    await db
      .update(m.tenantConfig)
      .set({ value: { policy_analysis: true } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));

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
    // One web-research session, never orchestrated (no delegation note after the contract).
    expect(session.lastInput).toMatchObject({ allowedTools: ['WebSearch', 'WebFetch'], orchestrate: false });
    expect(row.status).toBe('complete');
    expect(row.error).toBeNull();
    expect(row.adjustments).toBeNull();
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

  it('completes a slightly-off answer, fixing what it can and noting it for staff', async () => {
    const { analysis } = await seed();
    session.succeeded = true;
    // Unfenced JSON followed by prose, a summary over the ceiling, an http
    // source, and an impact on a dimension that does not exist.
    session.resultText =
      JSON.stringify({
        summary: 'Stabilization slows rent growth for covered units. '.repeat(30),
        impacts: [
          {
            dimension_slug: 'housing',
            direction: 'improves',
            magnitude: 'moderate',
            confidence: 'medium',
            rationale: 'Capped increases reduce cost burden.',
            sources: [
              { title: 'Furman Center', url: 'https://furmancenter.org/research' },
              { title: 'Old report', url: 'http://example.gov/old' },
            ],
          },
          { dimension_slug: 'nightlife', direction: 'worsens', magnitude: 'small', confidence: 'low', rationale: 'r', sources: [] },
        ],
        assumptions: [],
        risks: [],
      }) + '\n\nNote: these are estimates {not measurements}.';

    const row = await run(analysis.id);
    expect(row.status).toBe('complete');
    expect(row.result!.summary.length).toBeLessThanOrEqual(POLICY_OUTPUT_LIMITS.summaryChars);
    expect(row.result!.impacts.map((i) => i.dimension_slug)).toEqual(['housing']);
    expect(row.result!.impacts[0]!.sources).toEqual([{ title: 'Furman Center', url: 'https://furmancenter.org/research' }]);
    expect(row.adjustments).toEqual([
      'The summary was shortened to 1,200 characters.',
      'An impact on “nightlife”, which is not one of the doughnut\'s 21 dimensions, was set aside.',
      '1 cited source was left out because it was not an https link.',
    ]);
  });

  it('settles stale queued analyses whose job cannot run, and leaves waiting ones alone', async () => {
    const m = await import('@deep-fryer/db');
    const { ensureJobQueueSchema, policyJobKey } = await import('@deep-fryer/research');
    const { eq, sql } = await import('drizzle-orm');
    const { policySweep } = await import('./policy-analyze.js');
    await ensureJobQueueSchema();
    const db = m.getDb();
    const hourAgo = new Date(Date.now() - 60 * 60_000);

    // Orphaned: queued an hour ago, its job gone.
    const { requester, analysis: orphan } = await seed();
    // Dead: its job failed for good (attempts exhausted).
    const { analysis: dead } = await seed();
    // Waiting: its job is still in the queue (the worker is down).
    const { analysis: waiting } = await seed();
    // Recent: queued a minute ago, no job yet to judge by.
    const { analysis: recent } = await seed();
    for (const a of [orphan, dead, waiting]) {
      await db.update(m.policyAnalyses).set({ createdAt: hourAgo }).where(eq(m.policyAnalyses.id, a.id));
    }
    for (const a of [dead, waiting]) {
      const key = policyJobKey(a.id);
      await db.execute(sql`select graphile_worker.add_job('policy_analyze', json_build_object('analysisId', ${a.id}::text), job_key := ${key}, max_attempts := 1)`);
      cleanup.push(() => db.execute(sql`select graphile_worker.remove_job(${key})`));
    }
    await db.execute(sql`update graphile_worker._private_jobs set attempts = max_attempts, last_error = 'boom' where key = ${policyJobKey(dead.id)}`);

    await policySweep({}, helpers);

    const status = async (id: string) =>
      (await db.select().from(m.policyAnalyses).where(eq(m.policyAnalyses.id, id)))[0]!;
    for (const a of [orphan, dead]) {
      const row = await status(a.id);
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/never started.*not counted against your plan/);
    }
    expect((await status(waiting.id)).status).toBe('queued');
    expect((await status(recent.id)).status).toBe('queued');
    expect(mailTo(requester.email!)).toMatch(/Subject: =\?UTF-8\?Q\?Policy_analysis_failed/);
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
    // An unknown direction cannot be fixed without guessing what was meant
    // (unlike an unknown dimension, which is set aside), so it fails.
    session.resultText = JSON.stringify({
      summary: 's',
      impacts: [{ dimension_slug: 'housing', direction: 'better', magnitude: 'small', confidence: 'low', rationale: 'r' }],
    });
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('failed validation');
    expect(row.error).toContain('impacts › #1 › direction: unexpected value “better”');
    expect(row.error).not.toMatch(/\bat\s+\S+\s+\(/);
    expect(row.projections).toBeNull();
  });

  it('does not run an analysis whose portrait turned policy analysis off, and releases its session', async () => {
    const { FEATURE_OFF } = await import('./policy-analyze.js');
    const { runSessionWithRetry } = await import('../session.js');
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const { tenant, requester, analysis } = await seed();
    await m
      .getDb()
      .update(m.tenantConfig)
      .set({ value: { policy_analysis: false } })
      .where(and(eq(m.tenantConfig.tenantId, tenant.id), eq(m.tenantConfig.key, 'features')));
    const calls = vi.mocked(runSessionWithRetry).mock.calls.length;
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toBe(FEATURE_OFF);
    expect(vi.mocked(runSessionWithRetry).mock.calls.length).toBe(calls);
    expect(mailTo(requester.email!)).toContain('did not run');
  });

  it('completes a result salvaged from malformed output, and says so first among the adjustments', async () => {
    const { PARTIAL_OUTPUT_NOTE } = await import('./policy-analyze.js');
    const { analysis } = await seed();
    session.succeeded = true;
    // A malformed wrapper (trailing comma) around a valid analysis: only the inner object reads.
    session.resultText = `{"analysis": ${JSON.stringify({ summary: 'Little measurable effect.', impacts: [], assumptions: [], risks: [] })}, }`;
    const row = await run(analysis.id);
    expect(row.status).toBe('complete');
    expect(row.adjustments).toEqual([PARTIAL_OUTPUT_NOTE]);
  });

  it('names malformed output when the part that could be read fails validation', async () => {
    const { analysis } = await seed();
    session.succeeded = true;
    // A trailing comma after the impacts: the first readable object is one impact, not an analysis.
    session.resultText = `{"summary":"s","impacts":[${JSON.stringify(validImpact)}],}`;
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^The analysis returned malformed JSON, and the part that could be read failed validation/);
  });

  it('fails a session that did not complete', async () => {
    const { analysis } = await seed();
    session.succeeded = false;
    session.resultText = '';
    const row = await run(analysis.id);
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/did not complete/);
  });

  it('says plainly when the deployment’s own key was refused, which is not retried or temporary', async () => {
    const { analysis } = await seed();
    session.succeeded = false;
    session.resultText = '';
    session.apiError = 'billing_error';
    try {
      const row = await run(analysis.id);
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/refused the request\. This is not temporary/);
      expect(row.error).not.toMatch(/even after a retry/);
    } finally {
      session.apiError = undefined;
    }
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
