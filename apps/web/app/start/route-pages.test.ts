import React, { createElement } from 'react';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { DOUGHNUT_ROUTES, routeHref } from '@/components/onboarding/routes';

/**
 * Every way in that /start's "What do you already have?" offers opens a page
 * an editor of a new portrait can use. Each route's page file is found from
 * its path (app/[tenant]/<path>/page.tsx) and rendered, against real
 * Postgres, as an editor of a portrait created the way /start creates one:
 * a route whose page is missing, refuses an editor or fails to render fails
 * here, before any volunteer follows the link.
 */
vi.stubGlobal('React', React);

const APP = path.resolve(import.meta.dirname, '..');
const pageFile = (routePath: string) => path.join(APP, '[tenant]', routePath, 'page.tsx');

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    signedIn ? { user: { id: signedIn, email: `${signedIn}@example.org`, displayName: null, isStaff: false } } : null,
  ),
}));
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

describe('the ways in that /start offers', () => {
  it('each has a page file under the portrait', () => {
    expect(DOUGHNUT_ROUTES.length).toBeGreaterThan(0);
    for (const route of DOUGHNUT_ROUTES) {
      expect(existsSync(pageFile(route.path)), `${route.id}: ${pageFile(route.path)}`).toBe(true);
    }
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('the ways in that /start offers, opened by an editor', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId: string; organizationId: string; userId: string }[] = [];
  let slug = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'route-pages-test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    slug = uniq();
    const org = await m.provisionOrganization(db, { slug, name: 'Route Check Group' });
    const { tenant } = await m.provisionTenant(db, { slug, name: 'Route Check', region: 'NY, USA', organizationId: org.id });
    const [user] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.org` }).returning();
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role: 'editor' });
    cleanup.push({ tenantId: tenant.id, organizationId: org.id, userId: user!.id });
    signedIn = user!.id;
  }, 60_000);

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    for (const c of cleanup) {
      await db.delete(m.tenants).where(eq(m.tenants.id, c.tenantId));
      await db.delete(m.organizations).where(eq(m.organizations.id, c.organizationId));
      await db.delete(m.users).where(eq(m.users.id, c.userId));
    }
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
  });

  for (const route of DOUGHNUT_ROUTES) {
    it(`"${route.title}" renders for an editor`, async () => {
      const mod = (await import(/* @vite-ignore */ pageFile(route.path))) as {
        default: (props: { params: Promise<{ tenant: string }>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
      };
      let element: React.ReactNode;
      try {
        element = await mod.default({ params: Promise.resolve({ tenant: slug }), searchParams: Promise.resolve({}) });
      } catch (err) {
        // A redirect (to sign-in, home or the public page) means the editor was turned away.
        const digest = (err as { digest?: string }).digest;
        throw new Error(`${routeHref(route, slug)} did not render for an editor${digest ? ` (${digest})` : ''}`, { cause: err });
      }
      const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
      expect(html).toContain('<main');
    }, 60_000);
  }
});
