'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, max } from 'drizzle-orm';
import {
  computeScoring,
  deriveVizLevel,
  dimensionDataSchema,
  resolveThreshold,
  tenantConfigSchemas,
  type DimensionData,
  type Indicator,
  type TenantConfigKey,
} from '@deep-fryer/core';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  getDb,
  tenantConfig,
  tenants,
} from '@deep-fryer/db';
import { getAuth, requireRole } from './auth';
import { configValue } from './admin-data';

async function tenantOrThrow(slug: string) {
  const db = getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!tenant) throw new Error(`unknown tenant '${slug}'`);
  return tenant;
}

async function audit(
  tenantId: string,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
) {
  const db = getDb();
  const auth = await getAuth();
  await db.insert(auditLog).values({
    tenantId,
    userId: auth.userId,
    entity,
    entityId,
    action,
    before: before ?? null,
    after: after ?? null,
  });
}

/**
 * Re-run the thresholds engine over numeric indicators (SPEC.md §8 Scoring):
 * threshold comes from the contract, overridden by tenant config; the worked
 * arithmetic is stored on the indicator.
 */
function rescore(
  data: DimensionData,
  dimensionSlug: string,
  overrides: Record<string, { target: number; rationale: string }> | null,
): DimensionData {
  const frameworkDim = frameworkDimension(dimensionSlug);
  const indicators: Indicator[] = data.indicators.map((ind) => {
    const ref =
      ind.scoring?.threshold_ref ??
      frameworkDim?.indicators.find((fi) => fi.name === ind.name)?.threshold_ref;
    if (!ref || typeof ind.value !== 'number') return ind;
    const threshold = resolveThreshold(ref, overrides ?? undefined);
    if (!threshold) return ind;
    try {
      const { level_pct, scoring } = computeScoring(ind.value, ref, threshold);
      return {
        ...ind,
        level_pct,
        scoring,
        target: typeof ind.target === 'number' || ind.target === null ? threshold.target : ind.target,
      };
    } catch {
      return ind;
    }
  });
  return { ...data, indicators };
}

export interface SaveDimensionEditInput {
  tenantSlug: string;
  dimensionId: string;
  data: DimensionData;
  changeNote: string;
}

/**
 * Human edit → new immutable version, origin 'human' (SPEC.md §7):
 * change_note required, and any indicator whose value changed must carry a
 * supporting_source_url — human edits meet the same provenance bar as
 * research.
 */
export async function saveDimensionEdit(input: SaveDimensionEditInput) {
  const tenant = await tenantOrThrow(input.tenantSlug);
  await requireRole(tenant.id, 'editor');
  const db = getDb();

  const changeNote = input.changeNote.trim();
  if (!changeNote) throw new Error('a change note is required for human edits');

  const parsed = dimensionDataSchema.parse(input.data) as DimensionData;

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new Error('unknown dimension');

  const maxRows = await db
    .select({ maxVersion: max(dimensionVersions.versionNum) })
    .from(dimensionVersions)
    .where(eq(dimensionVersions.dimensionId, dimension.id));
  const maxVersion = maxRows[0]?.maxVersion ?? null;

  const [previous] = maxVersion
    ? await db
        .select()
        .from(dimensionVersions)
        .where(
          and(
            eq(dimensionVersions.dimensionId, dimension.id),
            eq(dimensionVersions.versionNum, maxVersion),
          ),
        )
    : [];

  // Value changes need supporting sources (SPEC.md §7 immutability contract).
  if (previous) {
    const prevByName = new Map(previous.data.indicators.map((i) => [i.name, i]));
    for (const ind of parsed.indicators) {
      const prev = prevByName.get(ind.name);
      const valueChanged = !prev || String(prev.value ?? '') !== String(ind.value ?? '');
      if (valueChanged && ind.value !== null && !ind.supporting_source_url?.trim()) {
        throw new Error(
          `indicator '${ind.name}': value changes require a supporting source URL`,
        );
      }
    }
  }

  const overrides = await configValue(tenant.id, 'threshold_overrides');
  const rescored = rescore(parsed, dimension.slug, overrides);
  const vizLevel = deriveVizLevel(rescored) ?? previous?.vizLevel ?? null;

  const auth = await getAuth();
  const [version] = await db
    .insert(dimensionVersions)
    .values({
      dimensionId: dimension.id,
      versionNum: (maxVersion ?? 0) + 1,
      status: 'draft',
      data: rescored,
      vizLevel,
      origin: 'human',
      changeNote,
      createdBy: auth.userId,
    })
    .returning();
  if (!version) throw new Error('version insert failed');

  await audit(tenant.id, 'dimension_version', version.id, 'create_human_version', null, {
    dimension: dimension.slug,
    version_num: version.versionNum,
    change_note: changeNote,
  });

  revalidatePath(`/${tenant.slug}/admin`);
  return { versionId: version.id, versionNum: version.versionNum };
}

/**
 * Publish (or revert to) a version: repoint published_version_id, archive the
 * previously published one. Versions are immutable; publishing only moves
 * status and the pointer.
 */
export async function publishVersion(input: {
  tenantSlug: string;
  versionId: string;
  revert?: boolean;
}) {
  const tenant = await tenantOrThrow(input.tenantSlug);
  await requireRole(tenant.id, 'editor');
  const db = getDb();

  const [version] = await db
    .select()
    .from(dimensionVersions)
    .where(eq(dimensionVersions.id, input.versionId));
  if (!version) throw new Error('unknown version');

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, version.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new Error('version does not belong to this tenant');

  const previousPublishedId = dimension.publishedVersionId;

  await db
    .update(dimensionVersions)
    .set({ status: 'published', publishedAt: version.publishedAt ?? new Date() })
    .where(eq(dimensionVersions.id, version.id));

  if (previousPublishedId && previousPublishedId !== version.id) {
    await db
      .update(dimensionVersions)
      .set({ status: 'archived' })
      .where(eq(dimensionVersions.id, previousPublishedId));
  }

  await db
    .update(dimensions)
    .set({ publishedVersionId: version.id })
    .where(eq(dimensions.id, dimension.id));

  await audit(
    tenant.id,
    'dimension',
    dimension.id,
    input.revert ? 'revert' : 'publish',
    { published_version_id: previousPublishedId },
    { published_version_id: version.id, version_num: version.versionNum },
  );

  revalidatePath(`/${tenant.slug}`);
  revalidatePath(`/${tenant.slug}/admin`);
}

/** Validated write to a §6 config key; every change is audited. */
export async function updateConfig(input: {
  tenantSlug: string;
  key: TenantConfigKey;
  value: unknown;
}) {
  const tenant = await tenantOrThrow(input.tenantSlug);
  await requireRole(tenant.id, 'owner');
  const db = getDb();

  const schema = tenantConfigSchemas[input.key];
  if (!schema) throw new Error(`unknown config key '${input.key}'`);
  const value = schema.parse(input.value);

  const [existing] = await db
    .select()
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, input.key)));

  const auth = await getAuth();
  await db
    .insert(tenantConfig)
    .values({
      tenantId: tenant.id,
      key: input.key,
      value,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [tenantConfig.tenantId, tenantConfig.key],
      set: { value, updatedBy: auth.userId, updatedAt: new Date() },
    });

  await audit(tenant.id, 'tenant_config', tenant.id, `config:${input.key}`, existing?.value, value);

  revalidatePath(`/${tenant.slug}/admin/settings`);
  revalidatePath(`/${tenant.slug}/methodology`);
}
