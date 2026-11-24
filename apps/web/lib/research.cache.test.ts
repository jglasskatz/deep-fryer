import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { RegionBriefCache } from '@deep-fryer/core';
import { computeConfigHash, REGION_BRIEF_CACHE_TTL_MS } from '@deep-fryer/research';

vi.mock('server-only', () => ({}));

import { mergeReviewerNotesWithHistoricalGuidance, resolveCachedRegionBrief } from './research';

describe('resolveCachedRegionBrief (targeted re-run Phase 0 caching)', () => {
  const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');
  const hash = computeConfigHash(config);
  const now = new Date('2026-11-24T12:00:00Z');
  const freshCache: RegionBriefCache = {
    brief: '## Santa Cruz region context\nMunicipal boundary, Santa Cruz County.',
    config_hash: hash,
    cached_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    run_id: 'run-prior',
  };

  it('reuses a matching cached brief younger than 30 days on targeted re-runs', () => {
    expect(resolveCachedRegionBrief(freshCache, config, true, now)).toBe(freshCache.brief);
  });

  it('does not reuse the cache on full runs (dimensionIds omitted)', () => {
    expect(resolveCachedRegionBrief(freshCache, config, false, now)).toBeUndefined();
  });

  it('invalidates the cache when config_hash changes (e.g. edited region or policy)', () => {
    const edited = defaultPortraitConfig('City of Santa Cruz', 'Updated municipal boundary including annex');
    expect(resolveCachedRegionBrief(freshCache, edited, true, now)).toBeUndefined();
  });

  it('invalidates the cache once it reaches 30 days old', () => {
    const stale: RegionBriefCache = {
      ...freshCache,
      cached_at: new Date(now.getTime() - REGION_BRIEF_CACHE_TTL_MS).toISOString(),
    };
    expect(resolveCachedRegionBrief(stale, config, true, now)).toBeUndefined();
  });
});

describe('mergeReviewerNotesWithHistoricalGuidance (review_labels feedback loop)', () => {
  const labels = [
    {
      findingId: 'finding-1',
      runId: 'run-1',
      dimensionSlug: 'housing',
      indicatorSlug: 'rent-burden',
      decision: 'reject' as const,
      cause: 'wrong_geography' as const,
      note: 'Used county total instead of City of Santa Cruz ACS table.',
      strategy: 'standard' as const,
      strategyVersion: 1,
      models: null,
      createdAt: new Date('2026-11-20T00:00:00Z'),
    },
  ];

  it('appends historical rejection guidance onto explicit reviewer notes', () => {
    const merged = mergeReviewerNotesWithHistoricalGuidance('Prefer 2024 ACS 5-year.', labels, 'housing');
    expect(merged).toContain('Prefer 2024 ACS 5-year.');
    expect(merged).toContain('Prior review feedback for housing');
    expect(merged).toContain('Wrong place or area');
  });

  it('emits historical guidance alone when no explicit reviewer note was passed', () => {
    const merged = mergeReviewerNotesWithHistoricalGuidance(undefined, labels, 'housing');
    expect(merged).toContain('Prior review feedback for housing');
  });

  it('leaves unrelated dimensions untouched', () => {
    expect(mergeReviewerNotesWithHistoricalGuidance(undefined, labels, 'water')).toBeUndefined();
    expect(mergeReviewerNotesWithHistoricalGuidance('Check municipal report.', labels, 'water')).toBe(
      'Check municipal report.',
    );
  });
});
