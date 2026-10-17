import type { MetadataRoute } from 'next';
import { getPublicPortrait, publicPortraits } from '@/lib/data';
import { appUrl } from '@/lib/env';
import { languageAlternates } from '@/lib/i18n/alternates';
import { translationOnFor } from '@/lib/translation-policy';

/*
 * Built per request, not at build time: the portraits are in the database
 * (absent while the image builds) and change whenever a portrait first
 * publishes, and the addresses are the deployment's (APP_URL).
 */
export const dynamic = 'force-dynamic';

/** The product's own indexable pages (app/robots.ts keeps out everything staff-only). */
const SITE_PAGES = ['/', '/pricing', '/accessibility', '/privacy'] as const;

/**
 * /sitemap.xml: the product's pages, and every public portrait — its front
 * page and each published dimension page — as an anonymous visitor reads
 * them. A portrait that has not published yet (migration 0015), or is
 * archived, is not listed (lib/data.ts publicPortraits), and its dimension
 * list is exactly what its public page shows (getPublicPortrait, read as
 * nobody in particular), so every URL here opens for a crawler.
 *
 * A translated portrait's pages list their language versions (hreflang),
 * the same list its pages' own <head> carries (lib/i18n/alternates.ts); a
 * portrait with translation off is English only, because its /es/… URLs
 * redirect to English (lib/translation-policy.ts, middleware).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const entries: MetadataRoute.Sitemap = SITE_PAGES.map((path) => ({ url: `${base}${path}` }));

  const portraits = await publicPortraits();
  const published = await Promise.all(
    portraits.map(async (p) => {
      const [portrait, translated] = await Promise.all([getPublicPortrait(p.slug), translationOnFor(`/${p.slug}`)]);
      return { slug: p.slug, portrait, translated };
    }),
  );
  for (const { slug, portrait, translated } of published) {
    if (!portrait) continue;
    const page = (path: string, publishedAt: string | null): MetadataRoute.Sitemap[number] => ({
      url: `${base}${path}`,
      ...(publishedAt ? { lastModified: publishedAt } : {}),
      ...(translated ? { alternates: { languages: languageAlternates(path, base) } } : {}),
    });
    const dates = portrait.dimensions.map((d) => d.published_at).filter((d): d is string => Boolean(d));
    const latest = dates.length ? dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
    entries.push(page(`/${slug}`, latest));
    for (const d of portrait.dimensions) entries.push(page(`/${slug}/dim/${d.slug}`, d.published_at));
  }
  return entries;
}
