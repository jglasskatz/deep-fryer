import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

// The approval is a server action; rendering never calls it.
vi.mock('@/lib/review-actions', () => ({ approveUnflaggedFindings: vi.fn() }));

import { ApproveUnflagged } from './ApproveUnflagged';

/**
 * "Approve all unflagged" before anyone clicks: the button names how many
 * findings it would approve, and the live region that announces the outcome
 * is there from the start (a region that appears later is not announced).
 */

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const render = (findings: number) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(ApproveUnflagged, {
        tenantSlug: 'nyc',
        runId: 'r1',
        findings,
        dimensions: 2,
        sample: [
          {
            id: 'f1',
            label: 'Housing — Rent burden',
            value: '42% (2024)',
            source: 'Census ACS',
            sourceHref: 'https://data.census.gov/',
            reviewHref: '/nyc/admin/review?run=r1#review-d1',
          },
        ],
      }),
    ),
  );

describe('ApproveUnflagged', () => {
  it('names the count on its button, behind which the confirmation waits', () => {
    const html = render(14);
    expect(html).toContain('Approve all unflagged (14 findings)');
    expect(html).toContain('role="status"');
    // Focusable from script only: after an approval removes the focused button, focus moves to the outcome.
    expect(html).toMatch(/<p tabindex="-1" role="status"/);
    // The confirmation, with the sample to check, is a second step, not shown until asked for.
    expect(html).not.toContain('as drafts?');
    expect(html).not.toContain('Rent burden');
  });

  it('offers nothing to click when nothing can be approved, keeping the live region', () => {
    const html = render(0);
    expect(html).not.toContain('<button');
    expect(html).toContain('role="status"');
    expect(render(1)).toContain('Approve all unflagged (1 finding)');
  });
});
