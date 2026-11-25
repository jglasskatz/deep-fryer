import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewRunForm } from './NewRunForm';
vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/research-actions', () => ({ planResearchAction: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));
describe('research strategy and session planning', () => {
  it('counts a dense dimension as bounded sessions and offers standard, hybrid, and deep strategies', () => {
    const html = renderToStaticMarkup(createElement(NewRunForm, { tenantSlug: 'demo', dimensions: [{ id: 'dense', name: 'Dense dimension', ring: 'social', indicatorCount: 7 }, { id: 'simple', name: 'Simple dimension', ring: 'ecological', indicatorCount: 1 }] }));
    expect(html).toContain('Session count: 5');
    expect(html).toContain('value="standard"');
    expect(html).toContain('value="hybrid"');
    expect(html).toContain('value="deep"');
    expect(html).toContain('independent Opus verification stays the same');
    expect(html).toContain('not a charge or spending cap');
    expect(html).toContain('The run page names the strategy and version the run used');
    // Defaults to Google carbon-free routing with zero warning banner on low intensity
    expect(html).toContain('northamerica-northeast1');
    expect(html).not.toContain('role="alert"');
  });

  it('shows a carbon intensity warning ONLY when the selected region/provider is medium or high', () => {
    const dims = [{ id: 'housing', name: 'Housing', ring: 'social', indicatorCount: 2 }];
    const medHtml = renderToStaticMarkup(
      createElement(NewRunForm, {
        tenantSlug: 'demo',
        dimensions: dims,
        initialCarbonMode: 'run_now',
        initialRegionId: 'us-west2',
      }),
    );
    expect(medHtml).toContain('role="alert"');
    expect(medHtml).toContain('Medium carbon intensity');

    const highHtml = renderToStaticMarkup(
      createElement(NewRunForm, {
        tenantSlug: 'demo',
        dimensions: dims,
        initialCarbonMode: 'run_now',
        initialRegionId: 'openai-us-default',
      }),
    );
    expect(highHtml).toContain('role="alert"');
    expect(highHtml).toContain('High carbon intensity');
  });
});
