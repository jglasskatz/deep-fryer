import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { Role } from '@deep-fryer/core';
import { santaCruzFixture } from '@/components/admin/grid/test-fixture';

/**
 * The Data page: any member of the portrait, viewers included, sees every
 * indicator of each dimension's latest version in one table, opened with
 * the view the address names; only editors get links to edit a dimension.
 * The guard, the reads and the header are stubbed; the table is real.
 */

vi.stubGlobal('React', React);

let role: Role = 'viewer';
const requireAdminPage = vi.fn(async (_slug: string, _min: Role, _path: string) => ({
  tenant: { id: 't1', slug: 'santa-cruz', name: 'City of Santa Cruz' },
  role,
  devMode: false,
}));

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/admin-guard', () => ({ requireAdminPage: (...args: [string, Role, string]) => requireAdminPage(...args) }));
vi.mock('@/lib/admin-data', () => ({ tenantDimensions: vi.fn(async () => santaCruzFixture()) }));
vi.mock('@/lib/data', () => ({ evidenceUrl: (slug: string, path: string) => `/files/${slug}/${path}` }));
vi.mock('@/lib/auth', () => ({
  roleAtLeast: (r: Role | null, min: Role) => {
    const rank: Record<Role, number> = { viewer: 0, moderator: 1, editor: 2, owner: 3 };
    return r !== null && rank[r] >= rank[min];
  },
}));
vi.mock('@/lib/page-meta', () => ({ adminPageMetadata: vi.fn(async () => ({})) }));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function dataPage(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: DataPage } = await import('./page');
  const element = await DataPage({
    params: Promise.resolve({ tenant: 'santa-cruz' }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, element));
}

describe('the Data page', () => {
  beforeEach(() => {
    role = 'viewer';
    requireAdminPage.mockClear();
  });

  it('is open to every member, viewers included, and comes back here after sign-in', async () => {
    await dataPage();
    expect(requireAdminPage).toHaveBeenCalledWith('santa-cruz', 'viewer', '/santa-cruz/admin/data');
  });

  it('shows every indicator of the portrait under a plain heading', async () => {
    const html = await dataPage();
    expect(html).toContain('<h1 class="mt-2 text-2xl font-bold">Data</h1>');
    expect(html).toContain('published or not');
    expect(html.match(/<tr id="row-/g)).toHaveLength(80);
    expect(html).toContain('href="/files/santa-cruz/evidence/ghg.png"');
    expect(html).toContain('No usable figure found for Ocean Acidification:</span> No local monitoring series.');
  });

  it('gives editors, and not viewers, a link to edit each dimension and the Edit button', async () => {
    const viewerHtml = await dataPage();
    expect(viewerHtml).not.toContain('/santa-cruz/admin/dim/');
    expect(viewerHtml).not.toMatch(/<button[^>]*>Edit<\/button>/);
    expect(viewerHtml).toContain('aria-readonly="true"');

    role = 'editor';
    const editorHtml = await dataPage();
    expect(editorHtml).toContain('href="/santa-cruz/admin/dim/dim-food"');
    expect(editorHtml).toMatch(/<button[^>]*>Edit<\/button>/);
  });

  it('opens with the view the address names', async () => {
    const html = await dataPage({ show: 'no-source-link', dim: 'peace-justice' });
    expect([...html.matchAll(/<tr id="row-([^"]+)"/g)].map((m) => m[1])).toEqual([
      'peace-justice/residents-who-trust-the-police',
      'peace-justice/hate-crimes-reported',
    ]);
  });

  it('shows every dimension when the address names one the table has no rows for', async () => {
    const html = await dataPage({ dim: 'no-such-dimension' });
    expect(html.match(/<tr id="row-/g)).toHaveLength(80);
    expect(html).toMatch(/<option value="" selected="">All dimensions<\/option>/);
    expect(html).not.toContain('No rows match.');
  });
});
