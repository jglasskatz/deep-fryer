import { describe, expect, it } from 'vitest';
import { settledRunStatus } from './run-status.js';

describe('settledRunStatus', () => {
  it('keeps a partially successful run complete', () => {
    expect(settledRunStatus(['complete', 'failed', 'failed'])).toBe('complete');
  });
  it('fails a run in which every session failed', () => {
    expect(settledRunStatus(['failed', 'failed'])).toBe('failed');
  });
  it('fails a run that recorded no sessions at all', () => {
    expect(settledRunStatus([])).toBe('failed');
  });
});
