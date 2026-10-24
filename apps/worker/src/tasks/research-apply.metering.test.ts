import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { JobHelpers } from 'graphile-worker';
import { encryptSecret, keyHint, parseSecretsKey } from '@deep-fryer/core/secrets';
import type { SessionTokenUsage } from '@deep-fryer/core';

/**
 * researchApply's session handling against Postgres, with the model sessions
 * scripted (docs/haiku-5-5.md §3.1, §3.3, §3.4, §3.5): what each research
 * and verifier session answers, uses, or throws is the input under test, and
 * everything after it — the region session's options, the verifier
 * accumulator, partial-output flags, a key Anthropic refuses part-way — is
 * the production code path. No model is called: the session runner is mocked
 * at the module boundary, and source URLs are not fetched.
 */
const script = vi.hoisted(() => ({
  /** Every runSessionWithRetry input, in order. */
  research: [] as { prompt: string; orchestrate?: boolean; apiKey?: string }[],
  /** Every verifier (runSession) prompt, in order. */
  verifier: [] as string[],
  verifierOptions: [] as { model?: string; apiKey?: string; orchestrate?: boolean; archivedExhibits?: { snapshot?: Buffer; pdf?: Buffer } }[],
  /** What a research session answers, by the start of its prompt; throws when an Error. */
  answers: {} as Record<string, string | Error>,
  /** What a verifier answers, by the indicator name in its prompt; a function may throw. */
  verdicts: {} as Record<string, () => { resultText: string; usage: SessionTokenUsage }>,
  auditUsage: {} as Record<string, SessionTokenUsage>,
  auditThrows: false,
}));
vi.mock('../research-audit.js', () => ({ auditResearchRun: vi.fn(async () => {
  if (script.auditThrows) throw new Error('audit unavailable');
  return script.auditUsage;
}) }));

vi.mock('../session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session.js')>();
  return {
    ...actual,
    runSessionWithRetry: vi.fn(async (input: { prompt: string; orchestrate?: boolean; apiKey?: string }) => {
      script.research.push(input);
      const key = Object.keys(script.answers).find((k) => input.prompt.startsWith(k));
      const answer = key ? script.answers[key]! : '[]';
      if (answer instanceof Error) throw answer;
      return { resultText: answer, succeeded: true, transcript: Buffer.from('t'), usage: { input_tokens: 1, output_tokens: 1 } };
    }),
    runSession: vi.fn(async (input: { prompt: string; model?: string; apiKey?: string; orchestrate?: boolean; archivedExhibits?: { snapshot?: Buffer; pdf?: Buffer } }) => {
      script.verifier.push(input.prompt);
      script.verifierOptions.push(input);
      const name = Object.keys(script.verdicts).find((n) => input.prompt.includes(n));
      if (!name) throw new Error(`no scripted verdict for: ${input.prompt.slice(0, 80)}`);
      const { resultText, usage } = script.verdicts[name]!();
      return { resultText, succeeded: true, transcript: Buffer.from('v'), usage };
    }),
  };
});
// Citations are not fetched in a test: every source URL "resolves".
vi.mock('@deep-fryer/research', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-fryer/research')>();
  return {
    ...actual,
    deterministicChecks: (raw: unknown, config: Parameters<typeof actual.deterministicChecks>[1], slug: string) =>
      actual.deterministicChecks(raw, config, slug, async () => true),
  };
});
vi.mock('../storage.js', () => ({ tenantStorage: vi.fn(async () => ({ get: vi.fn(async () => Buffer.from('captured exhibit')) })) }));
vi.mock('../notify.js', () => ({ notifyRunFinished: vi.fn(async () => {}) }));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const randomSecretsKey = () => btoa(String.fromCharCode(...globalThis.crypto.getRandomValues(new Uint8Array(32))));
const API_KEY = `sk-ant-api03-${'Mt5'.repeat(30)}-Rr8Q`;
const helpers = {
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
} as unknown as JobHelpers;

