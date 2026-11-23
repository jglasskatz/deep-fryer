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
  it('covers the five researched Santa Cruz and NYC policies with sources and caveats', () => {
    expect(POLICY_SLIDER_CASES.map((p) => p.id)).toEqual([
      'sc-water-rationing',
      'sc-adu-reform',
      'nyc-right-to-counsel',
      'nyc-clean-heat',
      'nyc-universal-school-meals',
    ]);
    for (const item of POLICY_SLIDER_CASES) {
      expect(item.baseline.length).toBeGreaterThanOrEqual(21);
      expect(item.impacts.length).toBeGreaterThanOrEqual(1);
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

  it('interpolates scored ecological and social wedges smoothly without inventing unscored levels', () => {
    const water = POLICY_SLIDER_CASES.find((p) => p.id === 'sc-water-rationing')!;
    const before = interpolatePolicyLevels(water, 0);
    const mid = interpolatePolicyLevels(water, 50);
    const after = interpolatePolicyLevels(water, 100);

    const freshBefore = before.find((d) => d.slug === 'freshwater-withdrawals')!;
    const freshMid = mid.find((d) => d.slug === 'freshwater-withdrawals')!;
    const freshAfter = after.find((d) => d.slug === 'freshwater-withdrawals')!;

    expect(freshBefore.level).toBe(50);
    expect(freshBefore.colour).toBe(POLICY_SLIDER_COLOURS.focus);
    expect(freshMid.level).toBe(37);
    expect(freshMid.colour).toBe(POLICY_SLIDER_COLOURS.improves);
    expect(freshAfter.level).toBe(24);
    expect(freshAfter.colour).toBe(POLICY_SLIDER_COLOURS.improves);

    // Unscored baseline dimensions stay NaN and carry neutral unscored grey.
    const heat = after.find((d) => d.slug === 'extreme-heat')!;
    expect(heat.level).toBe('NaN');
    expect(heat.colour).toBe(POLICY_SLIDER_COLOURS.unscored);

    // ADU reform never invents a score for Santa Cruz's unscored Housing baseline.
    const adu = POLICY_SLIDER_CASES.find((p) => p.id === 'sc-adu-reform')!;
    const aduBefore = interpolatePolicyLevels(adu, 0).find((d) => d.slug === 'housing')!;
    const aduAfter = interpolatePolicyLevels(adu, 100).find((d) => d.slug === 'housing')!;
    expect(aduBefore.level).toBe('NaN');
    expect(aduBefore.colour).toBe(POLICY_SLIDER_COLOURS.focus);
    expect(aduAfter.level).toBe('NaN');
    expect(aduAfter.colour).toBe(POLICY_SLIDER_COLOURS.improves);

    // Inner social wedges capped at 100 on the renderer start moving immediately above 0.
    const meals = POLICY_SLIDER_CASES.find((p) => p.id === 'nyc-universal-school-meals')!;
    const foodBefore = interpolatePolicyLevels(meals, 0).find((d) => d.slug === 'food')!;
    const foodMid = interpolatePolicyLevels(meals, 50).find((d) => d.slug === 'food')!;
    const foodAfter = interpolatePolicyLevels(meals, 100).find((d) => d.slug === 'food')!;
    expect(foodBefore.level).toBe(150);
    expect(foodMid.level).toBe(91);
    expect(foodAfter.level).toBe(82);
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
