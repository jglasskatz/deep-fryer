import { describe, expect, it } from 'vitest';
import { classifyIndicatorChange, diffPortraits, type EraShape } from './progress.js';
import type { Indicator } from './types.js';

function ind(overrides: Partial<Indicator>): Indicator {
  return {
    name: 'Rent burden',
    value: 54.3,
    unit: '%',
    year: 2022,
    target: 30,
    level_pct: 81,
    source: 'ACS',
    source_url: 'https://example.gov',
    confidence: 'high',
    geographic_scale: 'city',
    ...overrides,
  };
}

describe('classifyIndicatorChange — the vintage rule', () => {
  it('year advanced and level improved → progress (arrows come from new data)', () => {
    expect(
      classifyIndicatorChange(ind({}), ind({ year: 2024, value: 48, level_pct: 60 })),
    ).toBe('progress');
  });
  it('year advanced and level worsened → regress', () => {
    expect(
      classifyIndicatorChange(ind({}), ind({ year: 2024, value: 60, level_pct: 100 })),
    ).toBe('regress');
  });
  it('same year, different value → revised — an edit is never progress', () => {
    expect(classifyIndicatorChange(ind({}), ind({ value: 51.0, level_pct: 70 }))).toBe('revised');
  });
  it('year advanced but unscored on one side → revised at best (no direction without scoring)', () => {
    expect(
      classifyIndicatorChange(ind({ level_pct: undefined }), ind({ year: 2024, value: 48 })),
    ).toBe('revised');
  });
  it('identical → unchanged; sub-noise level moves → unchanged', () => {
    expect(classifyIndicatorChange(ind({}), ind({}))).toBe('unchanged');
    expect(
      classifyIndicatorChange(ind({}), ind({ year: 2024, level_pct: 81.2 })),
    ).toBe('unchanged');
  });
  it('appearing / disappearing indicators → new / removed', () => {
    expect(classifyIndicatorChange(undefined, ind({}))).toBe('new');
    expect(classifyIndicatorChange(ind({}), undefined)).toBe('removed');
  });
});

describe('diffPortraits', () => {
  const era = (indicators: Indicator[], viz: number | null, slug = 'housing'): EraShape => ({
    slug,
    ring: 'social',
    viz_level: viz,
    data: {
      name: 'Housing',
      icon: '',
      description: '',
      context: '',
      indicators,
      actions: [],
    },
  });

  it('matches dimensions by slug and indicators by name; computes viz delta', () => {
    const from = [era([ind({})], 2)];
    const to = [era([ind({ year: 2024, value: 48, level_pct: 60 })], 1)];
    const [d] = diffPortraits(from, to);
    expect(d!.vizDelta).toBe(-1);
    expect(d!.indicators[0]!.kind).toBe('progress');
  });

  it('handles dimensions that appear or disappear between eras (archived wedges)', () => {
    const from = [era([ind({})], 2, 'ozone-depletion')];
    const to = [era([ind({})], 2, 'extreme-heat')];
    const deltas = diffPortraits(from, to);
    const ozone = deltas.find((d) => d.slug === 'ozone-depletion')!;
    const heat = deltas.find((d) => d.slug === 'extreme-heat')!;
    expect(ozone.indicators[0]!.kind).toBe('removed');
    expect(ozone.toViz).toBeNull();
    expect(heat.indicators[0]!.kind).toBe('new');
  });
});
