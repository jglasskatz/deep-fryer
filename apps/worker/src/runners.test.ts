import { describe, expect, it } from 'vitest';
import { ALERTS_CRONTAB, ALERTS_TASK, APPLY_TASK, POLICY_SWEEP_CRONTAB, POLICY_SWEEP_TASK, POLICY_TASK } from '@deep-fryer/research';
import { workerRunners } from './runners.js';

describe('worker runners', () => {
  it('registers every queued task exactly once, with alerts on their own runner', () => {
    const [research, alerts] = workerRunners('postgres://x', 2);
    expect(Object.keys(research!.taskList!).sort()).toEqual([APPLY_TASK, POLICY_SWEEP_TASK, POLICY_TASK].sort());
    expect(research!.concurrency).toBe(2);
    expect(research!.crontab).toBe(POLICY_SWEEP_CRONTAB);
    expect(Object.keys(alerts!.taskList!)).toEqual([ALERTS_TASK]);
    expect(alerts!.crontab).toBe(ALERTS_CRONTAB);
    expect(alerts!.concurrency).toBe(1);
  });
});
