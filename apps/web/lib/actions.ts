'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
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
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  getDb,
  latestVersion,
  tenantConfig,
} from '@deep-fryer/db';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { configValue } from './admin-data';
import { action, UserError } from './action-result';
import { publishVersionFor } from './publish';

/**
 * Re-run the thresholds engine over numeric indicators (SPEC.md §8 Scoring):
 * threshold comes from the contract, overridden by tenant config; the worked
 * arithmetic is stored on the indicator.
 */
function rescore(
  data: DimensionData,
  dimensionSlug: string,
  canonicalSlug: string | null,
  overrides: Record<string, { target: number; rationale: string }> | null,
): DimensionData {
  const frameworkDim = frameworkDimension(dimensionSlug, canonicalSlug);
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
export const saveDimensionEdit = action(async (input: SaveDimensionEditInput) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const db = getDb();

  const changeNote = input.changeNote.trim();
  if (!changeNote) throw new UserError('A change note is required for human edits.');

  const parsed = dimensionDataSchema.parse(input.data) as DimensionData;

  const [dimension] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
  if (!dimension) throw new UserError('Unknown dimension.');

  const previous = await latestVersion(db, dimension.id);

  // Value changes need supporting sources (SPEC.md §7 immutability contract).
  if (previous) {
    const prevByName = new Map(previous.data.indicators.map((i) => [i.name, i]));
    for (const ind of parsed.indicators) {
      const prev = prevByName.get(ind.name);
      const valueChanged = !prev || String(prev.value ?? '') !== String(ind.value ?? '');
      if (valueChanged && ind.value !== null && !ind.supporting_source_url?.trim()) {
        throw new UserError(
          `Indicator '${ind.name}': value changes require a supporting source URL.`,
        );
      }
    }
  }

  const overrides = await configValue(tenant.id, 'threshold_overrides');
  const rescored = rescore(parsed, dimension.slug, dimension.canonicalSlug, overrides);
  const vizLevel = deriveVizLevel(rescored) ?? previous?.vizLevel ?? null;

  const auth = await getAuth();
  const version = await appendDimensionVersion(db, {
    dimensionId: dimension.id,
    status: 'draft',
    data: rescored,
    vizLevel,
    origin: 'human',
    changeNote,
    createdBy: auth.userId,
  });

  await audit(tenant.id, 'dimension_version', version.id, 'create_human_version', null, {
    dimension: dimension.slug,
    version_num: version.versionNum,
    change_note: changeNote,
  });

  revalidatePath(`/${tenant.slug}/admin`);
  return { versionId: version.id, versionNum: version.versionNum };
});

export const publishVersion = action(
  async (input: { tenantSlug: string; versionId: string; revert?: boolean }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    await publishVersionFor(tenant, input.versionId, input.revert);
  },
);

/** Validated write to a §6 config key; every change is audited. */
export const updateConfig = action(async (input: {
  tenantSlug: string;
  key: TenantConfigKey;
  value: unknown;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const db = getDb();

  const schema = tenantConfigSchemas[input.key];
  if (!schema) throw new UserError(`Unknown config key '${input.key}'.`);
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
});
