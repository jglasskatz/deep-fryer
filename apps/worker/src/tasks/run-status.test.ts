import { describe, expect, it } from 'vitest';
import { settledRunStatus } from './run-status.js';

describe('settledRunStatus', () => {
  it('keeps a partially successful run complete when at least one dimension session completed', () => {
    expect(
      settledRunStatus([
        { kind: 'region_context', status: 'complete' },
        { kind: 'dimension', status: 'complete' },
        { kind: 'dimension', status: 'failed' },
      ]),
    ).toBe('complete');
  });

  it('fails a run where only region_context completed and all dimension sessions failed', () => {
    expect(
      settledRunStatus([
        { kind: 'region_context', status: 'complete' },
        { kind: 'dimension', status: 'failed' },
        { kind: 'dimension', status: 'failed' },
      ]),
    ).toBe('failed');
  });

  it('fails a run in which every session failed', () => {
    expect(
      settledRunStatus([
        { kind: 'region_context', status: 'failed' },
        { kind: 'dimension', status: 'failed' },
      ]),
    ).toBe('failed');
  });

  it('fails a run that recorded no sessions at all', () => {
    expect(settledRunStatus([])).toBe('failed');
  });
});
