import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobHelpers } from 'graphile-worker';
import type { ResearchPlan } from '@deep-fryer/core';

/**
 * A run executes with what its plan recorded, not with the worker's
 * constants at the time it runs. The research package's turn-cap constants
 * are replaced here by different values — as a later change to them would —
 * and a run planned with deep v1 still runs its researchers, verifier and
 * audit on deep v1's caps and its page reader. A plan from before strategies
 * were recorded runs on the constants, as it always did. Model sessions are
 * scripted at the module boundary; nothing is fetched or called.
 */
const script = vi.hoisted(() => ({
  research: [] as Record<string, unknown>[],
  verifier: [] as Record<string, unknown>[],
}));
vi.mock('../session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session.js')>();
  return {
    ...actual,
    runSessionWithRetry: vi.fn(async (input: { prompt: string }) => {
      script.research.push(input);
      const answer = input.prompt.startsWith('HOUSING') ? JSON.stringify([finding]) : 'Region brief.';
      return { resultText: answer, succeeded: true, transcript: Buffer.from('t'), usage: { input_tokens: 1, output_tokens: 1 } };
    }),
    runSession: vi.fn(async (input: Record<string, unknown>) => {
      script.verifier.push(input);
      return { resultText: '{"content_supported":"pass"}', succeeded: true, transcript: Buffer.from('v'), usage: { input_tokens: 1, output_tokens: 1 } };
    }),
  };
});
vi.mock('@deep-fryer/research', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-fryer/research')>();
  return {
    ...actual,
    // The constants after a change: no planned run may pick these up.
    VERIFIER_MAX_TURNS: 3,
    DEFAULT_SESSION_MAX_TURNS: 5,
    AUDIT_MAX_TURNS: 7,
    deterministicChecks: (raw: unknown, config: Parameters<typeof actual.deterministicChecks>[1], slug: string) =>
      actual.deterministicChecks(raw, config, slug, async () => true),
  };
});
vi.mock('../research-audit.js', () => ({ auditResearchRun: vi.fn(async () => ({})) }));
vi.mock('../storage.js', () => ({ tenantStorage: vi.fn(async () => ({ get: vi.fn(async () => Buffer.from('captured exhibit')) })) }));
vi.mock('../notify.js', () => ({ notifyRunFinished: vi.fn(async () => {}) }));

const finding = {
  kind: 'indicator',
  indicator_slug: 'cost-burdened-renters',
  name: 'Cost-burdened renters',
  value: 42,
  unit: '%',
  year: new Date().getFullYear() - 1,
  target: 30,
  level_pct: 40,
  scoring: { threshold_ref: 'x.housing', function: 'lower_is_better', inputs: { value: 42, target: 30 }, worked_math: 'w' },
  source: 'City statistics office',
  source_url: 'https://stats.example.gov/housing',
  source_tier: 1,
  evidence: { snapshot_path: 'evidence/housing.png', captured_at: '2026-10-01T00:00:00Z' },
  confidence: 'high',
  geographic_scale: 'city',
};

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const helpers = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } } as unknown as JobHelpers;

describe.skipIf(!hasDb)('a run keeps the strategy it was planned with (Postgres, scripted sessions)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeEach(() => {
    script.research.length = 0;
    script.verifier.length = 0;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  async function seed(recorded: Partial<ResearchPlan>) {
    const m = await import('@deep-fryer/db');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const db = m.getDb();
    // Findings are immutable (a trigger refuses their deletion), so the run
    // and its throwaway portrait stay, as in the other research-apply tests.
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Strategy City' });
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
          ],
          config_hash: 'h',
          plugin_version: 'test',
          ...recorded,
        },
        configSnapshot: defaultPortraitConfig('Strategy City', 'The Strategy City municipal boundary'),
        appliedAt: new Date(),
        funding: 'plan',
      })
      .returning();
    return run!;
  }

  it('runs a planned deep v1 run on its own caps and page reader after the constants change', async () => {
    const { planStrategy, VERIFIER_MAX_TURNS } = await import('@deep-fryer/research');
    expect(VERIFIER_MAX_TURNS).toBe(3);
    const recorded = planStrategy('deep@1');
    expect(recorded.caps.verifier_max_turns).toBe(12);
    const run = await seed(recorded);

    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);

    const reader = 'claude-haiku-4-5-20251001';
    expect(script.research).toHaveLength(2);
    for (const session of script.research) {
      expect(session).toMatchObject({ model: 'claude-opus-5', maxTurns: 60, pageReaderModel: reader });
    }
    expect(script.research[1]).toMatchObject({ scoutModel: 'claude-sonnet-5' });
    expect(script.verifier).toHaveLength(1);
    expect(script.verifier[0]).toMatchObject({ model: 'claude-opus-5', maxTurns: 12, pageReaderModel: reader });

    const { auditResearchRun } = await import('../research-audit.js');
    expect(auditResearchRun).toHaveBeenLastCalledWith(expect.objectContaining({ id: run.id }), helpers, {
      apiKey: null, verifierModel: 'claude-opus-5', maxTurns: 16, pageReaderModel: reader,
    });
  });

  it('runs a plan that recorded no strategy on the worker’s constants and settings, as before', async () => {
    const run = await seed({});
    const { researchApply } = await import('./research-apply.js');
    await researchApply({ runId: run.id }, helpers);
    for (const session of script.research) {
      expect(session).not.toHaveProperty('maxTurns');
      expect(session).not.toHaveProperty('pageReaderModel');
      expect(session).not.toHaveProperty('model');
    }
    expect(script.verifier[0]).toMatchObject({ maxTurns: 3 });
    expect(script.verifier[0]).not.toHaveProperty('pageReaderModel');
  });
});
