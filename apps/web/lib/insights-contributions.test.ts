import { describe, expect, it } from 'vitest';
import { insightContributions } from './insights-contributions';
import type { PublishedPortrait } from './portrait';
import type { Indicator } from '@deep-fryer/core';
const indicator = (value: number | null, extras: Partial<Indicator> = {}): Indicator => ({ name: 'Traffic deaths', value, unit: 'deaths', year: 2025, target: 0, source: 'Official statistics', source_url: 'https://example.gov', confidence: 'high', geographic_scale: 'city', scoring: { threshold_ref: 'peace-justice.traffic-deaths', function: 'lower_is_better', inputs: {}, worked_math: '' }, ...extras });
const portrait = (value: number | null, extras: Partial<Indicator> = {}): PublishedPortrait => ({ tenant: { slug: '', name: '', region: null, population: null, description: null, branding: null }, dimensions: [{ slug: 'peace-justice', ring: 'social', canonical_slug: null, display_order: 0, viz_level: null, data: { name: 'Peace', icon: '', description: '', context: '', indicators: [indicator(value, extras)], actions: [] }, published_at: null, version_num: 1 }] });
const members = ['whole', 'a', 'b'].map(slug => ({ slug, name: slug }));
const rows = (a = portrait(39), b = portrait(63), additive = ['traffic-deaths']) => insightContributions(members, new Map([['whole', portrait(105)], ['a', a], ['b', b]]), 'whole', 'peace-justice', additive);
describe('additive Insights contribution stacks', () => {
  it('sums comparable member counts, preserving the independently published whole', () => {
    expect(rows()[0]).toMatchObject({ total: 102, cityValue: 105, unavailable: null });
    expect(rows()[0]?.parts.map(part => part.value)).toEqual([39, 63]);
  });
  it('does not turn a missing, regional, different-year or different-unit member into a partial total', () => {
    for (const missing of [portrait(null), portrait(63, { geographic_scale: 'regional' }), portrait(63, { year: 2024 }), portrait(63, { unit: 'deaths per 100,000' })]) {
      expect(rows(portrait(39), missing)[0]?.total).toBeNull();
      expect(rows(portrait(39), missing)[0]?.unavailable).toContain('Not combined');
    }
  });
  it('never infers additivity from a count-like name or unit', () => {
    expect(rows(portrait(39), portrait(63), [])).toEqual([]);
  });
});
