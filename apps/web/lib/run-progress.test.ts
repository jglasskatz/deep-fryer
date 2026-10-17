import { describe, expect, it } from 'vitest';
import type { PlannedSession } from '@deep-fryer/core';
import {
  alreadyAppliedMessage,
  formatDuration,
  remainingEstimateMs,
  runInProgress,
  runPhase,
  runProgress,
  sessionDurationMs,
  type SessionRow,
} from './run-progress';

const spec = (kind: PlannedSession['kind'], slug?: string): PlannedSession => ({
  kind,
  ...(slug ? { dimension_slug: slug } : {}),
  prompt: 'p',
  tool_allowlist: ['WebSearch'],
  output_schema_ref: 'finding',
  config_hash: 'h',
});

/** A plan of the region context plus `n` dimensions d0…d(n-1). */
const plan = (n: number) => [spec('region_context'), ...Array.from({ length: n }, (_, i) => spec('dimension', `d${i}`))];
const slugById = new Map(Array.from({ length: 30 }, (_, i) => [`id-${i}`, `d${i}`]));
const t = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 12, 0) + minutes * 60_000);

const row = (dim: number | 'region', status: string, start?: number, end?: number): SessionRow => ({
  id: `s-${dim}`,
  kind: dim === 'region' ? 'region_context' : 'dimension',
  dimensionId: dim === 'region' ? null : `id-${dim}`,
  status,
  startedAt: start === undefined ? null : t(start),
  completedAt: end === undefined ? null : t(end),
});

describe('runPhase', () => {
  it('tells a queued run (applied, not yet claimed) from one never applied', () => {
    expect(runPhase({ status: 'planned', appliedAt: null })).toBe('unapplied');
    expect(runPhase({ status: 'planned', appliedAt: t(0) })).toBe('queued');
    expect(runPhase({ status: 'running', appliedAt: t(0) })).toBe('running');
    expect(runPhase({ status: 'complete', appliedAt: t(0) })).toBe('complete');
    expect(runPhase({ status: 'failed', appliedAt: t(0) })).toBe('failed');
    expect(runInProgress('queued')).toBe(true);
    expect(runInProgress('running')).toBe(true);
    expect(runInProgress('unapplied')).toBe(false);
    expect(runInProgress('complete')).toBe(false);
  });
});

describe('alreadyAppliedMessage', () => {
  it('says where an applied run is in words, never its database status', () => {
    const queued = alreadyAppliedMessage({ status: 'planned', appliedAt: t(0) });
    expect(queued).toMatch(/already applied and is queued — it starts shortly/);
    expect(queued).toMatch(/Nothing was started twice/);
    expect(alreadyAppliedMessage({ status: 'running', appliedAt: t(0) })).toMatch(/is running now/);
    expect(alreadyAppliedMessage({ status: 'complete', appliedAt: t(0) })).toMatch(/already finished/);
    expect(alreadyAppliedMessage({ status: 'failed', appliedAt: t(0) })).toMatch(/run page says why/);
    for (const status of ['planned', 'running', 'complete', 'failed']) {
      expect(alreadyAppliedMessage({ status, appliedAt: t(0) })).not.toMatch(/status:/);
    }
  });
});

describe('runProgress', () => {
  it('chips every planned session and counts finished ones, failed included', () => {
    const p = runProgress(
      plan(4),
      [row('region', 'complete', 0, 2), row(0, 'complete', 2, 6), row(1, 'failed', 2, 3), row(2, 'running', 2)],
      slugById,
      'running',
    );
    expect(p.items.map((i) => [i.key, i.chip])).toEqual([
      ['region_context', 'done'],
      ['d0', 'done'],
      ['d1', 'failed'],
      ['d2', 'running'],
      ['d3', 'queued'],
    ]);
    expect(p).toMatchObject({ total: 5, finished: 3, done: 2, failed: 1, running: 1, queued: 1, notRun: 0 });
  });

  it('shows every session queued while the run waits for the worker', () => {
    const p = runProgress(plan(2), [], slugById, 'queued');
    expect(p.items.every((i) => i.chip === 'queued')).toBe(true);
    expect(p.finished).toBe(0);
  });

  it('marks sessions that never started as "did not run" once the run has settled', () => {
    const p = runProgress(plan(3), [row('region', 'failed', 0, 1), row(0, 'failed', 1, 2)], slugById, 'failed');
    expect(p.items.map((i) => i.chip)).toEqual(['failed', 'failed', 'not_run', 'not_run']);
    expect(p).toMatchObject({ finished: 2, failed: 2, notRun: 2 });
  });
});

describe('remainingEstimateMs', () => {
  it('offers nothing until a batch of dimension sessions has finished', () => {
    const p = runProgress(
      plan(10),
      [row('region', 'complete', 0, 2), row(0, 'complete', 2, 8), row(1, 'complete', 2, 9), row(2, 'running', 2)],
      slugById,
      'running',
    );
    expect(remainingEstimateMs(p, 'running', t(10))).toBeNull();
  });

  it('extrapolates from this run’s own pace: time since the first dimension started per finished session', () => {
    // Three at a time: three finished in the 6 minutes since the dimensions began → 2 min each, 7 left → 14 min.
    const p = runProgress(
      plan(10),
      [
        row('region', 'complete', 0, 2),
        row(0, 'complete', 2, 7),
        row(1, 'failed', 2, 7),
        row(2, 'complete', 2, 8),
        row(3, 'running', 7),
        row(4, 'running', 7),
        row(5, 'running', 8),
      ],
      slugById,
      'running',
    );
    expect(remainingEstimateMs(p, 'running', t(8))).toBe(14 * 60_000);
    // Never for a run that is not running, and never once nothing is left.
    expect(remainingEstimateMs(p, 'queued', t(8))).toBeNull();
    const done = runProgress(plan(3), [row(0, 'complete', 2, 4), row(1, 'complete', 2, 4), row(2, 'complete', 2, 5)], slugById, 'running');
    expect(remainingEstimateMs(done, 'running', t(6))).toBeNull();
  });
});

describe('durations', () => {
  it('measures a finished session and words a duration for staff', () => {
    expect(sessionDurationMs(row(0, 'complete', 2, 9))).toBe(7 * 60_000);
    expect(sessionDurationMs(row(0, 'running', 2))).toBeNull();
    expect(sessionDurationMs(null)).toBeNull();
    expect(formatDuration(20_000)).toBe('under a minute');
    expect(formatDuration(60_000)).toBe('1 minute');
    expect(formatDuration(12 * 60_000)).toBe('12 minutes');
    expect(formatDuration(60 * 60_000)).toBe('1 hour');
    expect(formatDuration(125 * 60_000)).toBe('2 hours 5 minutes');
  });
});
