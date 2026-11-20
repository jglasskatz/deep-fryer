import React, { createElement } from 'react';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';
import {
  BRAND_FONTS,
  PAGE_BACKGROUNDS,
  brandColourProblem,
  brandingInputSchema,
  brandingView,
  contrastRatio,
  nextBranding,
  publicBranding,
  sniffLogo,
} from './branding';

/**
 * A portrait's logo, colour and font: the rules (a colour that shows on both
 * themes, a font from the list, a logo read by its bytes), the owner saving
 * them, and the public header drawing them.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../../test/database-session')).databaseSession(signedIn)),
  signOut: vi.fn(),
}));
let requestPath = '/ithaca';
vi.mock('@/lib/i18n/server', () => ({
  getI18n: vi.fn(async () => ({ locale: 'en', info: localeInfo('en'), m: messagesFor('en'), href: (p: string) => localizeHref('en', p) })),
  getRequestPath: vi.fn(async () => requestPath),
}));

// The header's own async children (language menu and notice, family links)
// are other tests' subject; a static render cannot wait for them.
vi.mock('@/components/i18n/LanguageSwitcher', () => ({ LanguageSwitcher: () => null, LanguageNotice: () => null }));
vi.mock('./FamilyNav', () => ({ FamilyNav: () => null }));

// Vitest compiles the components' JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('the branding rules', () => {
  it('checks colours against the page backgrounds the app actually uses', () => {
    const globals = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const [light, dark] = [...globals.matchAll(/--color-bg:\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => m[1]!.toLowerCase());
    expect({ light, dark }).toEqual(PAGE_BACKGROUNDS);
  });

  it('accepts a colour that shows on both pages and refuses one that does not, saying which page and why', () => {
    expect(brandColourProblem('#2f7d32')).toBeNull();
    expect(contrastRatio('#2f7d32', PAGE_BACKGROUNDS.light)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio('#2f7d32', PAGE_BACKGROUNDS.dark)).toBeGreaterThanOrEqual(3);
    expect(brandColourProblem('#ffe066')).toMatch(/^This colour is too pale to see on the light page \(contrast 1\.\d to 1; it needs at least 3 to 1\)\. Pick a darker one\.$/);
    expect(brandColourProblem('#1a1a40')).toMatch(/^This colour is too dark to see on the dark page .*Pick a lighter one\.$/);
    expect(brandColourProblem('red')).toBe('Pick a colour from the colour picker.');
  });

  it('refuses a font that is not on the list, with the reason', () => {
    const refused = brandingInputSchema.safeParse({ colour: '', font: 'comic-sans' });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe('That font is not one of the choices. Pick one from the list.');
    for (const f of BRAND_FONTS) expect(brandingInputSchema.safeParse({ colour: '', font: f.key }).success).toBe(true);
  });

  it('reads a logo’s kind from its bytes, never its name', () => {
    expect(sniffLogo(PNG)).toEqual({ ext: 'png', contentType: 'image/png' });
    expect(sniffLogo(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    expect(sniffLogo(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))?.ext).toBe('webp');
    expect(sniffLogo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffLogo(new TextEncoder().encode('GIF89a'))).toBeNull();
  });

  it('never sets footer_html, and keeps one already there untouched', () => {
    const next = nextBranding({ footer_html: '<p>kept</p>', primary_color: '#2f7d32', font: 'serif', logo_url: 'branding/logo-a.png' }, {
      colour: '',
      font: 'inter',
      logoPath: undefined,
    });
    expect(next).toEqual({ footer_html: '<p>kept</p>', logo_url: 'branding/logo-a.png' });
    expect(nextBranding(null, { colour: '#2f7d32', font: 'serif', logoPath: null })).toEqual({ primary_color: '#2f7d32', font: 'serif' });
  });

  it('gives the open-data API the logo’s full address, or no logo when it has none', () => {
    const absolute = (p: string) => `https://portraits.example.org/evidence/ithaca/${p}`;
    expect(publicBranding({ logo_url: 'branding/logo-abc-1f.png', primary_color: '#2f7d32', font: 'serif' }, absolute)).toEqual({
      logo_url: 'https://portraits.example.org/evidence/ithaca/branding/logo-abc-1f.png',
      primary_color: '#2f7d32',
      font: 'serif',
    });
    expect(publicBranding({ logo_url: 'https://elsewhere.example/logo.png' }, absolute)).toEqual({ logo_url: 'https://elsewhere.example/logo.png' });
    expect(publicBranding({ logo_url: 'branding/../secret.png', primary_color: '#2f7d32' }, absolute)).toEqual({ primary_color: '#2f7d32' });
    expect(publicBranding({ logo_url: 'branding/logo-abc-1f.png' }, () => null)).toEqual({});
    expect(publicBranding(null, absolute)).toBeNull();
  });

  it('draws only what passes the rules, whatever is stored', () => {
    const url = (p: string) => `/files/${p}`;
    expect(brandingView({ logo_url: 'https://elsewhere.example/logo.png', primary_color: '#ffe066', font: 'papyrus' }, url)).toEqual({
      logoSrc: null,
      colour: null,
      fontStack: null,
    });
    expect(brandingView({ logo_url: 'branding/logo-abc-1f.png', primary_color: '#2F7D32', font: 'serif' }, url)).toEqual({
      logoSrc: '/files/branding/logo-abc-1f.png',
      colour: '#2f7d32',
      fontStack: BRAND_FONTS.find((f) => f.key === 'serif')!.stack,
    });
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('an owner sets the portrait’s branding and the public header shows it', () => {
  const saved = { secret: process.env.AUTH_SECRET, dir: process.env.LOCAL_EVIDENCE_DIR };
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  const people: Record<'owner' | 'editor', string> = { owner: '', editor: '' };
  let tenantSlug = '';
  let tenantId = '';
  let storageDir = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    storageDir = mkdtempSync(path.join(os.tmpdir(), 'df-branding-'));
    process.env.LOCAL_EVIDENCE_DIR = storageDir;
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Brand City' });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    for (const role of ['owner', 'editor'] as const) {
      const [user] = await db.insert(m.users).values({ email: `${uniq()}@${role}.example.gov` }).returning();
      people[role] = user!.id;
      cleanup.userIds.push(user!.id);
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role });
    }
    // One published dimension makes the portrait public, so an anonymous visitor sees its pages.
    const draft = (await m.latestVersion(db, dimensions[0]!.dimensionId))!;
    signedIn = people.editor;
    const published = await (await import('@/lib/actions')).publishVersion({ tenantSlug, versionId: draft.id });
    expect(published.ok).toBe(true);
  });

  afterAll(async () => {
    signedIn = null;
    if (saved.secret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved.secret;
    if (saved.dir === undefined) delete process.env.LOCAL_EVIDENCE_DIR;
    else process.env.LOCAL_EVIDENCE_DIR = saved.dir;
    rmSync(storageDir, { recursive: true, force: true });
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  const form = (fields: Record<string, string | Blob>) => {
    const data = new FormData();
    data.set('tenantSlug', tenantSlug);
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  const storedBranding = async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select({ branding: m.tenants.branding }).from(m.tenants).where(eq(m.tenants.id, tenantId));
    return row!.branding;
  };
  async function publicHeader(): Promise<string> {
    signedIn = null;
    requestPath = `/${tenantSlug}`;
    const { SiteHeader } = await import('./SiteHeader');
    const element = await SiteHeader({ variant: 'tenant', tenant: { slug: tenantSlug, name: 'Brand City' } });
    return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
  }

  it('refuses a low-contrast colour or an unlisted font with the reason, and writes nothing', async () => {
    const { updateBranding } = await import('@/lib/actions');
    signedIn = people.owner;
    const pale = await updateBranding(form({ colour: '#FFE066', font: 'inter' }));
    expect(pale).toEqual({ ok: false, error: expect.stringMatching(/^This colour is too pale to see on the light page/) });
    const font = await updateBranding(form({ colour: '#2f7d32', font: 'comic-sans' }));
    expect(font).toEqual({ ok: false, error: 'That font is not one of the choices. Pick one from the list.' });
    const svg = await updateBranding(form({ colour: '', font: 'inter', logo: new Blob(['<svg/>'], { type: 'image/png' }) }));
    expect(svg).toEqual({ ok: false, error: 'The logo must be a PNG, JPEG or WebP picture.' });
    expect(await storedBranding()).toBeNull();
  });

  it('is for owners only', async () => {
    signedIn = people.editor;
    const res = await (await import('@/lib/actions')).updateBranding(form({ colour: '#2f7d32', font: 'serif' }));
    expect(res.ok).toBe(false);
    expect(await storedBranding()).toBeNull();
  });

  it('saves a logo, colour and font, and the public header shows them', async () => {
    expect(await publicHeader()).not.toContain('data-brand-strip');

    signedIn = people.owner;
    const res = await (await import('@/lib/actions')).updateBranding(
      form({ colour: '#2F7D32', font: 'serif', logo: new Blob([PNG], { type: 'image/png' }) }),
    );
    expect(res).toEqual({ ok: true, data: undefined });
    const branding = (await storedBranding())!;
    expect(branding).toMatchObject({ primary_color: '#2f7d32', font: 'serif', logo_url: expect.stringMatching(/^branding\/logo-[a-z0-9]+-[0-9a-f]{8}\.png$/) });
    expect(readFileSync(path.join(storageDir, branding.logo_url!))).toEqual(Buffer.from(PNG));

    const html = await publicHeader();
    expect(html).toContain(`<img src="/evidence/${tenantSlug}/${branding.logo_url}" alt=""`);
    expect(html).toMatch(/<div aria-hidden="true" data-brand-strip="true" class="h-1" style="background-color:#2f7d32"><\/div>/);
    expect(html).toContain(`>:root{--font-sans:${BRAND_FONTS.find((f) => f.key === 'serif')!.stack}}</style>`);
    // Staff pages keep the app's own look.
    const { SiteHeader } = await import('./SiteHeader');
    const admin = renderToStaticMarkup(
      createElement(AppRouterContext.Provider, { value: router }, await SiteHeader({ variant: 'admin', tenant: { slug: tenantSlug, name: 'Brand City' } })),
    );
    expect(admin).not.toContain('data-brand-strip');
    expect(admin).not.toContain(branding.logo_url!);
  });

  it('removes the logo and colour when asked, and the header stops showing them', async () => {
    signedIn = people.owner;
    const res = await (await import('@/lib/actions')).updateBranding(form({ colour: '', font: 'inter', remove_logo: 'on' }));
    expect(res.ok).toBe(true);
    expect(await storedBranding()).toEqual({});
    const html = await publicHeader();
    expect(html).not.toContain('data-brand-strip');
    expect(html).not.toContain('branding/logo-');
  });
});
