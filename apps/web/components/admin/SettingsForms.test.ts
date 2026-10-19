import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The save path is a server action; rendering never calls it.
vi.mock('@/lib/actions', () => ({ updateConfig: vi.fn() }));

import { SettingsForms } from './SettingsForms';

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

function render(): string {
  return renderToStaticMarkup(
    createElement(SettingsForms, {
      tenantSlug: 'nyc',
      region: null,
      sourcePriority: null,
      recency: null,
      scalePolicy: null,
      thresholdOverrides: null,
      reviewPolicy: null,
      retention: null,
      notifications: null,
      progress: null,
      features: null,
      translationRequestDays: 30,
    }),
  );
}

describe('SettingsForms JSON editors', () => {
  it('names each JSON textarea by its section heading and describes it by the section text', () => {
    const html = render();
    const textareas = [...html.matchAll(/<textarea[^>]*rows="12"[^>]*>/g)].map((t) => t[0]);
    expect(textareas).toHaveLength(3);
    const names = textareas.map((t) => {
      const labelledBy = /aria-labelledby="([^"]+)"/.exec(t)?.[1];
      const describedBy = /aria-describedby="([^"]+)"/.exec(t)?.[1];
      expect(labelledBy, t).toBeTruthy();
      expect(describedBy, t).toBeTruthy();
      // The ids point at the section's own heading and description.
      expect(html).toMatch(new RegExp(`<p id="${describedBy}"[^>]*>[^<]+</p>`));
      return new RegExp(`<h2 id="${labelledBy}"[^>]*>([^<]+)</h2>`).exec(html)?.[1];
    });
    expect(names).toEqual(['Source priority tiers', 'Geographic scale policy', 'Threshold overrides']);
  });
});
