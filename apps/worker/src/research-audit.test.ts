import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import type { SessionResult } from './session.js';

const script = vi.hoisted(() => ({
  calls: [] as { prompt: string; apiKey?: string; model?: string; orchestrate?: boolean; archivedExhibits?: unknown; maxTurns?: number; pageReaderModel?: string }[],
  mode: 'valid' as 'valid' | 'invalid' | 'refused-result' | 'refused-throw' | 'transient',
  storageUnavailable: false,
}));
vi.mock('./session.js', async (original) => {
  const actual = await original<typeof import('./session.js')>();
  return { ...actual, runSession: vi.fn(async (input: { prompt: string; apiKey?: string; model?: string; orchestrate?: boolean; archivedExhibits?: unknown; maxTurns?: number; pageReaderModel?: string }): Promise<SessionResult> => {
    script.calls.push(input);
    const usage = { input_tokens: 17, output_tokens: 5, cache_read_tokens: 29, model: input.model };
    if (script.mode === 'refused-throw') throw new actual.SessionRunError(new Error('key refused'), { ...usage, partial: true }, 'authentication_failed');
    if (script.mode === 'transient') throw new actual.SessionRunError(new Error('transport interrupted'), { ...usage, partial: true });
    if (script.mode === 'refused-result') return { resultText: '', succeeded: false, apiError: 'authentication_failed', transcript: Buffer.from('refused'), usage };
    const resultText = script.mode === 'invalid' ? '{"disposition":"approve","reason":""}'
      : input.prompt.includes('Include BOTH results in one JSON object')
        ? '{"disposition":"approve","reason":"Captured exhibit supports the claim.","correction":null,"higher_tier_source_existed":false,"claimed_tier_supported":true,"tier_note":"Original authority and construct independently checked."}'
        : input.prompt.startsWith('# Tier-compliance')
          ? '{"higher_tier_source_existed":false,"claimed_tier_supported":true,"note":"Original authority and construct independently checked."}'
          : '{"disposition":"approve","reason":"Captured exhibit supports the claim.","correction":null}';
    return { resultText, succeeded: true, transcript: Buffer.from('audit'), usage };
  }) };
});
vi.mock('./storage.js', () => ({ tenantStorage: vi.fn(async () => {
  if (script.storageUnavailable) throw new Error('archive offline');
  return { get: vi.fn(async () => Buffer.from('captured exhibit')), put: vi.fn(), describe: () => 'test archive' };
}) }));

