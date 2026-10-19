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
import { workerRunners } from './runners.js';

describe('worker runners', () => {
  it('registers every queued task exactly once, with alerts and housekeeping on runners of their own', () => {
    const [research, alerts, housekeeping, ...rest] = workerRunners('postgres://x', 2);
    expect(rest).toEqual([]);
    expect(Object.keys(research!.taskList!).sort()).toEqual([APPLY_TASK, POLICY_SWEEP_TASK, POLICY_TASK].sort());
    expect(research!.concurrency).toBe(2);
    expect(research!.crontab).toBe(POLICY_SWEEP_CRONTAB);
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