/** A schema-valid indicator finding the verifier is then asked about (by `name`). */
const finding = (slug: string, name: string) => ({
  kind: 'indicator',
  indicator_slug: slug,
  name,
  value: 42,
  unit: '%',
  year: new Date().getFullYear() - 1,
  target: 30,
  level_pct: 40,
  scoring: { threshold_ref: `x.${slug}`, function: 'lower_is_better', inputs: { value: 42, target: 30 }, worked_math: 'w' },
  source: 'City statistics office',
  source_url: `https://stats.example.gov/${slug}`,
  source_tier: 1,
  evidence: { snapshot_path: `evidence/${slug}.png`, captured_at: '2026-10-01T00:00:00Z' },
  confidence: 'high',
  geographic_scale: 'city',
});

const opus = (input: number, cacheRead: number): SessionTokenUsage => ({
  input_tokens: input,
  output_tokens: 10,
  cache_read_tokens: cacheRead,
  cache_write_tokens: 50,
  model: 'claude-opus-5',
  by_model: {
    'claude-opus-5': { input_tokens: input, output_tokens: 10, cache_read_tokens: cacheRead, cache_write_tokens: 50, web_search_requests: 0 },
    'claude-haiku-4-5-20251001': { input_tokens: 3000, output_tokens: 200, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
  },
  refusals: 0,
});

describe('sessionConcurrency', () => {
  it('takes a whole number of at least 1, and falls back to the default for anything else', async () => {
    const { DEFAULT_SESSION_CONCURRENCY, sessionConcurrency } = await import('./research-apply.js');
    expect(DEFAULT_SESSION_CONCURRENCY).toBe(3);
    expect(sessionConcurrency(undefined)).toEqual({ value: 3, valid: true });
    expect(sessionConcurrency('1')).toEqual({ value: 1, valid: true });
    expect(sessionConcurrency(' 6 ')).toEqual({ value: 6, valid: true });
    // Number() reads each of these as NaN or a fraction; NaN made a pool of no workers.
    for (const raw of ['three', '', '0', '-2', '2.5', '3x', '1e3', 'NaN', 'Infinity']) {
      expect(sessionConcurrency(raw)).toEqual({ value: 3, valid: false });
    }
  });
});

describe.skipIf(!hasDb)('researchApply session handling (Postgres, scripted sessions)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  const saved = { DF_SECRETS_KEY: process.env.DF_SECRETS_KEY, RESEARCH_SESSION_CONCURRENCY: process.env.RESEARCH_SESSION_CONCURRENCY };
  beforeEach(() => {
    script.research.length = 0;
    script.verifier.length = 0;
    script.verifierOptions.length = 0;
    script.answers = {};
    script.verdicts = {};
    script.auditUsage = {};
    script.auditThrows = false;
    // One session at a time, so "no further session starts" is observable.
    process.env.RESEARCH_SESSION_CONCURRENCY = '1';
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  /** A portrait and a planned run (region, housing, energy) funded by `funding`, with the organization's key on file. */
  async function seed(funding: 'plan' | 'organization_key') {
    const m = await import('@deep-fryer/db');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const secretsKey = randomSecretsKey();
    process.env.DF_SECRETS_KEY = secretsKey;
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Meter City' });
    cleanup.push(async () => {
      // Findings are immutable (a trigger refuses their deletion), so a run
      // that recorded any stays, in its throwaway tenant, as in notify.test.ts.
      const recorded = await db
        .select({ id: m.findings.id })
        .from(m.findings)
        .innerJoin(m.researchSessions, eq(m.researchSessions.id, m.findings.sessionId))
        .innerJoin(m.researchRuns, eq(m.researchRuns.id, m.researchSessions.runId))
        .where(eq(m.researchRuns.tenantId, tenant.id))
        .limit(1);
      if (recorded.length) return;
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    await m.upsertOrganizationApiKey(db, {
      organizationId: tenant.organizationId,
      ciphertext: await encryptSecret(API_KEY, parseSecretsKey(secretsKey), tenant.organizationId),
      keyHint: keyHint(API_KEY),
      createdBy: null,
      validatedAt: new Date(),
    });
    const spec = { output_schema_ref: 'finding', config_hash: 'h', tool_allowlist: ['WebSearch', 'WebFetch'] };
    const [run] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: tenant.id,
        status: 'planned',
        plan: {
          sessions: [
            { kind: 'region_context', prompt: 'REGION: describe the region.', ...spec },
            { kind: 'dimension', dimension_slug: 'housing', prompt: 'HOUSING: research housing.', ...spec },
            { kind: 'dimension', dimension_slug: 'energy', prompt: 'ENERGY: research energy.', ...spec },
          ],
          config_hash: 'h',
          plugin_version: 'test',
        },
        configSnapshot: defaultPortraitConfig('Meter City', 'The Meter City municipal boundary'),
        appliedAt: new Date(),
        funding,
      })
      .returning();
    const rows = async () => {
      const sessions = await db.select().from(m.researchSessions).where(eq(m.researchSessions.runId, run!.id));
      const dims = await db.select().from(m.dimensions).where(eq(m.dimensions.tenantId, tenant.id));
      const slugOf = new Map(dims.map((d) => [d.id, d.slug]));
      return sessions.map((s) => ({ ...s, slug: s.dimensionId ? slugOf.get(s.dimensionId)! : 'region' }));
    };
    const settledRun = async () => (await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run!.id)))[0]!;
    const findingsOf = async (sessionId: string) => db.select().from(m.findings).where(eq(m.findings.sessionId, sessionId));
    return { run: run!, rows, settledRun, findingsOf };
  }

  it('never orchestrates the region session, whatever RESEARCH_SUBAGENT_MODEL says', async () => {
    const savedScout = process.env.RESEARCH_SUBAGENT_MODEL;
    process.env.RESEARCH_SUBAGENT_MODEL = 'claude-haiku-5-5';
    try {
      const { run } = await seed('plan');
      const { researchApply } = await import('./research-apply.js');
      await researchApply({ runId: run.id }, helpers);
      const region = script.research.find((i) => i.prompt.startsWith('REGION'))!;
      expect(region.orchestrate).toBe(false);
      // Research sessions keep the default (orchestrated when scouts are configured).
      expect(script.research.find((i) => i.prompt.startsWith('HOUSING'))!.orchestrate).toBeUndefined();
    } finally {
      if (savedScout === undefined) delete process.env.RESEARCH_SUBAGENT_MODEL;
      else process.env.RESEARCH_SUBAGENT_MODEL = savedScout;
    }
  });

  it('still runs every dimension session when RESEARCH_SESSION_CONCURRENCY is not a number', async () => {
    process.env.RESEARCH_SESSION_CONCURRENCY = 'three';
    const warn = vi.mocked(helpers.logger.warn);
    warn.mockClear();
    const { run, rows } = await seed('plan');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    expect(script.research.map((i) => i.prompt.split(':')[0]).sort()).toEqual(['ENERGY', 'HOUSING', 'REGION']);
    expect((await rows()).map((r) => r.slug).sort()).toEqual(['energy', 'housing', 'region']);
    // The operator is told the value was not used.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^RESEARCH_SESSION_CONCURRENCY="three" is not a whole number/));
  });

  it('passes independent archived exhibits to the verifier and honors a plan’s frozen models', async () => {
    const { run } = await seed('plan');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    await m.getDb().update(m.researchRuns).set({ plan: { ...run.plan, strategy: 'deep', models: {
      session_model: 'planned-researcher', subagent_model: 'planned-scout', verifier_model: 'planned-judge',
    } } }).where(eq(m.researchRuns.id, run.id));
    script.answers = { HOUSING: JSON.stringify([finding('cost-burdened-renters', 'Cost-burdened renters')]) };
    script.verdicts = { 'Cost-burdened renters': () => ({ resultText: '{"content_supported":"pass"}', usage: opus(10, 0) }) };
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    expect(script.research[0]).toMatchObject({ model: 'planned-researcher', orchestrate: false });
    expect(script.research[1]).toMatchObject({ model: 'planned-researcher', scoutModel: 'planned-scout' });
    expect(script.verifierOptions).toHaveLength(1);
    expect(script.verifierOptions[0]).toMatchObject({
      model: 'planned-judge', orchestrate: false, archivedExhibits: { snapshot: Buffer.from('captured exhibit') },
    });
    expect(script.verifier[0]).toContain('archived-snapshot.png');
    expect(script.verifier[0]).not.toContain('source-scout');
    const { auditResearchRun } = await import('../research-audit.js');
    expect(auditResearchRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: run.id }), helpers, { apiKey: null, verifierModel: 'planned-judge' });
  });

  it('records audit spend without turning an independent audit failure into lost research', async () => {
    const first = await seed('plan');
    script.auditUsage = { 'audit:workflow:test': opus(321, 900) };
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: first.run.id }, helpers);
    expect((await first.settledRun()).tokenUsage!['audit:workflow:test']).toEqual(opus(321, 900));
    const second = await seed('plan');
    script.auditThrows = true;
    await researchApply({ runId: second.run.id }, helpers);
    expect((await second.settledRun()).status).toBe('complete');
  });

  it('independently checks a narrative in the same verifier and flags a missing narrative verdict', async () => {
    const payload = { ...finding('energy-burden', 'Energy burden'), narrative_draft: { context: 'Supported context', actions: [{ text: 'Apply for assistance', source_url: 'https://city.example/assistance', evidence: { snapshot_path: 'evidence/action.png', captured_at: '2026-10-23T12:00:00Z' } }] } };
    script.answers = { ENERGY: JSON.stringify([payload]) };
    script.verdicts = { 'Energy burden': () => ({ resultText: '{"content_supported":"pass"}', usage: opus(10, 0) }) };
    const { run, rows, findingsOf } = await seed('plan');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    expect(script.research).toHaveLength(3); // no extra hidden drafting session
    expect(script.verifier).toHaveLength(1);
    expect(script.verifier[0]).toContain('Apply for assistance');
    expect(script.verifierOptions[0]!.archivedExhibits).toMatchObject({ additional: [{ filename: 'action-1-snapshot.png', body: Buffer.from('captured exhibit') }] });
    const energy = (await rows()).find(row => row.slug === 'energy')!;
    expect((await findingsOf(energy.id))[0]!.verification).toMatchObject({ content_supported: 'pass', narrative_supported: 'uncertain' });
  });

  it('executes and charges every dense-dimension session independently', async () => {
    const { run, rows } = await seed('plan');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const housing = run.plan.sessions.find((s) => s.dimension_slug === 'housing')!;
    const plan = { ...run.plan, sessions: [...run.plan.sessions, { ...housing, prompt: 'HOUSING-PART-2: remaining indicators.' }] };
    await m.getDb().update(m.researchRuns).set({ plan }).where(eq(m.researchRuns.id, run.id));
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    expect(script.research.map((s) => s.prompt.split(':')[0])).toEqual(['REGION', 'HOUSING', 'ENERGY', 'HOUSING-PART-2']);
    expect((await rows()).filter((row) => row.slug === 'housing')).toHaveLength(2);
    expect(await m.researchSessionsUsed(m.getDb(), (await m.organizationForTenant(m.getDb(), run.tenantId))!.id, new Date(0))).toBe(plan.sessions.length);
  });

  it('records all unstarted dense-dimension parts after a key refusal', async () => {
    const { orgKeyRejected } = await import('../org-key.js');
    script.answers = { HOUSING: orgKeyRejected('billing_error', 'claude-sonnet-5', { input_tokens: 0, output_tokens: 0 }) };
    const { run, rows } = await seed('organization_key');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const housing = run.plan.sessions.find((s) => s.dimension_slug === 'housing')!;
    const plan = { ...run.plan, sessions: [...run.plan.sessions, { ...housing, prompt: 'HOUSING-PART-2: remaining indicators.' }] };
    await m.getDb().update(m.researchRuns).set({ plan }).where(eq(m.researchRuns.id, run.id));
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    expect(script.research.map((s) => s.prompt.split(':')[0])).toEqual(['REGION', 'HOUSING']);
    expect((await rows()).map((row) => [row.slug, row.status]).sort()).toEqual([
      ['energy', 'failed'], ['housing', 'failed'], ['housing', 'failed'], ['region', 'complete'],
    ]);
  });

  it('logs a model id the API did not find for the operator, once per run', async () => {
    const error = vi.mocked(helpers.logger.error);
    error.mockClear();
    const { orgKeyRejected } = await import('../org-key.js');
    script.answers = { HOUSING: orgKeyRejected('model_not_found', 'claude-sonnet-5-typo', { input_tokens: 0, output_tokens: 0 }) };
    const { run } = await seed('organization_key');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    const lines = error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('model_not_found'));
    expect(lines).toEqual([
      `run ${run.id}: Anthropic reported model_not_found for model "claude-sonnet-5-typo" on the organization's own API key: check that ANTHROPIC_MODEL / VERIFIER_MODEL name a valid model id, or that the key's workspace may use it`,
    ]);
  });

  it('keeps every verifier session’s full usage, a thrown one’s included, and names a fallback judge', async () => {
    const { SessionRunError } = await import('../session.js');
    script.answers = {
      ENERGY: JSON.stringify([finding('energy-burden', 'Energy burden'), finding('energy-poverty', 'Energy poverty')]),
    };
    script.verdicts = {
      'Energy burden': () => ({
        resultText: '{"content_supported":"pass","verifier_note":"Table 3 shows 42%."}',
        usage: {
          ...opus(1000, 20_000),
          refusal_fallbacks: [{ original_model: 'claude-opus-5', fallback_model: 'claude-opus-4-8', category: 'cyber' }],
        },
      }),
      'Energy poverty': () => {
        throw new SessionRunError(new Error('Connection closed mid-response'), { ...opus(400, 7_000), partial: true });
      },
    };
    const { run, rows, settledRun, findingsOf } = await seed('plan');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    const energy = (await rows()).find((r) => r.slug === 'energy')!;
    const usage = (await settledRun()).tokenUsage!;
    expect(usage[`verifier:${energy.id}`]).toEqual({
      input_tokens: 1400,
      output_tokens: 20,
      cache_read_tokens: 27_000,
      cache_write_tokens: 100,
      model: 'claude-opus-5',
      by_model: {
        'claude-opus-5': { input_tokens: 1400, output_tokens: 20, cache_read_tokens: 27_000, cache_write_tokens: 100, web_search_requests: 0 },
        'claude-haiku-4-5-20251001': { input_tokens: 6000, output_tokens: 400, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
      },
      refusals: 0,
      refusal_fallbacks: [{ original_model: 'claude-opus-5', fallback_model: 'claude-opus-4-8', category: 'cyber' }],
      partial: true,
    });

    const byName = Object.fromEntries((await findingsOf(energy.id)).map((f) => [f.indicatorSlug, f.verification!]));
    expect(byName['energy-burden']!.content_supported).toBe('pass');
    expect(byName['energy-burden']!.verifier_note).toBe(
      'Table 3 shows 42%. [Verdict given by claude-opus-4-8 after claude-opus-5 refused (refusal fallback).]',
    );
    // The thrown verifier gave no verdict, as before.
    expect(byName['energy-poverty']!.content_supported).toBe('uncertain');
  });

  it('flags findings salvaged from malformed output, and keeps the session complete', async () => {
    const { isFlagged } = await import('@deep-fryer/core');
    // A trailing comma in the second finding: only the first can be read.
    const good = JSON.stringify(finding('cost-burdened-renters', 'Cost-burdened renters'));
    script.answers = { HOUSING: `\`\`\`json\n[${good},{"kind":"indicator","indicator_slug":"homelessness-rate",}]\n\`\`\`` };
    script.verdicts = { 'Cost-burdened renters': () => ({ resultText: '{"content_supported":"pass"}', usage: opus(10, 0) }) };
    const { run, rows, findingsOf } = await seed('plan');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    const housing = (await rows()).find((r) => r.slug === 'housing')!;
    // Not failed: a failed session is free, and its finding still sits in review.
    expect(housing.status).toBe('complete');
    const recorded = await findingsOf(housing.id);
    expect(recorded.map((f) => f.indicatorSlug)).toEqual(['cost-burdened-renters']);
    expect(recorded[0]!.verification).toMatchObject({ content_supported: 'pass', partial_output: true });
    // Verified and clean on every other check, it is still red-flagged for review.
    expect(isFlagged(recorded[0]!.verification!)).toBe(true);
  });

  it('stops a key-funded run once Anthropic refuses the key, recording the reason on every session that did not finish', async () => {
    const { orgKeyRejected } = await import('../org-key.js');
    const refusal = orgKeyRejected('billing_error', 'claude-sonnet-5', { ...opus(900, 0), partial: true });
    script.answers = { HOUSING: refusal };
    const { run, rows, settledRun } = await seed('organization_key');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    // Region and housing started; energy never did — and never on another key.
    expect(script.research.map((i) => i.prompt.split(':')[0])).toEqual(['REGION', 'HOUSING']);
    expect(script.research.every((i) => i.apiKey === API_KEY)).toBe(true);
    const settled = await settledRun();
    expect(settled.status).toBe('failed');
    const sessions = await rows();
    expect(sessions.map((s) => [s.slug, s.status]).sort()).toEqual([
      ['energy', 'failed'],
      ['housing', 'failed'],
      ['region', 'complete'],
    ]);
    for (const s of sessions.filter((x) => x.slug !== 'region')) {
      expect(JSON.parse(gunzipSync(s.transcript!).toString())).toEqual({ type: 'session_error', message: refusal.message });
    }
    // What the refused session spent before the refusal is still metered.
    const housing = sessions.find((s) => s.slug === 'housing')!;
    expect(settled.tokenUsage![housing.id]).toMatchObject({ input_tokens: 900, partial: true });
  });

  it('starts no further verifier once a verifier is refused the organization key', async () => {
    const { SessionRunError } = await import('../session.js');
    const { ORG_KEY_REMOVED } = await import('../org-key.js');
    script.answers = {
      HOUSING: JSON.stringify([finding('cost-burdened-renters', 'Cost-burdened renters'), finding('homelessness-rate', 'Homelessness rate')]),
    };
    script.verdicts = {
      'Cost-burdened renters': () => {
        throw new SessionRunError(new Error('Claude Code process exited with code 1'), { ...opus(0, 0) }, 'authentication_failed');
      },
      'Homelessness rate': () => ({ resultText: '{"content_supported":"pass"}', usage: opus(10, 0) }),
    };
    const { run, rows, settledRun, findingsOf } = await seed('organization_key');
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    expect(script.verifier).toHaveLength(1);
    const sessions = await rows();
    const housing = sessions.find((s) => s.slug === 'housing')!;
    // The research itself finished; its findings are recorded, unverified.
    expect(housing.status).toBe('complete');
    const recorded = await findingsOf(housing.id);
    expect(recorded).toHaveLength(2);
    for (const f of recorded) {
      expect(f.verification!.content_supported).toBe('uncertain');
      expect(f.verification!.verifier_note).toMatch(/^verifier did not run: Anthropic rejected this organization's own API key/);
    }
    // The run fails with the reason; energy never started.
    expect((await settledRun()).status).toBe('failed');
    const energy = sessions.find((s) => s.slug === 'energy')!;
    expect(energy.status).toBe('failed');
    const message = JSON.parse(gunzipSync(energy.transcript!).toString()).message as string;
    expect(message).toMatch(/Anthropic rejected this organization's own API key/);
    expect(message).not.toBe(ORG_KEY_REMOVED);
    expect(script.research.map((i) => i.prompt.split(':')[0])).toEqual(['REGION', 'HOUSING']);
  });
});
