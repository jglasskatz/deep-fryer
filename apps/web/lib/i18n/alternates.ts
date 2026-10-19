import { LOCALES } from './locales';
import { localizeHref } from './routing';

/**
 * The hreflang alternates of a page that exists in every language: each
 * language's URL, and the English one as `x-default`. One list for the
 * page's own <link rel="alternate"> tags (app/layout.tsx) and the sitemap's
 * (app/sitemap.ts), so search engines are told the same thing both ways.
 * `prefix` makes the URLs absolute where that is required (sitemaps).
 */
export function languageAlternates(path: string, prefix = ''): Record<string, string> {
  const languages: Record<string, string> = { 'x-default': `${prefix}${path}` };
  for (const l of LOCALES) languages[l.code] = `${prefix}${localizeHref(l.code, path)}`;
  return languages;
}