const hasDb = Boolean(process.env.DATABASE_URL);
const helpers = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as unknown as JobHelpers;
const uniq = () => `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
beforeEach(() => { script.calls.length = 0; script.mode = 'valid'; script.storageUnavailable = false; vi.clearAllMocks(); });

describe.skipIf(!hasDb)('post-run audit persistence and metering', () => {
  async function seed(tiers: number[], flagged = true) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Independent audit test' });
    const [dimension] = await db.select().from(m.dimensions).where(eq(m.dimensions.tenantId, tenant.id)).limit(1);
    const [run] = await db.insert(m.researchRuns).values({ tenantId: tenant.id, status: 'running',
      plan: { sessions: [], config_hash: 'test', plugin_version: 'test' }, configSnapshot: defaultPortraitConfig(tenant.name, 'Municipal boundary') }).returning();
    const [session] = await db.insert(m.researchSessions).values({ runId: run!.id, dimensionId: dimension!.id, kind: 'dimension', status: 'complete' }).returning();
    const rows = await db.insert(m.findings).values(tiers.map((tier, index) => ({ sessionId: session!.id, dimensionId: dimension!.id, indicatorSlug: `test-${index}`,
      payload: { kind: 'indicator' as const, indicator_slug: `test-${index}`, name: `Indicator ${index}`, value: 42, unit: '%', year: 2025, target: 30, level_pct: 40,
        scoring: { threshold_ref: `test.${index}`, function: 'lower_is_better' as const, inputs: { value: 42, target: 30 }, worked_math: '40%' },
        source: 'City data office', source_url: `https://city.example/data/${index}`, source_tier: tier,
        evidence: { snapshot_path: `evidence/test-${index}.png`, captured_at: '2026-10-23T12:00:00Z' }, confidence: 'high' as const, geographic_scale: 'city' as const },
      verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: flagged ? 'uncertain' as const : 'pass' as const },
    }))).returning();
    // Findings are immutable by contract, so these isolated-test tenants are
    // retained, as worker notify/metering tests retain theirs.
    return { m, db, run: run!, rows, tenant, eq };
  }

  it('writes flagged workflow recommendations plus a stable tier-1 sample (merged into 1 pass per finding), with archived evidence and frozen funding/model', async () => {
    const { auditResearchRun, tierAuditSample } = await import('./research-audit.js');
    const { m, db, run, rows } = await seed([1, 1, 1, 1, 1], true);
    expect(tierAuditSample(rows, run.id).map(row => row.id)).toEqual(tierAuditSample([...rows].reverse(), run.id).map(row => row.id));
    const usage = await auditResearchRun(run, helpers, { apiKey: 'test-organization-key', verifierModel: 'frozen-audit-model' });
    expect(script.calls).toHaveLength(5); // 5 findings; 3 overlapping tier_audit checks merged into single passes
    expect(script.calls.every(call => call.apiKey === 'test-organization-key' && call.model === 'frozen-audit-model' && call.orchestrate === false)).toBe(true);
    expect(script.calls[0]!.archivedExhibits).toMatchObject({ snapshot: Buffer.from('captured exhibit') });
    expect(Object.keys(usage)).toHaveLength(5);
    const { inArray } = await import('drizzle-orm');
    const audits = await db.select().from(m.findingAudits).where(inArray(m.findingAudits.findingId, rows.map(row => row.id)));
    expect(audits.filter(row => row.source === 'workflow')).toHaveLength(5);
    expect(audits.filter(row => row.source === 'tier_audit')).toHaveLength(3);
    expect(audits.every(row => row.appliedAt === null && row.disposition === 'approve')).toBe(true);
    expect(await auditResearchRun(run, helpers)).toEqual({});
    expect(script.calls).toHaveLength(5); // no repeated paid audit on retry
  });

  it('audits on the turn cap and page reader the run was planned with, and on the worker’s cap for a plan without one', async () => {
    const { auditResearchRun } = await import('./research-audit.js');
    const planned = await seed([2], true);
    await auditResearchRun(planned.run, helpers, { verifierModel: 'frozen-audit-model', maxTurns: 9, pageReaderModel: 'planned-reader' });
    expect(script.calls).toHaveLength(1);
    expect(script.calls[0]).toMatchObject({ maxTurns: 9, pageReaderModel: 'planned-reader' });
    script.calls.length = 0;
    const historic = await seed([2], true);
    await auditResearchRun(historic.run, helpers, { verifierModel: 'frozen-audit-model' });
    expect(script.calls[0]).toMatchObject({ maxTurns: 16 });
    expect(script.calls[0]).not.toHaveProperty('pageReaderModel');
  });

  it('keeps invalid/thrown model outputs visible for review, with their full spend', async () => {
    const { auditResearchRun } = await import('./research-audit.js');
    const { inArray } = await import('drizzle-orm');
    for (const mode of ['invalid', 'transient'] as const) {
      script.mode = mode;
      const { m, db, run, rows } = await seed([2, 2]);
      const usage = await auditResearchRun(run, helpers);
      expect(Object.values(usage)).toHaveLength(2);
      expect(Object.values(usage).every(value => value.input_tokens === 17 && value.cache_read_tokens === 29)).toBe(true);
      const audits = await db.select().from(m.findingAudits).where(inArray(m.findingAudits.findingId, rows.map(row => row.id)));
      expect(audits.every(row => row.disposition === 're_research' && row.reason.includes('did not complete'))).toBe(true);
    }
  });

  it.each(['refused-result', 'refused-throw'] as const)('stops paid model calls after an organization-key refusal (%s)', async mode => {
    script.mode = mode;
    const { auditResearchRun } = await import('./research-audit.js');
    const { m, db, run, rows } = await seed([2, 2, 2]);
    const usage = await auditResearchRun(run, helpers, { apiKey: 'test-organization-key' });
    expect(script.calls).toHaveLength(1);
    expect(Object.values(usage)).toHaveLength(1);
    expect(Object.values(usage)[0]).toMatchObject({ input_tokens: 17, cache_read_tokens: 29 });
    const { inArray } = await import('drizzle-orm');
    const audits = await db.select().from(m.findingAudits).where(inArray(m.findingAudits.findingId, rows.map(row => row.id)));
    expect(audits).toHaveLength(3);
    expect(audits.every(row => row.disposition === 're_research')).toBe(true);
    expect(audits.filter(row => row.reason.includes('key was refused'))).toHaveLength(2);
  });

  it('discloses unavailable evidence storage and preserves cost if audit persistence fails', async () => {
    script.storageUnavailable = true;
    const { auditResearchRun } = await import('./research-audit.js');
    const { m, db, run, rows, eq } = await seed([2]);
    const usage = await auditResearchRun(run, helpers);
    expect(Object.values(usage)[0]!.input_tokens).toBe(17);
    expect((await db.select().from(m.findingAudits).where(eq(m.findingAudits.findingId, rows[0]!.id)))[0]!.reason).toContain('storage was unavailable');
    const second = await seed([2]);
    const insert = vi.spyOn(second.db, 'insert').mockImplementationOnce(() => { throw new Error('audit persistence offline'); });
    try {
      const preserved = await auditResearchRun(second.run, helpers);
      expect(Object.values(preserved)[0]!.input_tokens).toBe(17);
      expect(helpers.logger.error).toHaveBeenCalledWith(expect.stringContaining('could not persist'));
    } finally { insert.mockRestore(); }
  });
});

