import { describe, expect, it } from 'vitest';
import { buildSeries, indicatorProgress, summarizeProgress, type ObservedPoint } from './progress.js';

const at = (iso: string) => new Date(iso);
const pt = (year: number, value: number, published = '2026-08-01'): ObservedPoint => ({
  year,
  value,
  publishedAt: at(published),
});

// LL148: 30% tree canopy by 2040.
const canopy = { target: 30, function: 'higher_is_better' as const, target_year: 2040 };
const nycBaseline = { baseline_year: 2025, baseline_label: 'January 2026' };

describe('buildSeries', () => {
  it('keeps one point per data year, latest publication winning', () => {
    const s = buildSeries([pt(2023, 10, '2026-01-01'), pt(2023, 11, '2026-06-01'), pt(2021, 9)]);
    expect(s).toEqual([
      { year: 2021, value: 9 },
      { year: 2023, value: 11 },
    ]);
  });
});

describe('indicatorProgress', () => {
  it('reports no_data without numeric history', () => {
    expect(indicatorProgress([], canopy).status).toBe('no_data');
  });

  it('reports the required pace when only the baseline exists (the choice ahead)', () => {
    const p = indicatorProgress([pt(2021, 23.4)], canopy, nycBaseline);
    expect(p.status).toBe('baseline_only');
    expect(p.baseline).toEqual({ year: 2021, value: 23.4 });
    // (30 − 23.4) / (2040 − 2021) ≈ 0.347 points a year
    expect(p.requiredAnnualChange).toBeCloseTo(0.347, 3);
  });

  it('is on track when the latest value beats the straight glidepath', () => {
    // Glidepath 2021→2040 from 23.4 to 30: expected 2025 ≈ 24.79.
    const p = indicatorProgress([pt(2021, 23.4), pt(2025, 25.0)], canopy);
    expect(p.status).toBe('on_track');
    expect(p.expectedNow).toBeCloseTo(24.789, 2);
    expect(p.changeSinceBaseline).toBeCloseTo(1.6, 6);
  });

  it('is off track when improving slower than the glidepath', () => {
    const p = indicatorProgress([pt(2021, 23.4), pt(2025, 24.0)], canopy);
    expect(p.status).toBe('off_track');
  });

  it('flags worsening ahead of glidepath math', () => {
    const p = indicatorProgress([pt(2021, 23.4), pt(2025, 22.9)], canopy);
    expect(p.status).toBe('worsening');
  });

  it('reports met once the target is reached', () => {
    expect(indicatorProgress([pt(2021, 23.4), pt(2025, 31)], canopy).status).toBe('met');
  });

  it('handles lower-is-better targets without a deadline as improving/worsening', () => {
    const deaths = { target: 0, function: 'lower_is_better' as const };
    expect(indicatorProgress([pt(2013, 299), pt(2025, 205)], deaths).status).toBe('improving');
    expect(indicatorProgress([pt(2013, 205), pt(2025, 299)], deaths).status).toBe('worsening');
    expect(indicatorProgress([pt(2013, 205), pt(2025, 205)], deaths).status).toBe('no_change');
  });

  it('anchors the baseline at the configured baseline year', () => {
    const p = indicatorProgress([pt(2019, 20), pt(2025, 23), pt(2027, 26)], canopy, nycBaseline);
    expect(p.baseline).toEqual({ year: 2025, value: 23 });
    expect(p.current).toEqual({ year: 2027, value: 26 });
    expect(p.baselineIsFallback).toBe(false);
  });

  it('falls back to the earliest point (and says so) when nothing predates the baseline year', () => {
    const p = indicatorProgress([pt(2027, 26)], canopy, nycBaseline);
    expect(p.baseline).toEqual({ year: 2027, value: 26 });
    expect(p.baselineIsFallback).toBe(true);
  });

  it('measures bands by distance to the nearer edge', () => {
    const band = { target: 0, function: 'band' as const, low: 10, high: 20 };
    expect(indicatorProgress([pt(2020, 30), pt(2024, 25)], band).status).toBe('improving');
    expect(indicatorProgress([pt(2020, 30), pt(2024, 15)], band).status).toBe('met');
  });

  it('keeps series and no_target status for indicators without a threshold', () => {
    const p = indicatorProgress([pt(2020, 1), pt(2024, 2)], null);
    expect(p.status).toBe('no_target');
    expect(p.series).toHaveLength(2);
  });
});

describe('summarizeProgress', () => {
  it('counts statuses with zeros for absent ones', () => {
    const s = summarizeProgress([{ status: 'met' }, { status: 'met' }, { status: 'off_track' }]);
    expect(s.met).toBe(2);
    expect(s.off_track).toBe(1);
    expect(s.on_track).toBe(0);
  });
});
