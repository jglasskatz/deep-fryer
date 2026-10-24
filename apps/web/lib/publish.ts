import 'server-only';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { dimensions, dimensionVersions, type DbExecutor, type Tenant } from '@deep-fryer/db';
import { audit } from './audit';
import { UserError } from './action-result';
import { configValueIn } from './admin-data';
import { getAuth } from './auth';

/**
 * Publish (or revert to) a version: repoint published_version_id, archive the
 * previously published one. Versions are immutable; publishing only moves
 * status and the pointer. The three writes are one transaction so the public
 * plane never observes a dimension with no published version mid-swap.
 *
 * Callers have already authorized the tenant (editor+) and pass their userDb
 * transaction, so row-level security re-checks the editor role and the audit
 * entry commits with the change. Shared by the publish action,
 * approve-and-publish, and flag-gap.
 */
export async function publishVersionFor(
  db: DbExecutor,
  tenant: Tenant,
  versionId: string,
  revert = false,
) {
  const [version] = await db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.id, versionId));
  if (!version) throw new UserError('Unknown version.');

  // Serialize the pointer and archive updates for concurrent publications.
  await db.execute(sql`select id from dimensions where id = ${version.dimensionId}::uuid for update`);

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, version.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new UserError('That version does not belong to this portrait.');

  const policy = await configValueIn(db, tenant.id, 'review_policy');
  if (policy?.dual_review_on_edits && version.origin === 'human' && !version.publishedAt) {
    const { userId } = await getAuth();
    if (!userId || !version.createdBy || userId === version.createdBy) {
      throw new UserError('A second editor must review and publish this edit because this portrait requires dual review. The draft is saved.');
    }
  }

  const previousPublishedId = dimension.publishedVersionId;

  await db.transaction(async (tx) => {
    await tx
      .update(dimensionVersions)
      .set({ status: 'published', publishedAt: version.publishedAt ?? new Date() })
      .where(eq(dimensionVersions.id, version.id));

    if (previousPublishedId && previousPublishedId !== version.id) {
      await tx
        .update(dimensionVersions)
        .set({ status: 'archived' })
        .where(eq(dimensionVersions.id, previousPublishedId));
    }

    await tx
      .update(dimensions)
      .set({ publishedVersionId: version.id })
      .where(eq(dimensions.id, dimension.id));
  });

  await audit(
    tenant.id,
    'dimension',
    dimension.id,
    revert ? 'revert' : 'publish',
    { published_version_id: previousPublishedId },
    { published_version_id: version.id, version_num: version.versionNum },
    db,
  );

  revalidatePath(`/${tenant.slug}`);
  revalidatePath(`/${tenant.slug}/admin`);
}
