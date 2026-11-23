import { describe, expect, it } from 'vitest';
import { frameworkDimension } from '@deep-fryer/contract';
import { WHOLE_DIMENSION_GAP, type DimensionData } from '@deep-fryer/core';
import { plannedIndicatorsForDimension } from './planned-indicators';

const housing = frameworkDimension('housing')!;
const ocean = frameworkDimension('ocean-acidification')!;

const baseData = (over: Partial<DimensionData> = {}): DimensionData => ({
  name: 'Housing',
  icon: '',
  description: '',
  context: '',
  indicators: [],
  actions: [],
  ...over,
});

describe('plannedIndicatorsForDimension (P0.1 slug integrity & gap retention)', () => {
  it('uses framework defaults for an unversioned dimension', () => {
    expect(plannedIndicatorsForDimension(null, housing)).toEqual(housing.indicators);
  });

  it('preserves ind.key instead of mangling framework slugs from display names', () => {
    const fwInd = housing.indicators[0]!;
    const latest = {
      data: baseData({
        indicators: [
          {
            key: fwInd.slug,
            name: 'Renter households paying over 30% of income on housing',
            value: 52,
            unit: fwInd.unit,
            year: 2024,
            target: 30,
            source: 'ACS',
            source_url: 'https://data.census.gov/table/x',
            confidence: 'high',
            geographic_scale: 'city',
          },
        ],
      }),
    };
    const planned = plannedIndicatorsForDimension(latest, housing);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.slug).toBe(fwInd.slug);
    expect(planned[0]!.threshold_ref).toBe(fwInd.threshold_ref);
  });

  it('assigns framework slugs to legacy unkeyed rows matching by name', () => {
    const fwInd = housing.indicators[0]!;
    const latest = {
      data: baseData({
        indicators: [
          {
            name: fwInd.name,
            value: 44,
            unit: fwInd.unit,
            year: 2024,
            target: 30,
            source: 'ACS',
            source_url: 'https://data.census.gov/table/x',
            confidence: 'high',
            geographic_scale: 'city',
          },
        ],
      }),
    };
    const planned = plannedIndicatorsForDimension(latest, housing);
    expect(planned[0]!.slug).toBe(fwInd.slug);
  });

  it('re-includes indicators stored in latest.data.gaps so approved gaps are never permanently erased', () => {
    const first = housing.indicators[0]!;
    const second = housing.indicators[1]!;
    const latest = {
      data: baseData({
        indicators: [
          {
            key: first.slug,
            name: first.name,
            value: 48,
            unit: first.unit,
            year: 2024,
            target: 30,
            source: 'ACS',
            source_url: 'https://data.census.gov/table/x',
            confidence: 'high',
            geographic_scale: 'city',
          },
        ],
        gaps: [
          {
            indicator: second.slug,
            reason: 'No local count published',
            scales_tried: ['city'],
            searched_at: '2026-10-01T00:00:00Z',
          },
          {
            indicator: 'custom-eviction-gap',
            reason: 'Court records unavailable',
            scales_tried: ['city'],
            searched_at: '2026-10-01T00:00:00Z',
          },
        ],
      }),
    };
    const planned = plannedIndicatorsForDimension(latest, housing);
    expect(planned.map((i) => i.slug)).toEqual([first.slug, second.slug, 'custom-eviction-gap']);
    expect(planned[1]).toEqual(second);
  });

  it('re-includes framework indicators when an entire dimension was approved as a whole-dimension gap', () => {
    const latest = {
      data: baseData({
        name: ocean.name,
        indicators: [],
        gaps: [
          {
            indicator: WHOLE_DIMENSION_GAP,
            reason: 'No municipal series',
            scales_tried: ['city'],
            searched_at: '2026-10-01T00:00:00Z',
          },
        ],
      }),
    };
    expect(plannedIndicatorsForDimension(latest, ocean)).toEqual(ocean.indicators);
  });

  it('keeps an explicitly emptied indicator list empty when there are no gaps', () => {
    const latest = { data: baseData({ indicators: [] }) };
    expect(plannedIndicatorsForDimension(latest, housing)).toEqual([]);
  });
});
