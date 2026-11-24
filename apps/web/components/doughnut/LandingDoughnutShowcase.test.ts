import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  LandingDoughnutShowcase,
  TRANSFORM_DIMENSIONS,
  describeTransformPhase,
  interpolatedTransformLevels,
  subProgress,
} from './LandingDoughnutShowcase';

vi.stubGlobal('React', React);

describe('LandingDoughnutShowcase', () => {
  it('renders the full-page scroll-driven doughnut transformation with light-line future SVG and CTAs', () => {
    const html = renderToStaticMarkup(createElement(LandingDoughnutShowcase, { selfServe: true }));
    expect(html).toContain('<canvas');
    expect(html).toContain('<svg');
    expect(html).toContain('What would it take to create a safe, just and thriving world?');
    expect(html).toContain('Make a portrait for your community today.');
    expect(html).toContain('Today · Overshoot &amp; shortfall');
    expect(html).toContain('Start a portrait');
    expect(html).toContain('Explore existing doughnuts');
    expect(html).toContain('Scroll to transform');
  });

  it('interpolates all 21 dimensions smoothly from overshoot/shortfall into the safe green ring', () => {
    expect(TRANSFORM_DIMENSIONS.length).toBe(21);
    const start = interpolatedTransformLevels(0);
    const mid = interpolatedTransformLevels(0.5);
    const end = interpolatedTransformLevels(1);

    expect(start.every((d) => d.level > 0)).toBe(true);
    expect(end.every((d) => d.level <= 0)).toBe(true);
    expect(mid.some((d, i) => d.level < start[i]!.level && d.level > end[i]!.level)).toBe(true);

    expect(subProgress(0, 0.2, 0.8)).toBe(0);
    expect(subProgress(0.5, 0.2, 0.8)).toBeCloseTo(0.5, 2);
    expect(subProgress(1, 0.2, 0.8)).toBe(1);

    expect(describeTransformPhase(0).tone).toBe('overshoot');
    expect(describeTransformPhase(0.5).tone).toBe('transition');
    expect(describeTransformPhase(1).tone).toBe('thriving');
  });
});
