import 'server-only';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { dimensions, dimensionVersions, type DbExecutor, type Tenant } from '@deep-fryer/db';
import { audit } from './audit';
import { UserError } from './action-result';

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

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, version.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new UserError('That version does not belong to this portrait.');

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
