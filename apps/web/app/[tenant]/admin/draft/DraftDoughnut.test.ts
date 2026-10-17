import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { en } from '@/lib/i18n/messages/en';
import { DraftDoughnut, type DraftWedge } from './DraftDoughnut';

/**
 * The draft doughnut as the server renders it: marked as a draft for every
 * reader (a watermark kept from assistive technology, the figure described by
 * the page's notice, the canvas's own name), and every row a link to where
 * its dimension is reviewed — never to a public page.
 */

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const wedge = (slug: string, ring: 'social' | 'ecological', viz: number | null, href: string, note: string): DraftWedge => ({
  ring,
  slug,
  name: slug.charAt(0).toUpperCase() + slug.slice(1),
  viz_level: viz,
  href,
  note,
});

function render(): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(DraftDoughnut, {
        social: [wedge('housing', 'social', 60, '/nyc/admin/review?run=r1#review-d1', 'From this run, not yet approved · 1 flagged')],
        ecological: [wedge('air', 'ecological', null, '/nyc/admin/dim/d2', 'No data · nothing from this run, nothing published')],
        labels: doughnutLabels(en),
        summary: 'Draft, not published. NYC: 1 of 2 dimensions outside the safe and just space, 1 without data.',
        describedBy: 'draft-about',
      }),
    ),
  );
}

describe('DraftDoughnut', () => {
  it('says it is a draft: a hidden watermark, a described figure and a named canvas', () => {
    const html = render();
    expect(html).toMatch(/<figure aria-describedby="draft-about"/);
    expect(html).toMatch(/<div aria-hidden="true"[^>]*pointer-events-none[^>]*><span[^>]*>DRAFT<\/span>/);
    expect(html).toMatch(/<canvas[^>]*role="img"[^>]*aria-label="Draft, not published\. NYC/);
  });

  it('links every row to where its dimension is reviewed, with its status and source in words', () => {
    const html = render();
    expect(html).toContain('href="/nyc/admin/review?run=r1#review-d1"');
    expect(html).toContain('href="/nyc/admin/dim/d2"');
    expect(html).toContain(en.doughnut.level.critical);
    expect(html).toContain(en.doughnut.level.unknown);
    expect(html).toContain('From this run, not yet approved · 1 flagged');
    expect(html).not.toMatch(/href="\/nyc\/(dim|embed)\//);
  });
});
