import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reviewCardSessionIds } from './review-data';

describe('reviewCardSessionIds (dense-dimension chunk transcript mapping)', () => {
  it('preserves every chunk session ID from findings ordered by planSessionIndex without overwriting earlier chunks', () => {
    const findings = [
      { sessionId: 'sess-chunk-2' },
      { sessionId: 'sess-chunk-1' },
      { sessionId: 'sess-chunk-1' },
      { sessionId: 'sess-chunk-3' },
    ];
    const sessions = [
      { id: 'sess-chunk-3', planSessionIndex: 3, startedAt: new Date('2026-11-24T00:01:00Z') },
      { id: 'sess-chunk-1', planSessionIndex: 1, startedAt: new Date('2026-11-24T00:03:00Z') },
      { id: 'sess-chunk-2', planSessionIndex: 2, startedAt: new Date('2026-11-24T00:02:00Z') },
    ];
    expect(reviewCardSessionIds(findings, sessions)).toEqual([
      'sess-chunk-1',
      'sess-chunk-2',
      'sess-chunk-3',
    ]);
  });

  it('falls back to startedAt order for historical rows where planSessionIndex is null', () => {
    const findings = [{ sessionId: 'sess-b' }, { sessionId: 'sess-a' }];
    const sessions = [
      { id: 'sess-b', planSessionIndex: null, startedAt: new Date('2026-11-24T00:05:00Z') },
      { id: 'sess-a', planSessionIndex: null, startedAt: new Date('2026-11-24T00:01:00Z') },
    ];
    expect(reviewCardSessionIds(findings, sessions)).toEqual(['sess-a', 'sess-b']);
  });
});
