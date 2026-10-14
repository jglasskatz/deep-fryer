import { eq } from 'drizzle-orm';
import { getDb, tenants } from '@deep-fryer/db';
import { isOrigin } from './csp';
import { hasDatabase } from './env';

/**
 * The embed allowlist as CSP frame-ancestors input, cached briefly per slug
 * so an embed on a busy city homepage costs one query a minute, not one per
 * page view. An unknown tenant or empty allowlist yields [] (same-origin
 * framing only — the hosted site may still preview its own embed).
 */
const TTL_MS = 60_000;
const cache = new Map<string, { origins: string[]; at: number }>();

export async function embedOriginsFor(slug: string): Promise<string[]> {
  if (!hasDatabase()) return [];
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.origins;
  const [row] = await getDb()
    .select({ embedOrigins: tenants.embedOrigins })
    .from(tenants)
    .where(eq(tenants.slug, slug));
  const origins = (row?.embedOrigins ?? []).filter(isOrigin);
  cache.set(slug, { origins, at: Date.now() });
  return origins;
}
