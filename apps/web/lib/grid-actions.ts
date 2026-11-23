'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import { deriveVizLevel } from '@deep-fryer/core';
import { appendDimensionVersion, dimensions, latestVersionsByDimension } from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { configValueIn } from './admin-data';
import { audit } from './audit';
import { getAuth, requireTenantRole } from './auth';
import { userDb } from './db';
import {
  applyDimensionGridEdits,
  groupGridEdits,
  saveGridEditsSchema,
  type SavedDimensionDraft,
  type SaveGridEditsInput,
  type SaveGridEditsResult,
} from './grid-edits';

/**
 * Save staged edits from the Data page's grid as new immutable draft versions
 * (SPEC.md §7), one draft version and one audit_log entry per touched
 * dimension, all inside a single userDb transaction (one-connection pool rule:
 * no nested transactions or secondary pooled queries).
 *
 * Authorization runs first (editor role or higher; viewers and signed-out
 * visitors are refused before input validation or database reads). Never
 * publishes automatically.
 */
export const saveGridEdits = action(async (input: SaveGridEditsInput): Promise<SaveGridEditsResult> => {
  const rawSlug =
    typeof (input as Partial<SaveGridEditsInput> | null)?.tenantSlug === 'string' ? input.tenantSlug : '';
  const { tenant } = await requireTenantRole(rawSlug, 'editor');

  const parsed = saveGridEditsSchema.parse(input);
  const grouped = groupGridEdits(parsed.edits);

  const saved = await userDb(async (db) => {
    const dimIds = [...grouped.keys()];
    const dimRows = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.tenantId, tenant.id), inArray(dimensions.id, dimIds), isNull(dimensions.archivedAt)));
    const dimById = new Map(dimRows.map((d) => [d.id, d]));

    for (const dimId of dimIds) {
      if (!dimById.has(dimId)) {
        throw new UserError('One or more edited dimensions could not be found in this portrait.');
      }
    }

    // Read latest versions and threshold overrides on THIS transaction (never a second pooled connection).
    const latestByDim = await latestVersionsByDimension(db, dimIds);
    const overrides = await configValueIn(db, tenant.id, 'threshold_overrides');
    const auth = await getAuth();

    const results: SavedDimensionDraft[] = [];

    for (const [dimId, group] of grouped) {
      const dimension = dimById.get(dimId)!;
      const previous = latestByDim.get(dimId);
      if (!previous) {
        throw new UserError(`Dimension '${dimension.slug}' has no saved version to edit.`);
      }
      if (previous.versionNum !== group.baseVersion) {
        const dimName =
          previous.data.name?.trim() ||
          frameworkDimension(dimension.slug, dimension.canonicalSlug)?.name ||
          dimension.slug;
        throw new UserError(
          `${dimName} was updated since this table loaded (now v${previous.versionNum}, expected v${group.baseVersion}). Reload the page to see the latest values before saving.`,
        );
      }

      const nextData = applyDimensionGridEdits(dimension, previous.data, group.byRowId, overrides);
      const vizLevel = deriveVizLevel(nextData);

      const indicatorCount = group.byRowId.size;
      const cellCount = [...group.byRowId.values()].reduce((sum, cols) => sum + cols.size, 0);
      const note =
        parsed.changeNote ||
        `Edited ${cellCount} ${cellCount === 1 ? 'cell' : 'cells'} across ${indicatorCount} ${indicatorCount === 1 ? 'indicator' : 'indicators'} in the data table.`;

      const version = await appendDimensionVersion(db, {
        dimensionId: dimension.id,
        status: 'draft',
        data: nextData,
        vizLevel,
        origin: 'human',
        changeNote: note,
        createdBy: auth.userId,
      });

      await audit(
        tenant.id,
        'dimension_version',
        version.id,
        'create_human_version',
        null,
        {
          dimension: dimension.slug,
          version_num: version.versionNum,
          change_note: note,
          source: 'data_grid',
          edited_rows: [...group.byRowId.keys()],
          edited_cells: cellCount,
        },
        db,
      );

      results.push({
        dimensionId: dimension.id,
        dimensionSlug: dimension.slug,
        dimensionName: nextData.name || dimension.slug,
        versionId: version.id,
        versionNum: version.versionNum,
        indicatorCount,
        cellCount,
      });
    }

    return results;
  });

  revalidatePath(`/${tenant.slug}/admin`);
  revalidatePath(`/${tenant.slug}/admin/data`);
  for (const dim of saved) {
    revalidatePath(`/${tenant.slug}/admin/dim/${dim.dimensionId}`);
  }

  return {
    dimensions: saved,
    totalIndicators: saved.reduce((sum, d) => sum + d.indicatorCount, 0),
    totalCells: saved.reduce((sum, d) => sum + d.cellCount, 0),
  };
});
