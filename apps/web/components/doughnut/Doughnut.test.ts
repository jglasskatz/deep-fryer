import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { en } from '@/lib/i18n/messages/en';
import { escapeUnfries } from '@/lib/theme';
import { Doughnut, dismissesTooltip, doughnutPixelRatio } from './Doughnut';

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const dim = (slug: string, ring: 'social' | 'ecological') => ({ slug, ring, name: slug, viz_level: 0 });

describe('Doughnut', () => {
  it('server-renders a square canvas, so nothing below it moves when the renderer takes over', () => {
    // Without width/height a canvas lays out at 300×150 until the client sizes it.
    const html = renderToStaticMarkup(
      createElement(Doughnut, {
        social: [dim('food', 'social')],
        ecological: [dim('climate-change', 'ecological')],
        size: 720,
        labels: doughnutLabels(en),
      }),
    );
    const canvas = /<canvas[^>]*>/.exec(html)?.[0] ?? '';
    expect(canvas).toContain('width="720"');
    expect(canvas).toContain('height="720"');
  });

  it('draws at the screen density, capped at 3, never below 1', () => {
    expect(doughnutPixelRatio(1)).toBe(1);
    expect(doughnutPixelRatio(2.625)).toBe(2.625);
    expect(doughnutPixelRatio(4)).toBe(3);
    expect(doughnutPixelRatio(0.5)).toBe(1);
    expect(doughnutPixelRatio(undefined)).toBe(1);
    expect(doughnutPixelRatio(Number.NaN)).toBe(1);
  });

  it('hides its hover tooltip on an Escape nothing else used, and that Escape does not also un-fry the page', () => {
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: false })).toBe(true);
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: true })).toBe(false);
    expect(dismissesTooltip({ key: 'Escape', defaultPrevented: false, isComposing: true })).toBe(false);
    expect(dismissesTooltip({ key: 'Enter', defaultPrevented: false })).toBe(false);
    // The component calls preventDefault on the Escape it uses; DeepFryLayer then leaves it.
    expect(escapeUnfries({ key: 'Escape', defaultPrevented: true, target: null })).toBe(false);
  });
});