describe('planAuditWork & shouldSkipWorkflowAudit (P0.4 deduplication)', () => {
  const makeFinding = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    sessionId: 'sess-1',
    dimensionId: 'dim-1',
    indicatorSlug: `ind-${id}`,
    createdAt: new Date(),
    payload: {
      kind: 'indicator' as const,
      indicator_slug: `ind-${id}`,
      name: `Indicator ${id}`,
      value: 42,
      unit: '%',
      year: 2025,
      target: 30,
      level_pct: 40,
      scoring: { threshold_ref: 'test.x', function: 'lower_is_better' as const, inputs: { value: 42, target: 30 }, worked_math: '40%' },
      source: 'City data office',
      source_url: `https://city.example/data/${id}`,
      source_tier: 1,
      evidence: { snapshot_path: `evidence/${id}.png`, captured_at: '2026-10-23T12:00:00Z' },
      confidence: 'high' as const,
      geographic_scale: 'city' as const,
    },
    verification: {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: true,
      content_supported: 'uncertain' as const,
    },
    ...over,
  }) as unknown as import('@deep-fryer/db').Finding;

  const makeGap = (id: string, verification: Record<string, unknown> | null = null) =>
    makeFinding(id, {
      payload: {
        kind: 'gap',
        indicator_slug: `gap-${id}`,
        reason: 'No local series',
        scales_tried: ['city'],
        searched_at: '2026-10-23T12:00:00Z',
      },
      verification,
    });

  it('skips workflow re-audit on Opus-produced/confirmed gaps and text-verified indicators', async () => {
    const { shouldSkipWorkflowAudit } = await import('./research-audit.js');
    const standardPlan = { strategy: 'standard' as const, models: { session_model: 'claude-sonnet-5', subagent_model: null, verifier_model: 'claude-opus-5' } };
    const deepPlan = { strategy: 'deep' as const, models: { session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5' } };
    const hybridPlan = { strategy: 'hybrid' as const, models: { session_model: 'claude-sonnet-5', subagent_model: 'claude-sonnet-5', escalation_model: 'claude-opus-5', verifier_model: 'claude-opus-5' } };

    // Standard Sonnet gap still gets workflow audited.
    expect(shouldSkipWorkflowAudit(makeGap('g1'), standardPlan)).toBe(false);
    // Deep Opus gap or hybrid Opus-escalated gap skips redundant workflow re-audit.
    expect(shouldSkipWorkflowAudit(makeGap('g2'), deepPlan)).toBe(true);
    expect(shouldSkipWorkflowAudit(makeGap('g3', { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', produced_by_stage: 'escalation' }), hybridPlan)).toBe(true);

    // Indicator where verifier already inspected readable text (value_on_page found or not_found) skips workflow re-audit.
    expect(shouldSkipWorkflowAudit(makeFinding('i1', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'fail', value_on_page: 'found' } }), standardPlan)).toBe(true);
    expect(shouldSkipWorkflowAudit(makeFinding('i2', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', value_on_page: 'not_found' } }), standardPlan)).toBe(true);
    // Scanned PDF (no_text) or skipped verifier still gets workflow audit!
    expect(shouldSkipWorkflowAudit(makeFinding('i3', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', value_on_page: 'no_text' } }), standardPlan)).toBe(false);
    expect(shouldSkipWorkflowAudit(makeFinding('i4', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', value_on_page: 'found', verifier_note: 'verifier did not run: key refused' } }), standardPlan)).toBe(false);
  });

  it('never audits the same finding.id twice, merging workflow + tier_audit into one combined work item', async () => {
    const { planAuditWork } = await import('./research-audit.js');
    const rows = [
      makeFinding('f1', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', value_on_page: 'no_text' } }),
      makeFinding('f2', { verification: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass', value_on_page: 'found' } }),
      makeGap('g-opus', { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true, content_supported: 'uncertain', produced_by_stage: 'escalation', produced_by_model: 'claude-opus-5' }),
    ];
    const run = {
      id: 'run-dedup',
      plan: {
        sessions: [],
        config_hash: 'h',
        plugin_version: '1',
        strategy: 'hybrid' as const,
        models: { session_model: 'claude-sonnet-5', subagent_model: 'claude-sonnet-5', escalation_model: 'claude-opus-5', verifier_model: 'claude-opus-5' },
      },
    };
    const planned = planAuditWork(rows, run);
    // Every finding id appears at most once.
    expect(new Set(planned.map((p) => p.finding.id)).size).toBe(planned.length);
    // f1 is both flagged (no_text + uncertain) AND in tier-1 sample -> merged into ['workflow', 'tier_audit']!
    expect(planned.find((p) => p.finding.id === 'f1')?.sources).toEqual(['workflow', 'tier_audit']);
    // f2 passed verification -> only in tier_audit!
    expect(planned.find((p) => p.finding.id === 'f2')?.sources).toEqual(['tier_audit']);
    // g-opus was confirmed by Opus escalation -> skipped!
    expect(planned.find((p) => p.finding.id === 'g-opus')).toBeUndefined();
  });
});
