import { and, eq, inArray } from 'drizzle-orm';
import { RESERVED_SLUGS, SLUG_RE, parseDisabledFeatures, resolvePortraitFeatures } from '@deep-fryer/core';
import { getDb, organizations, tenantConfig, tenantIsPublic, tenants } from '@deep-fryer/db';
import { hasDatabase } from './env';
import { TtlCache } from './ttl-cache';

/**
 * Whether a page may be shown in a language other than English (SPEC-v7
 * §3.5). Runs in middleware, before any user context, so it reads public
 * data in the system context (like lib/embed-policy.ts) and caches each
 * answer for a minute: a busy portrait costs one query a minute, and a
 * setting change shows within a minute.
 *
 * - A portrait's pages (/{portrait}/…, /embed/{portrait}) follow the
 *   portrait's `translation` feature.
 * - An organization's pages (/o/{org}/…) are translated when any of its
 *   public portraits is — the portraits lib/features.ts organizationFeatures
 *   counts for a visitor (it reads under row-level security), so an
 *   organization's pages and its public portraits agree.
 * - Only public portraits count: live, and published at least once
 *   (migration 0015). One that is archived or not public yet is answered
 *   like an unknown one, in English: middleware answers before it knows who
 *   is asking, the page is a 404 for everyone but the portrait's members, and
 *   neither the redirects nor the hreflang list (app/layout.tsx) may tell a
 *   private portrait from a made-up slug. Its members read it in English
 *   until it publishes.
 * - Everything else (landing, pricing, sign-in) is not a portrait's page and
 *   stays multilingual.
 * - Without a database (the demo build) every feature is on, translation
 *   included (lib/features.ts).
 */
const TTL_MS = 60_000;
/**
 * The key comes from the request path, which anyone can choose, so the cache
 * is bounded (lib/ttl-cache.ts) and only well-formed slugs reach it at all. A
 * deployment has far fewer portraits and organizations than this, so the
 * bound only ever bites on made-up paths.
 */
const MAX_ENTRIES = 1_000;
const cache = new TtlCache<boolean>(TTL_MS, MAX_ENTRIES);

/** Which portrait or organization a path belongs to, if any. */
export function translationScope(path: string): { kind: 'tenant' | 'org'; slug: string } | null {
  const [first, second] = path.split('/').filter(Boolean);
  if (!first) return null;
  if (first === 'o') return second ? { kind: 'org', slug: decodeURIComponent(second) } : null;
  if (first === 'embed') return second ? { kind: 'tenant', slug: decodeURIComponent(second) } : null;
  if (RESERVED_SLUGS.has(first)) return null;
  return { kind: 'tenant', slug: decodeURIComponent(first) };
}

async function lookup(kind: 'tenant' | 'org', slug: string): Promise<boolean> {
  const db = getDb();
  // Public portraits only (tenantIsPublic — the system context bypasses
  // row-level security, so the rule is applied here): an archived portrait's
  // pages are not public (its row is hidden from readers, migration 0005),
  // and it must not keep its organization's pages translated after the live
  // portraits turned it off; nor may a portrait that has not published yet
  // (migration 0015).
  const ids =
    kind === 'tenant'
      ? (
          await db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.slug, slug), tenantIsPublic()))
        ).map((r) => r.id)
      : (
          await db
            .select({ id: tenants.id })
            .from(tenants)
            .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
            .where(and(eq(organizations.slug, slug), tenantIsPublic()))
        ).map((r) => r.id);
  // An unknown (or not yet public) portrait is a 404 page in English anyway; nothing to translate.
  if (ids.length === 0) return false;
  const rows = await db
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.key, 'features'), inArray(tenantConfig.tenantId, ids)));
  const disabled = parseDisabledFeatures(process.env.DF_DISABLED_FEATURES).disabled;
  // Portraits without a stored row resolve to the default (off).
  return rows.some((r) => resolvePortraitFeatures(r.value as Record<string, unknown>, disabled).translation);
}

export async function translationOnFor(path: string): Promise<boolean> {
  const scope = translationScope(path);
  if (!scope) return true;
  if (!hasDatabase()) return !parseDisabledFeatures(process.env.DF_DISABLED_FEATURES).disabled.has('translation');
  // No portrait or organization has a slug of another shape (slugError), so
  // the page is a 404 in English: answered without a query or a cache entry.
  if (!SLUG_RE.test(scope.slug)) return false;
  const key = `${scope.kind}:${scope.slug}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const on = await lookup(scope.kind, scope.slug);
  cache.set(key, on);
  return on;
}

/** For tests: how many answers are cached. */
export function translationPolicyCacheSize(): number {
  return cache.size;
}

/** For tests: forget cached answers. */
export function clearTranslationPolicyCache(): void {
  cache.clear();
}
