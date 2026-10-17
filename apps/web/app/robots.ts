import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/env';

/*
 * Read per request, not at build: the address in the sitemap line is the
 * deployment's (APP_URL), and one image serves every deployment.
 */
export const dynamic = 'force-dynamic';

/**
 * /robots.txt. The public plane is for everyone, search engines included:
 * the landing page, pricing, the accessibility statement and privacy
 * notice, and every public portrait in every language it is published in
 * (the sitemap lists them). The open-data API under /api/v1 is public too.
 *
 * Kept out: staff pages (/{portrait}/admin, in any language prefix — the `*`
 * matches it), accounts, billing, the rest of /api, the sign-in, invitation
 * and start pages, and embeds — an embed is a copy of the portrait framed
 * inside a city's own page; the portrait itself is the page to index (embeds
 * also say noindex and name it as canonical, app/embed/[tenant]/page.tsx).
 * Crawlers that honour robots.txt apply the longest matching rule, so
 * `Allow: /api/v1/` wins over `Disallow: /api/`.
 *
 * A robots.txt path is a prefix, and a portrait's address is one segment
 * anyone may choose (/loginville, /startown), so the single-page sections
 * are matched exactly — the page (`$`), its query strings and anything
 * under it — rather than by bare prefix, which would hide those portraits.
 */
const exactly = (path: string) => [`${path}$`, `${path}?`, `${path}/`];

const ROBOTS_DISALLOW = [
  ...exactly('/*/admin'),
  ...exactly('/account'),
  ...exactly('/o/*/billing'),
  '/api/',
  ...exactly('/start'),
  ...exactly('/login'),
  '/invite/',
  '/embed/',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/', '/api/v1/'], disallow: [...ROBOTS_DISALLOW] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
