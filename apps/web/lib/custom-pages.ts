import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { customPages, customPageVersions, tenants, withAuthContext } from '@deep-fryer/db';
import { systemDb, userDb } from './db';
import { hasDatabase } from './env';
import { portraitFeatures } from './features';

export async function listCustomPagesForAdmin(tenantId: string) {
  return userDb(async (db) => {
    const pages = await db.select().from(customPages).where(eq(customPages.tenantId, tenantId)).orderBy(customPages.slug);
    const versions = pages.length ? await db.select().from(customPageVersions)
      .where(inArray(customPageVersions.pageId, pages.map((page) => page.id)))
      .orderBy(desc(customPageVersions.versionNum)) : [];
    return pages.map((page) => ({ ...page, versions: versions.filter((version) => version.pageId === page.id) }));
  });
}

/** Always anonymous: publication data must not change with the caller's cookies. */
export async function publishedCustomPages(tenantSlug: string) {
  if (!hasDatabase()) return [];
  if (!(await portraitFeatures(tenantSlug)).custom_pages) return [];
  return withAuthContext(systemDb(), null, (db) => db.select({
    slug: customPages.slug,
    title: customPageVersions.title,
    mdxBody: customPageVersions.mdxBody,
    versionNum: customPageVersions.versionNum,
    publishedAt: customPageVersions.publishedAt,
  }).from(customPages)
    .innerJoin(tenants, eq(tenants.id, customPages.tenantId))
    .innerJoin(customPageVersions, and(eq(customPageVersions.id, customPages.publishedVersionId), eq(customPageVersions.pageId, customPages.id)))
    .where(and(eq(tenants.slug, tenantSlug), eq(customPageVersions.status, 'published')))
    .orderBy(customPages.slug));
}

export async function publishedCustomPage(tenantSlug: string, slug: string) {
  return (await publishedCustomPages(tenantSlug)).find((page) => page.slug === slug) ?? null;
}
