'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { SLUG_RE } from '@deep-fryer/core';
import { customPages, customPageVersions, tenantConfig } from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { getAuth } from './auth';
import { requireTenantRoleWithFeature } from './features';
import { audit } from './audit';
import { userDb } from './db';

const content = z.object({
  pageId: z.string().uuid().optional(),
  slug: z.string().trim().min(1).max(80).regex(SLUG_RE, 'Use lowercase letters, numbers and single hyphens.'),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(60000),
});

function refresh(tenantSlug: string, pageSlug?: string) {
  revalidatePath(`/${tenantSlug}/admin/pages`);
  revalidatePath(`/${tenantSlug}/pages`);
  if (pageSlug) revalidatePath(`/${tenantSlug}/pages/${pageSlug}`);
}

export const saveCustomPage = action(async (input: { tenantSlug: string; pageId?: string; slug: string; title: string; body: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'custom_pages');
  const parsed = content.parse(input);
  const auth = await getAuth();
  const saved = await userDb(async (db) => {
    let page;
    if (parsed.pageId) {
      [page] = await db.select().from(customPages).where(and(eq(customPages.id, parsed.pageId), eq(customPages.tenantId, tenant.id))).for('update');
      if (!page) throw new UserError('Unknown page.');
      if (page.slug !== parsed.slug) throw new UserError('A page’s address stays the same across versions. Create a new page to use another address.');
    } else {
      [page] = await db.insert(customPages).values({ tenantId: tenant.id, slug: parsed.slug }).onConflictDoNothing().returning();
      if (!page) throw new UserError('A page already uses that address. Edit it or choose another address.');
    }
    const [latest] = await db.select({ versionNum: customPageVersions.versionNum }).from(customPageVersions)
      .where(eq(customPageVersions.pageId, page.id)).orderBy(desc(customPageVersions.versionNum)).limit(1);
    const [version] = await db.insert(customPageVersions).values({
      pageId: page.id, versionNum: (latest?.versionNum ?? 0) + 1, status: 'draft',
      title: parsed.title, mdxBody: parsed.body, createdBy: auth.userId,
    }).returning();
    if (!version) throw new Error('page version insert failed');
    await audit(tenant.id, 'custom_page', page.id, 'save_draft', null, { version_id: version.id, version_num: version.versionNum, slug: page.slug }, db);
    return { pageId: page.id, versionId: version.id };
  });
  refresh(tenant.slug);
  return saved;
});

export const publishCustomPage = action(async (input: { tenantSlug: string; pageId: string; versionId: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'custom_pages');
  const ids = z.object({ pageId: z.string().uuid(), versionId: z.string().uuid() }).parse(input);
  const auth = await getAuth();
  const slug = await userDb(async (db) => {
    const [page] = await db.select().from(customPages).where(and(eq(customPages.id, ids.pageId), eq(customPages.tenantId, tenant.id))).for('update');
    if (!page) throw new UserError('Unknown page.');
    const [version] = await db.select().from(customPageVersions).where(and(eq(customPageVersions.id, ids.versionId), eq(customPageVersions.pageId, page.id)));
    if (!version) throw new UserError('That version does not belong to this page.');
    const [review] = await db.select({ value: tenantConfig.value }).from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'review_policy')));
    if (!version.publishedAt && (review?.value as { dual_review_on_edits?: unknown } | undefined)?.dual_review_on_edits === true &&
        (!auth.userId || !version.createdBy || auth.userId === version.createdBy)) {
      throw new UserError('Dual review is enabled. Another signed-in editor must publish this version.');
    }
    await db.update(customPageVersions).set({ status: 'published', publishedAt: version.publishedAt ?? new Date() }).where(eq(customPageVersions.id, version.id));
    await db.update(customPages).set({ publishedVersionId: version.id }).where(eq(customPages.id, page.id));
    if (page.publishedVersionId && page.publishedVersionId !== version.id) await db.update(customPageVersions)
      .set({ status: 'archived' }).where(eq(customPageVersions.id, page.publishedVersionId));
    await audit(tenant.id, 'custom_page', page.id, 'publish', { published_version_id: page.publishedVersionId }, { published_version_id: version.id }, db);
    return page.slug;
  });
  refresh(tenant.slug, slug);
});

/** Removal is reversible: retain all versions and their publication dates. */
export const unpublishCustomPage = action(async (input: { tenantSlug: string; pageId: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'custom_pages');
  const pageId = z.string().uuid().parse(input.pageId);
  const slug = await userDb(async (db) => {
    const [page] = await db.select().from(customPages).where(and(eq(customPages.id, pageId), eq(customPages.tenantId, tenant.id))).for('update');
    if (!page) throw new UserError('Unknown page.');
    await db.update(customPages).set({ publishedVersionId: null }).where(eq(customPages.id, page.id));
    if (page.publishedVersionId) await db.update(customPageVersions).set({ status: 'archived' }).where(eq(customPageVersions.id, page.publishedVersionId));
    await audit(tenant.id, 'custom_page', page.id, 'unpublish', { published_version_id: page.publishedVersionId }, null, db);
    return page.slug;
  });
  refresh(tenant.slug, slug);
});
