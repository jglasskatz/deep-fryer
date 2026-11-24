import { describe, expect, it } from 'vitest';
import {
  ALERTS_CRONTAB,
  ALERTS_TASK,
  APPLY_TASK,
  POLICY_SWEEP_CRONTAB,
  POLICY_SWEEP_TASK,
  POLICY_TASK,
  PRIVACY_SWEEP_CRONTAB,
  PRIVACY_SWEEP_TASK,
} from '@deep-fryer/research';
import {
  DEFAULT_MAX_ACTIVE_SESSIONS,
  POLICY_RUNNER_CONCURRENCY,
  SessionSemaphore,
  parseMaxActiveSessions,
  workerRunners,
} from './runners.js';

describe('worker runners', () => {
  it('registers every queued task once with policy_analyze isolated onto its own concurrency-2 runner', () => {
    const [research, policy, alerts, housekeeping, ...rest] = workerRunners('postgres://x', 2);
    expect(rest).toEqual([]);
    // Portrait builds run strictly on the research runner so 90-second policy scans never queue behind them.
    expect(Object.keys(research!.taskList!)).toEqual([APPLY_TASK]);
    expect(research!.concurrency).toBe(2);
    expect(research!.crontab).toBeUndefined();

    // Dedicated policy runner handles policy_analyze + policy_sweep at concurrency 2.
    expect(Object.keys(policy!.taskList!).sort()).toEqual([POLICY_SWEEP_TASK, POLICY_TASK].sort());
    expect(policy!.concurrency).toBe(POLICY_RUNNER_CONCURRENCY);
    expect(policy!.concurrency).toBe(2);
    expect(policy!.crontab).toBe(POLICY_SWEEP_CRONTAB);

    expect(Object.keys(alerts!.taskList!)).toEqual([ALERTS_TASK]);
    expect(alerts!.crontab).toBe(ALERTS_CRONTAB);
    expect(alerts!.concurrency).toBe(1);

    // The privacy notice promises a quarter-hourly sweep of expired sign-in records.
    expect(Object.keys(housekeeping!.taskList!)).toEqual([PRIVACY_SWEEP_TASK]);
    expect(housekeeping!.crontab).toBe(PRIVACY_SWEEP_CRONTAB);
    expect(PRIVACY_SWEEP_CRONTAB).toMatch(/^\*\/15 \* \* \* \* privacy_sweep /);
    expect(housekeeping!.concurrency).toBe(1);
  });
});

describe('MAX_ACTIVE_SESSIONS semaphore (P2.2)', () => {
  it('parses MAX_ACTIVE_SESSIONS with default 6 and rejects invalid values cleanly', () => {
    expect(DEFAULT_MAX_ACTIVE_SESSIONS).toBe(6);
    expect(parseMaxActiveSessions(undefined)).toEqual({ value: 6, valid: true });
    expect(parseMaxActiveSessions('')).toEqual({ value: 6, valid: true });
    expect(parseMaxActiveSessions(' 10 ')).toEqual({ value: 10, valid: true });
    for (const bad of ['0', '-1', '2.5', 'six', 'NaN']) {
      expect(parseMaxActiveSessions(bad)).toEqual({ value: 6, valid: false });
    }
  });

  it('bounds total concurrent tasks across jobs to maxPermits and releases cleanly on error', async () => {
    const sem = new SessionSemaphore(2);
    let inFlight = 0;
    let peak = 0;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      sem.run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        try {
          if (i === 2) throw new Error('boom');
          return i;
        } finally {
          inFlight--;
        }
      }).catch((e: Error) => e.message),
    );

    const results = await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(sem.activeCount).toBe(0);
    expect(sem.waitingCount).toBe(0);
    expect(results).toEqual([0, 1, 'boom', 3, 4, 5]);
  });
});
