import { and, eq } from 'drizzle-orm';
import { SLUG_RE } from '@deep-fryer/core';
import { getDb, tenantIsPublic, tenants } from '@deep-fryer/db';
import { isOrigin } from './csp';
import { hasDatabase } from './env';
import { TtlCache } from './ttl-cache';

/**
 * The embed allowlist as CSP frame-ancestors input, cached briefly per slug
 * so an embed on a busy city homepage costs one query a minute, not one per
 * page view. An unknown tenant or empty allowlist yields [] (same-origin
 * framing only — the hosted site may still preview its own embed), and so
 * does a portrait that is not public (archived, or not yet published —
 * migration 0015): its embed is a 404 for the visitors of any other site,
 * and the answer must not tell a made-up slug from a private portrait.
 */
const TTL_MS = 60_000;
/**
 * The slug comes from the request path (/embed/{slug}), which anyone can
 * choose, so the cache is bounded (lib/ttl-cache.ts) and a segment that cannot
 * be a slug never reaches it — see lib/translation-policy.ts.
 */
const MAX_ENTRIES = 1_000;
// System context (getDb): runs in middleware for anonymous framing checks of
// public data, before any user context exists — so it applies the public
// rule itself (tenantIsPublic), as row-level security would for a visitor.
const cache = new TtlCache<string[]>(TTL_MS, MAX_ENTRIES);

export async function embedOriginsFor(slug: string): Promise<string[]> {
  if (!hasDatabase()) return [];
  // Not a slug any portrait can have (slugError): an unknown tenant, without a query.
  if (!SLUG_RE.test(slug)) return [];
  const hit = cache.get(slug);
  if (hit !== undefined) return hit;
  const [row] = await getDb()
    .select({ embedOrigins: tenants.embedOrigins })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), tenantIsPublic()));
  const origins = (row?.embedOrigins ?? []).filter(isOrigin);
  cache.set(slug, origins);
  return origins;
}

/** For tests: how many answers are cached. */
export function embedPolicyCacheSize(): number {
  return cache.size;
}
