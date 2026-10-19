import 'server-only';
import type { Metadata } from 'next';
import { adminTenant } from './admin-data';
import { hasDatabase } from './env';

/**
 * Page titles (WCAG 2.4.2): every page names what it shows, most specific
 * part first — "Housing · New York City" — so tabs, history, bookmarks and a
 * screen reader's window list tell a city's portrait, each dimension and
 * methodology apart. The root layout's template appends " · deep-fryer".
 *
 * The parts come from the request's catalog on public pages (a Spanish page
 * gets a Spanish title); the separator is the same in every language, as in
 * the catalogs' own metaTitle strings.
 */
export function pageTitle(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}

/**
 * A staff page's metadata: "<section> · Admin · <portrait>", or "Admin ·
 * <portrait>" for the overview. English, like the admin pages themselves,
 * and never indexed. The portrait's name comes from adminTenant, which the
 * admin guard also calls (memoized per request), so the title costs no
 * extra query; when the portrait is not visible to this reader, the title
 * just leaves the name out.
 */
export async function adminPageMetadata(tenantSlug: string, section?: string): Promise<Metadata> {
  const tenant = hasDatabase() ? await adminTenant(tenantSlug) : null;
  return {
    title: pageTitle(section ?? '', 'Admin', tenant?.name ?? ''),
    robots: { index: false },
  };
}
