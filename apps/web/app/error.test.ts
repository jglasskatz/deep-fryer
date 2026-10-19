import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The route error page is English only, and renders inside the root
 * layout's <html lang dir> of the page that failed — Spanish, Arabic (right
 * to left), any of the site's languages. So its own content says it is
 * English, left to right (WCAG 3.1.2), and still names support.
 */
vi.stubGlobal('React', React);
vi.mock('@/components/site-footer/SupportEmail', () => ({ useSupportEmail: () => 'help@example.gov' }));

describe('the route error page', () => {
  it('declares its English, left to right, whatever the language of the page that failed', async () => {
    const { default: RouteError } = await import('./error');
    const html = renderToStaticMarkup(
      createElement(RouteError, { error: Object.assign(new Error('boom'), { digest: 'd-42' }), reset: () => undefined }),
    );
    expect(html).toMatch(/^<main id="main" lang="en" dir="ltr"/);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('href="mailto:help@example.gov"');
    expect(html).toContain('d-42');
    expect(html).not.toContain('boom');
  });
});
