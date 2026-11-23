import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { RegionBriefCache, ResearchPlan, RunTokenUsage, SessionTokenUsage } from '@deep-fryer/core';
import { computeConfigHash, REGION_BRIEF_CACHE_TTL_MS, renderPlan } from '@deep-fryer/research';
import {
  acquireRunExecutionLock,
  extractRegionBriefFromTranscript,
  LOCK_RESEARCH_APPLY,
  persistTokenUsagePatch,
  Phase0RegionBriefError,
  planSessionResumeState,
  resolvePhase0RegionBrief,
  type ExistingSessionSnapshot,
} from './research-apply.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');
const configHash = computeConfigHash(config);

const usageOf = (model: string, input: number, output: number): SessionTokenUsage => ({
  input_tokens: input,
  output_tokens: output,
  model,
  by_model: {
    [model]: { input_tokens: input, output_tokens: output, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
  },
});

const fullPlan: ResearchPlan = renderPlan({
  config,
  dimensions: [
    {
      dimensionId: 'dim-housing',
      slug: 'housing',
      ring: 'social',
      name: 'Housing',
      indicators: [{ slug: 'cost-burdened-renters', name: 'Cost-burdened renters', unit: '%', threshold_ref: 'housing.cost-burdened-renters' }],
    },
    {
      dimensionId: 'dim-energy',
      slug: 'energy',
      ring: 'social',
      name: 'Energy',
      indicators: [{ slug: 'energy-burden', name: 'Energy burden', unit: '%', threshold_ref: 'energy.energy-burden' }],
    },
  ],
  strategy: 'hybrid',
});

describe('P1.3 — Resumable checkpointing, live usage persistence, advisory locks, and fail-loud Phase 0', () => {
  it('planSessionResumeState skips completed sessions with persisted findings and flags interrupted running rows', () => {
    const dimIdBySlug = new Map([
      ['housing', 'dim-housing'],
      ['energy', 'dim-energy'],
    ]);
    const existing: ExistingSessionSnapshot[] = [
      {
        id: 'sess-region',
        kind: 'region_context',
        dimensionId: null,
        planSessionIndex: 0,
        status: 'complete',
        transcript: gzipSync(JSON.stringify({ type: 'result', result: 'Santa Cruz region brief from transcript' })),
        startedAt: new Date('2026-11-24T00:00:00Z'),
      },
      {
        id: 'sess-housing-done',
        kind: 'dimension',
        dimensionId: 'dim-housing',
        planSessionIndex: 1,
        status: 'complete',
        transcript: gzipSync('{"type":"done"}'),
        startedAt: new Date('2026-11-24T00:02:00Z'),
      },
      {
        id: 'sess-energy-interrupted',
        kind: 'dimension',
        dimensionId: 'dim-energy',
        planSessionIndex: 2,
        status: 'running',
        transcript: null,
        startedAt: new Date('2026-11-24T00:03:00Z'),
      },
    ];
    const cache: RegionBriefCache = {
      brief: 'Santa Cruz cached brief from tenant row',
      config_hash: fullPlan.config_hash,
      cached_at: '2026-11-24T00:01:00Z',
      run_id: 'run-resume-1',
    };

    const resume = planSessionResumeState({
      runId: 'run-resume-1',
      plan: fullPlan,
      existingSessions: existing,
      findingCountBySessionId: new Map([['sess-housing-done', 1]]),
      dimIdBySlug,
      tenantRegionBriefCache: cache,
    });

    expect([...resume.completedPlanIndices].sort()).toEqual([0, 1]);
    expect(resume.interruptedSessionIds).toEqual(['sess-energy-interrupted']);
    expect(resume.recoveredRegionBrief).toBe('Santa Cruz cached brief from tenant row');
  });

  it('planSessionResumeState does not skip a complete dimension session with zero persisted findings when indicators were planned', () => {
    const dimIdBySlug = new Map([
      ['housing', 'dim-housing'],
      ['energy', 'dim-energy'],
    ]);
    const existing: ExistingSessionSnapshot[] = [
      {
        id: 'sess-region',
        kind: 'region_context',
        dimensionId: null,
        planSessionIndex: 0,
        status: 'complete',
        transcript: gzipSync(JSON.stringify({ type: 'result', result: 'Recovered from transcript' })),
        startedAt: new Date('2026-11-24T00:00:00Z'),
      },
      {
        id: 'sess-housing-empty',
        kind: 'dimension',
        dimensionId: 'dim-housing',
        planSessionIndex: 1,
        status: 'complete',
        transcript: gzipSync('{}'),
        startedAt: new Date('2026-11-24T00:02:00Z'),
      },
    ];

    const resume = planSessionResumeState({
      runId: 'run-resume-2',
      plan: fullPlan,
      existingSessions: existing,
      findingCountBySessionId: new Map(), // 0 findings persisted for sess-housing-empty
      dimIdBySlug,
      tenantRegionBriefCache: null,
    });

    // Phase 0 recovered from transcript fallback; housing NOT skipped because 0 findings were persisted.
    expect([...resume.completedPlanIndices]).toEqual([0]);
    expect(resume.recoveredRegionBrief).toBe('Recovered from transcript');
    expect(extractRegionBriefFromTranscript(existing[0]!.transcript)).toBe('Recovered from transcript');
  });

  it('resolvePhase0RegionBrief fails loudly when Phase 0 fails and never injects "(no region brief produced)"', async () => {
    const recordedPatches: RunTokenUsage[] = [];
    const updates: { rowId: string; status: string }[] = [];
    const saveRegionBriefCache = vi.fn();

    await expect(
      resolvePhase0RegionBrief(
        {
          runId: 'run-fail-p0',
          plan: fullPlan,
          tenantRegionBriefCache: null,
          resumeState: { completedPlanIndices: new Set(), interruptedSessionIds: [], recoveredRegionBrief: null },
        },
        {
          createSessionRow: vi.fn(async () => ({ id: 'sess-p0-fail' })),
          runRegionSession: vi.fn(async () => ({
            resultText: '',
            succeeded: false,
            transcript: gzipSync('{"type":"session_error","message":"timeout"}'),
            usage: usageOf('claude-sonnet-5', 1200, 150),
          })),
          recordUsage: async (patch) => {
            recordedPatches.push(patch);
          },
          updateSessionRow: async (rowId, update) => {
            updates.push({ rowId, status: update.status });
          },
          saveRegionBriefCache,
        },
      ),
    ).rejects.toBeInstanceOf(Phase0RegionBriefError);

    expect(recordedPatches).toEqual([{ 'sess-p0-fail': usageOf('claude-sonnet-5', 1200, 150) }]);
    expect(updates).toEqual([{ rowId: 'sess-p0-fail', status: 'failed' }]);
    expect(saveRegionBriefCache).not.toHaveBeenCalled();
  });

  it('resolvePhase0RegionBrief fails loudly when Phase 0 succeeds with empty text and records an error frame', async () => {
    let savedTranscript: Buffer | null = null;
    const saveRegionBriefCache = vi.fn();

    await expect(
      resolvePhase0RegionBrief(
        {
          runId: 'run-empty-p0',
          plan: fullPlan,
          tenantRegionBriefCache: null,
          resumeState: { completedPlanIndices: new Set(), interruptedSessionIds: [], recoveredRegionBrief: null },
        },
        {
          createSessionRow: vi.fn(async () => ({ id: 'sess-p0-empty' })),
          runRegionSession: vi.fn(async () => ({
            resultText: '   \n\t  ',
            succeeded: true,
            transcript: gzipSync('{"type":"result","result":""}'),
            usage: usageOf('claude-sonnet-5', 800, 10),
          })),
          recordUsage: vi.fn(async () => {}),
          updateSessionRow: async (_rowId, update) => {
            expect(update.status).toBe('failed');
            savedTranscript = update.transcript;
          },
          saveRegionBriefCache,
        },
      ),
    ).rejects.toThrow(/empty region brief/i);

    expect(saveRegionBriefCache).not.toHaveBeenCalled();
    expect(gunzipSync(savedTranscript!).toString('utf8')).toContain('empty region brief');
  });

  it('resolvePhase0RegionBrief persists region_brief_cache on clean Phase 0 completion and reuses cached brief on targeted re-runs', async () => {
    const now = new Date('2026-11-24T12:00:00Z');
    let persistedCache: RegionBriefCache | null = null;
    const recordedPatches: RunTokenUsage[] = [];

    const first = await resolvePhase0RegionBrief(
      {
        runId: 'run-full',
        plan: fullPlan,
        tenantRegionBriefCache: null,
        resumeState: { completedPlanIndices: new Set(), interruptedSessionIds: [], recoveredRegionBrief: null },
      },
      {
        createSessionRow: vi.fn(async (idx) => {
          expect(idx).toBe(0);
          return { id: 'sess-p0-ok' };
        }),
        runRegionSession: vi.fn(async () => ({
          resultText: '# Santa Cruz Context\nCoastal city in Monterey Bay.',
          succeeded: true,
          transcript: gzipSync('{"type":"result","result":"# Santa Cruz Context"}'),
          usage: usageOf('claude-sonnet-5', 2200, 450),
        })),
        recordUsage: async (patch) => {
          recordedPatches.push(patch);
        },
        updateSessionRow: vi.fn(async (_id, update) => {
          expect(update.status).toBe('complete');
        }),
        saveRegionBriefCache: async (cache) => {
          persistedCache = cache;
        },
        now: () => now,
      },
    );

    expect(first).toEqual({ brief: '# Santa Cruz Context\nCoastal city in Monterey Bay.', skipped: false });
    expect(recordedPatches).toEqual([{ 'sess-p0-ok': usageOf('claude-sonnet-5', 2200, 450) }]);
    expect(persistedCache).toEqual({
      brief: '# Santa Cruz Context\nCoastal city in Monterey Bay.',
      config_hash: configHash,
      cached_at: now.toISOString(),
      run_id: 'run-full',
    });

    // Targeted re-run plan omitting Phase 0 reuses cached_region_brief without spawning any Phase-0 session.
    const targetedPlan = renderPlan({
      config,
      dimensions: [
        {
          dimensionId: 'dim-housing',
          slug: 'housing',
          ring: 'social',
          name: 'Housing',
          indicators: [{ slug: 'cost-burdened-renters', name: 'Cost-burdened renters', unit: '%', threshold_ref: 'housing.cost-burdened-renters' }],
        },
      ],
      cachedRegionBrief: persistedCache!.brief,
    });
    const runRegionSession = vi.fn();
    const reused = await resolvePhase0RegionBrief(
      {
        runId: 'run-targeted',
        plan: targetedPlan,
        tenantRegionBriefCache: persistedCache,
        resumeState: { completedPlanIndices: new Set(), interruptedSessionIds: [], recoveredRegionBrief: null },
      },
      {
        createSessionRow: vi.fn(),
        runRegionSession,
        recordUsage: vi.fn(),
        updateSessionRow: vi.fn(),
        saveRegionBriefCache: vi.fn(),
        now: () => new Date(now.getTime() + REGION_BRIEF_CACHE_TTL_MS - 10_000),
      },
    );

    expect(reused).toEqual({ brief: persistedCache!.brief, skipped: true });
    expect(runRegionSession).not.toHaveBeenCalled();

    // If a plan omits Phase 0 AND carries no cached_region_brief AND tenant cache is stale, fail loudly!
    const brokenPlan: ResearchPlan = { ...targetedPlan, cached_region_brief: undefined };
    await expect(
      resolvePhase0RegionBrief(
        {
          runId: 'run-broken',
          plan: brokenPlan,
          tenantRegionBriefCache: persistedCache,
          resumeState: { completedPlanIndices: new Set(), interruptedSessionIds: [], recoveredRegionBrief: null },
        },
        {
          createSessionRow: vi.fn(),
          runRegionSession: vi.fn(),
          recordUsage: vi.fn(),
          updateSessionRow: vi.fn(),
          saveRegionBriefCache: vi.fn(),
          now: () => new Date(now.getTime() + REGION_BRIEF_CACHE_TTL_MS + 10_000),
        },
      ),
    ).rejects.toBeInstanceOf(Phase0RegionBriefError);
  });

  it('persistTokenUsagePatch issues an atomic JSONB merge update per stage and ignores empty patches', async () => {
    const where = vi.fn(async () => {});
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const fakeDb = { update } as unknown as Parameters<typeof persistTokenUsagePatch>[0];

    await persistTokenUsagePatch(fakeDb, 'run-1', {});
    expect(update).not.toHaveBeenCalled();

    const patch: RunTokenUsage = { 'sess-1': usageOf('claude-sonnet-5', 500, 80) };
    await persistTokenUsagePatch(fakeDb, 'run-1', patch);
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('acquireRunExecutionLock acquires and releases a session-level Postgres advisory lock and skips when contended', async () => {
    const calls: string[] = [];
    const releaseConn = vi.fn();
    const makeReserved = (locked: boolean) => {
      const fn = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join('?');
        calls.push(`${query.trim()}:${values.join(',')}`);
        if (query.includes('pg_try_advisory_lock')) return [{ locked }];
        return [];
      });
      return Object.assign(fn, { release: releaseConn });
    };

    // Acquired case: locks with LOCK_RESEARCH_APPLY and unlocks + releases on release().
    const reservedOk = makeReserved(true);
    const dbOk = { $client: { reserve: vi.fn(async () => reservedOk) } } as unknown as Parameters<
      typeof acquireRunExecutionLock
    >[0];
    const lock = await acquireRunExecutionLock(dbOk, 'run-lock-1');
    expect(lock.acquired).toBe(true);
    expect(releaseConn).not.toHaveBeenCalled();
    await lock.release();
    expect(releaseConn).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.includes('pg_try_advisory_lock') && c.includes(`${LOCK_RESEARCH_APPLY},run-lock-1`))).toBe(true);
    expect(calls.some((c) => c.includes('pg_advisory_unlock') && c.includes(`${LOCK_RESEARCH_APPLY},run-lock-1`))).toBe(true);

    // Contended case: returns acquired=false and releases reserved connection immediately.
    const releaseContended = vi.fn();
    const reservedBusy = Object.assign(
      vi.fn(async () => [{ locked: false }]),
      { release: releaseContended },
    );
    const dbBusy = { $client: { reserve: vi.fn(async () => reservedBusy) } } as unknown as Parameters<
      typeof acquireRunExecutionLock
    >[0];
    const lockBusy = await acquireRunExecutionLock(dbBusy, 'run-lock-1');
    expect(lockBusy.acquired).toBe(false);
    expect(releaseContended).toHaveBeenCalledTimes(1);
  });
});
