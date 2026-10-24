import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomPagesEditor, type CustomPageForEditor } from './CustomPagesEditor';
vi.stubGlobal('React', React);
vi.mock('@/lib/custom-page-actions', () => ({ saveCustomPage: vi.fn(), publishCustomPage: vi.fn(), unpublishCustomPage: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));
const version = (id: string, versionNum: number) => ({ id, versionNum, status: 'draft', title: 'Climate plan', mdxBody: '# Priorities\n\n[Official plan](https://example.gov)\n\n<script>alert(1)</script>', createdAt: '2026-10-23T00:00:00Z', publishedAt: null });
const page: CustomPageForEditor = { id: 'p1', slug: 'climate-plan', publishedVersionId: 'v1', versions: [version('v2', 2), { ...version('v1', 1), status: 'published' }] };
describe('custom page editor', () => {
  it('distinguishes saved drafts from current public content and preserves history controls', () => {
    const html = renderToStaticMarkup(createElement(CustomPagesEditor, { tenantSlug: 'nyc', pages: [page] }));
    expect(html).toContain('Save a new draft version');
    expect(html).toContain('Currently published');
    expect(html).toContain('Publish this version');
    expect(html).toContain('Remove from public site');
    expect(html).toContain('/nyc/pages/climate-plan');
    expect(html).toContain('Edit a copy');
    expect(html).toContain('Preview draft');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('offers explicit restoration of older versions without overwriting them', () => {
    const html = renderToStaticMarkup(createElement(CustomPagesEditor, { tenantSlug: 'nyc', pages: [{ ...page, publishedVersionId: 'v2' }] }));
    expect(html).toContain('Restore and publish this version');
  });
});
