import { and, eq, inArray } from 'drizzle-orm';
import { RESERVED_SLUGS, parseDisabledFeatures, resolvePortraitFeatures } from '@deep-fryer/core';
import { getDb, organizations, tenantConfig, tenants } from '@deep-fryer/db';
import { hasDatabase } from './env';

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
 *   portraits is.
 * - Everything else (landing, pricing, sign-in) is not a portrait's page and
 *   stays multilingual.
 * - Without a database (the demo build) every feature is on, translation
 *   included (lib/features.ts).
 */
const TTL_MS = 60_000;
const cache = new Map<string, { on: boolean; at: number }>();

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
  const ids =
    kind === 'tenant'
      ? (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))).map((r) => r.id)
      : (
          await db
            .select({ id: tenants.id })
            .from(tenants)
            .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
            .where(eq(organizations.slug, slug))
        ).map((r) => r.id);
  // An unknown portrait is a 404 page in English anyway; nothing to translate.
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
  const key = `${scope.kind}:${scope.slug}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.on;
  const on = await lookup(scope.kind, scope.slug);
  cache.set(key, { on, at: Date.now() });
  return on;
}

/** For tests: forget cached answers. */
export function clearTranslationPolicyCache(): void {
  cache.clear();
}
