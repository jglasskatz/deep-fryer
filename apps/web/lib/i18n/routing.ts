import { RESERVED_SLUGS } from '@deep-fryer/core';
import { DEFAULT_LOCALE, localeForPrefix, localeInfo, type Locale } from './locales';

/**
 * Which URLs exist in every language, and how a URL moves between them.
 *
 * Translated pages live under a locale prefix (`/es/nyc/progress`); English
 * is unprefixed. The prefix — not a cookie — selects the language, so each
 * language version has its own URL: it can be shared, bookmarked, indexed
 * (hreflang), and cached offline by the service worker without one
 * language's copy ever being served for another. Middleware strips the prefix
 * and passes the locale to the page in a request header.
 *
 * Only the public plane is translated (NYC Local Law 30 covers documents for
 * the public). Staff surfaces — admin, review, billing, account — and the
 * product's own sales pages stay English, so a prefixed URL for one of those
 * redirects to its unprefixed form.
 */

const TENANT_VIEWS = new Set(['progress', 'methodology', 'outreach', 'emergency']);
const ORG_VIEWS = new Set(['compare', 'insights', 'progress']);

export function isLocalizablePath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const [first, second, third, fourth] = parts;
  if (first === 'o') {
    if (!second) return false;
    return parts.length === 2 || (parts.length === 3 && ORG_VIEWS.has(third!));
  }
  if (first === 'embed') return parts.length === 2;
  if (RESERVED_SLUGS.has(first!) || localeForPrefix(first!)) return false;
  if (parts.length === 1) return true;
  if (parts.length === 2) return TENANT_VIEWS.has(second!);
  return parts.length === 3 && second === 'dim' && Boolean(third) && fourth === undefined;
}

/** Split a request path into its locale and the unprefixed path. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  const locale = match ? localeForPrefix(match[1]!) : null;
  if (!locale) return { locale: null, path: pathname };
  return { locale, path: match![2] || '/' };
}

/**
 * The same href in `locale`: same-site paths on the public plane gain the
 * prefix; everything else (absolute URLs, staff pages, APIs, anchors) is
 * returned unchanged.
 */
export function localizeHref(locale: Locale, href: string): string {
  if (locale === DEFAULT_LOCALE || !href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  if (!isLocalizablePath(path)) return href;
  return `/${localeInfo(locale).prefix}${path}${rest}`;
}
