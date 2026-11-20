import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/**
 * The staff outreach page, printed: the site header, the way back, the
 * introduction and the editing form are left out, so the paper carries the
 * portrait's name and its contacts with their staff details.
 */
vi.stubGlobal('React', React);

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => createElement('header', null, 'SITE HEADER') }));
vi.mock('@/lib/admin-guard', () => ({ requireAdminPage: vi.fn(async () => ({ tenant: { id: 't1', slug: 'ithaca', name: 'City of Ithaca' } })) }));
vi.mock('@/lib/page-meta', () => ({ adminPageMetadata: vi.fn() }));
vi.mock('@/lib/portrait-management', () => ({
  outreachContactsForAdmin: vi.fn(async () => [{
    id: 'c1', archivedAt: null, publishedVersionId: null,
    versions: [{ id: 'v1', versionNum: 1, data: { org: 'City Water Department', email: 'water@example.gov', tags: [], data_needs: ['Water use'], draft_message: 'Subject: Data\nHello' } }],
  }]),
}));
vi.mock('@/lib/outreach-admin-actions', () => ({ saveOutreachContact: vi.fn(), publishOutreachContact: vi.fn(), setOutreachArchived: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

// Loaded once, outside any test's time limit: the page pulls in much of the app.
const { default: Page } = await import('./page');
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function page(): Promise<string> {
  const element = await Page({ params: Promise.resolve({ tenant: 'ithaca' }) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

function enclosingClasses(html: string, marker: string, tag: string): string {
  const at = html.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = html.lastIndexOf(`<${tag}`, at);
  return /class="([^"]*)"/.exec(html.slice(open, at))?.[1] ?? '';
}

describe('the staff outreach page in print', () => {
  it('leaves out navigation and the form, and names the portrait on the printed heading', async () => {
    const html = await page();
    expect(enclosingClasses(html, '<header>SITE HEADER', 'div')).toContain('print:hidden');
    expect(enclosingClasses(html, '← Admin', 'a')).toContain('print:hidden');
    expect(enclosingClasses(html, 'Maintain the organizations', 'p')).toContain('print:hidden');
    expect(enclosingClasses(html, 'Add an outreach contact', 'section')).toContain('print:hidden');
    expect(html).toContain('<span class="hidden print:inline"> · City of Ithaca</span>');
  });

  it('prints each contact with its staff details and draft', async () => {
    const html = await page();
    expect(html).toContain('City Water Department');
    expect(html).toContain('Water use');
    expect(html).toContain('Subject: Data\nHello');
    expect(html).toContain('href="mailto:water@example.gov?subject=Data&amp;body=Hello"');
    expect(enclosingClasses(html, 'City Water Department</h3>', 'section')).not.toContain('print:hidden');
  });
});
