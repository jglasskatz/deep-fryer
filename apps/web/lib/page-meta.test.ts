import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

let tenant: { name: string } | null = { name: 'New York City' };
vi.mock('./admin-data', () => ({ adminTenant: vi.fn(async () => tenant) }));
vi.mock('./env', () => ({ hasDatabase: () => true }));

const { adminPageMetadata, pageTitle } = await import('./page-meta');

describe('page titles (WCAG 2.4.2)', () => {
  it('names the page first, then where it is', () => {
    expect(pageTitle('Housing', 'New York City')).toBe('Housing · New York City');
    expect(pageTitle('', 'Admin', 'Bronx')).toBe('Admin · Bronx');
  });

  it('titles staff pages by section, Admin and portrait, and keeps them out of search', async () => {
    tenant = { name: 'New York City' };
    expect(await adminPageMetadata('nyc', 'Discussion')).toEqual({
      title: 'Discussion · Admin · New York City',
      robots: { index: false },
    });
    expect((await adminPageMetadata('nyc')).title).toBe('Admin · New York City');
    // A portrait this reader cannot see: the title leaves the name out.
    tenant = null;
    expect((await adminPageMetadata('nyc', 'Settings')).title).toBe('Settings · Admin');
  });

  it('gives every page its own title: no page falls back to the site-wide default', () => {
    const APP = path.resolve(__dirname, '../app');
    const pages = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : e.name === 'page.tsx' || e.name === 'not-found.tsx' ? [path.join(dir, e.name)] : [],
      );
    })(APP);
    // The landing page is the site itself: the default title is its title.
    const untitled = pages
      .map((file) => path.relative(APP, file))
      .filter((file) => file !== 'page.tsx')
      .filter((file) => !/export (?:async )?function generateMetadata|export const metadata\b/.test(readFileSync(path.join(APP, file), 'utf8')));
    expect(pages.length).toBeGreaterThan(20);
    expect(untitled).toEqual([]);
  });
});
