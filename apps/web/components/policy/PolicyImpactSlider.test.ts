import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  clampSliderProgress,
  interpolatePolicyLevels,
  NYC_BASELINE,
  POLICY_SLIDER_CASES,
  POLICY_SLIDER_COLOURS,
  SANTA_CRUZ_BASELINE,
} from './policy-slider-data';
import { PolicyImpactSlider } from './PolicyImpactSlider';

vi.stubGlobal('React', React);

describe('policy slider dataset and interpolation', () => {
  it('covers the five researched Santa Cruz and NYC policies with sources, caveats, and metric alignment', () => {
    expect(POLICY_SLIDER_CASES.map((p) => p.id)).toEqual([
      'sc-water-rationing',
      'nyc-clean-heat',
      'sc-adu-reform',
      'nyc-right-to-counsel',
      'nyc-universal-school-meals',
    ]);
    for (const item of POLICY_SLIDER_CASES) {
      expect(item.baseline.length).toBeGreaterThanOrEqual(21);
      expect(item.impacts.length).toBeGreaterThanOrEqual(1);
      expect(item.doughnutMetric.trim().length).toBeGreaterThan(10);
      expect(item.caveat.trim().length).toBeGreaterThan(20);
      expect(item.source.url).toMatch(/^https:\/\//);
      expect(item.source.title.trim().length).toBeGreaterThan(10);
      const slugs = new Set(item.baseline.map((d) => d.slug));
      for (const impact of item.impacts) {
        expect(slugs.has(impact.slug)).toBe(true);
      }
    }
    expect(SANTA_CRUZ_BASELINE.length).toBe(22);
    expect(NYC_BASELINE.length).toBe(21);
  });

  it('clamps slider progress cleanly to 0..100', () => {
    expect(clampSliderProgress(-20)).toBe(0);
    expect(clampSliderProgress(0)).toBe(0);
    expect(clampSliderProgress(49.6)).toBe(50);
    expect(clampSliderProgress(140)).toBe(100);
    expect(clampSliderProgress(Number.NaN)).toBe(0);
  });

  it('moves wedges ONLY on direct Doughnut-metric matches and holds proxy/output studies at baseline', () => {
    // Direct match 1: Santa Cruz Water Rationing (residential gpcd: ~64 -> 47 vs 55 gpcd target)
    const water = POLICY_SLIDER_CASES.find((p) => p.id === 'sc-water-rationing')!;
    const before = interpolatePolicyLevels(water, 0);
    const mid = interpolatePolicyLevels(water, 50);
    const after = interpolatePolicyLevels(water, 100);

    const freshBefore = before.find((d) => d.slug === 'freshwater-withdrawals')!;
    const freshMid = mid.find((d) => d.slug === 'freshwater-withdrawals')!;
    const freshAfter = after.find((d) => d.slug === 'freshwater-withdrawals')!;

    expect(freshBefore.level).toBe(50);
    expect(freshBefore.colour).toBe(POLICY_SLIDER_COLOURS.focus);
    expect(freshMid.level).toBe(11);
    expect(freshMid.colour).toBe(POLICY_SLIDER_COLOURS.improves);
    expect(freshAfter.level).toBe(-29);
    expect(freshAfter.colour).toBe(POLICY_SLIDER_COLOURS.improves);

    // Santa Cruz Extreme Heat is scored against CDC EJI Climate Burden quintiles;
    // genuine data gaps (Nitrogen & Phosphorus) stay NaN without inventing a score.
    const heat = after.find((d) => d.slug === 'extreme-heat')!;
    expect(heat.level).toBe(33.6);
    const nitrogen = after.find((d) => d.slug === 'nitrogen-phosphorus-loading')!;
    expect(nitrogen.level).toBe('NaN');
    expect(nitrogen.colour).toBeNull();

    // Direct match 2: NYC Clean Heat (PM2.5 µg/m³ moves; Health stays held at baseline 136).
    const cleanHeat = POLICY_SLIDER_CASES.find((p) => p.id === 'nyc-clean-heat')!;
    const airAfter = interpolatePolicyLevels(cleanHeat, 100).find((d) => d.slug === 'air-pollution')!;
    const healthAfter = interpolatePolicyLevels(cleanHeat, 100).find((d) => d.slug === 'health')!;
    const chem = interpolatePolicyLevels(cleanHeat, 100).find((d) => d.slug === 'chemical-pollution')!;
    expect(airAfter.level).toBe(36);
    expect(airAfter.colour).toBe(POLICY_SLIDER_COLOURS.improves);
    expect(healthAfter.level).toBe(136);
    expect(healthAfter.colour).toBe(POLICY_SLIDER_COLOURS.mixed);
    expect(chem.level).toBe('NaN');
    expect(chem.colour).toBe(POLICY_SLIDER_COLOURS.unscored);

    // Output-only policy: Santa Cruz ADU permits (28 -> 103) do NOT move the Housing homelessness wedge.
    const adu = POLICY_SLIDER_CASES.find((p) => p.id === 'sc-adu-reform')!;
    const aduBefore = interpolatePolicyLevels(adu, 0).find((d) => d.slug === 'housing')!;
    const aduAfter = interpolatePolicyLevels(adu, 100).find((d) => d.slug === 'housing')!;
    expect(aduBefore.level).toBe(150);
    expect(aduBefore.colour).toBe(POLICY_SLIDER_COLOURS.focus);
    expect(aduAfter.level).toBe(150);
    expect(aduAfter.colour).toBe(POLICY_SLIDER_COLOURS.mixed);

    // Adjacent-metric policy: NYC School Meals (lunch uptake) holds Food insecurity wedge at baseline 150.
    const meals = POLICY_SLIDER_CASES.find((p) => p.id === 'nyc-universal-school-meals')!;
    const foodBefore = interpolatePolicyLevels(meals, 0).find((d) => d.slug === 'food')!;
    const foodAfter = interpolatePolicyLevels(meals, 100).find((d) => d.slug === 'food')!;
    expect(foodBefore.level).toBe(150);
    expect(foodAfter.level).toBe(150);
    expect(foodAfter.colour).toBe(POLICY_SLIDER_COLOURS.mixed);
  });
});

describe('PolicyImpactSlider component SSR', () => {
  it('renders selector tabs, range slider, quick buttons, caveat, and primary source citation', () => {
    const html = renderToStaticMarkup(createElement(PolicyImpactSlider));
    expect(html).toContain('Compare before and after real local policies');
    expect(html).toContain('type="range"');
    expect(html).toContain('Before');
    expect(html).toContain('With policy');
    expect(html).toContain('SC · Water rationing');
    expect(html).toContain('SC · ADU reform');
    expect(html).toContain('NYC · Right to Counsel');
    expect(html).toContain('NYC · Clean Heat');
    expect(html).toContain('NYC · School meals');
    expect(html).toContain('Drought water rationing');
    expect(html).toContain('Scope &amp; caveat');
    expect(html).toContain('Primary source:');
    expect(html).toContain('https://www2.santacruzcountyca.gov/');
  });

  it('supports rendering any policy at 100% progress cleanly', () => {
    const html = renderToStaticMarkup(
      createElement(PolicyImpactSlider, {
        initialPolicyId: 'nyc-clean-heat',
        initialProgress: 100,
      }),
    );
    expect(html).toContain('Clean Heat oil phaseout');
    expect(html).toContain('Adjusted observational');
    expect(html).toContain('With policy (illustrative)');
    expect(html).toContain('https://pmc.ncbi.nlm.nih.gov/articles/PMC8653771/');
  });
});
