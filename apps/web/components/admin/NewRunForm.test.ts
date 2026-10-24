import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NewRunForm } from './NewRunForm';
vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/research-actions', () => ({ planResearchAction: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));
describe('research strategy and session planning', () => {
  it('counts a dense dimension as bounded sessions and offers both strategies', () => {
    const html = renderToStaticMarkup(createElement(NewRunForm, { tenantSlug: 'demo', dimensions: [{ id: 'dense', name: 'Dense dimension', ring: 'social', indicatorCount: 7 }, { id: 'simple', name: 'Simple dimension', ring: 'ecological', indicatorCount: 1 }] }));
    expect(html).toContain('Session count: 5');
    expect(html).toContain('value="standard"');
    expect(html).toContain('value="deep"');
    expect(html).toContain('independent Opus verification stays the same');
    expect(html).toContain('not a charge or spending cap');
  });
});
