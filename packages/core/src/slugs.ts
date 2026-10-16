/**
 * URL slugs for portraits (tenants) and organizations. Tenant slugs are the
 * first path segment of the public site (`/{tenant}`), so anything the app
 * routes at the top level is reserved — a city named "login" must not shadow
 * the sign-in page.
 */
export const RESERVED_SLUGS = new Set([
  'about',
  'account',
  'admin',
  'api',
  'architecture',
  'auth',
  'billing',
  'compare',
  'embed',
  'embed.js',
  'favicon.ico',
  'help',
  'icons',
  'insights',
  'invite',
  'login',
  'logout',
  'manifest.webmanifest',
  'new',
  'o',
  'offline',
  'pricing',
  'privacy',
  'robots.txt',
  'settings',
  'signup',
  'sitemap.xml',
  'start',
  'static',
  'sw.js',
  'terms',
  '_next',
  // Language prefixes of the public plane (apps/web/lib/i18n/locales.ts):
  // /es/nyc is NYC in Spanish, so no portrait may be called "es".
  'ar',
  'bn',
  'es',
  'fr',
  'ht',
  'ko',
  'pl',
  'ru',
  'ur',
  'zh-hans',
  'zh-hant',
]);

/**
 * The shape every portrait and organization slug has (slugError enforces it
 * at creation). Exported so request handling can turn away a path segment
 * that cannot be a slug before spending a lookup — or a cache entry — on it.
 */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

/** Returns an error message, or null when the slug is usable. */
export function slugError(slug: string): string | null {
  if (!SLUG_RE.test(slug)) {
    return 'Use 1–48 lowercase letters, digits, or hyphens, starting and ending with a letter or digit.';
  }
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved — choose another.`;
  return null;
}

/** A best-effort slug from a display name ("City of Ithaca" → "city-of-ithaca"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}
