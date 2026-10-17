import 'server-only';
import { cache } from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { SAMPLE_DATA_CONFIG_KEY, SLUG_RE, isSampleDataValue } from '@deep-fryer/core';
import { tenantConfig, tenants, withAuthContext, type DbExecutor } from '@deep-fryer/db';
import { systemDb, userDb } from './db';
import { hasDatabase } from './env';

/*
 * Which portraits carry sample data (core SAMPLE_DATA_CONFIG_KEY, set by
 * scripts/seed-demo-data.ts), for the "Sample data — not research" notice
 * on the public plane and the open-data API's top-level flag.
 *
 * The key is publicly readable for a public portrait (migration 0015), and
 * members read their own portrait's config, so the pages ask as the person
 * — exactly the portraits they can see — and the API asks as an anonymous
 * visitor, like the rest of its shared, cacheable answer (lib/data.ts
 * getPublicPortrait).
 *
 * Without a database there are no stored marks: the bundled demo portrait
 * carries its own "Demo data" line (m.portrait.demoHint) instead.
 */

/** The slugs among `slugs` whose portrait is marked, read on the caller's executor. */
async function markedSlugsIn(db: DbExecutor, slugs: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ slug: tenants.slug, value: tenantConfig.value })
    .from(tenantConfig)
    .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
    .where(and(inArray(tenants.slug, slugs), eq(tenantConfig.key, SAMPLE_DATA_CONFIG_KEY)));
  return new Set(rows.filter((r) => isSampleDataValue(r.value)).map((r) => r.slug));
}

/** Only well-formed slugs reach a query; nothing else can name a portrait (core slugError). */
const wellFormed = (slugs: string[]): string[] => [...new Set(slugs)].filter((s) => SLUG_RE.test(s));

/**
 * Whether any of these portraits carries sample data, as the person asking
 * sees them — for an organization's pages (compare, insights, progress),
 * which show every member at once: one marked portrait labels the page.
 */
export async function anySampleData(slugs: string[]): Promise<boolean> {
  const wanted = wellFormed(slugs);
  if (!hasDatabase() || wanted.length === 0) return false;
  return (await userDb((db) => markedSlugsIn(db, wanted))).size > 0;
}

/** One portrait's mark, as the person asking sees it; once per request (a page and its parts share it). */
export const portraitSampleData = cache(async (slug: string): Promise<boolean> => anySampleData([slug]));

/**
 * One portrait's mark as the public sees it, whoever is asking: read as an
 * anonymous visitor, so it answers only for a public portrait (false for
 * one that is not, which the API turns away before asking anyway). Its own
 * short transaction on the pooled client; not for use inside another one.
 */
export async function publicPortraitSampleData(slug: string): Promise<boolean> {
  const wanted = wellFormed([slug]);
  if (!hasDatabase() || wanted.length === 0) return false;
  return (await withAuthContext(systemDb(), null, (db) => markedSlugsIn(db, wanted))).size > 0;
}
