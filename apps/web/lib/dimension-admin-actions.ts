'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { framework } from '@deep-fryer/contract';
import { SLUG_RE } from '@deep-fryer/core';
import { appendDimensionVersion, dimensions, tenants } from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { userDb } from './db';

const newDimension = z.object({
  slug: z.string().trim().min(1).max(80).regex(SLUG_RE), name: z.string().trim().min(1).max(160),
  ring: z.enum(['social', 'ecological']), canonicalSlug: z.string().optional(),
  indicatorNames: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
});
function refresh(slug: string) {
  revalidatePath(`/${slug}`); revalidatePath(`/${slug}/admin`); revalidatePath(`/${slug}/admin/manage`);
  revalidatePath(`/${slug}/admin/research`);
}

export const createDimension = action(async (input: { tenantSlug: string; slug: string; name: string; ring: 'social' | 'ecological'; canonicalSlug?: string; indicatorNames?: string[] }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const parsed = newDimension.parse(input);
  const canonical = parsed.canonicalSlug ? framework.dimensions.find(d => d.slug === parsed.canonicalSlug) : null;
  if (parsed.canonicalSlug && (!canonical || canonical.ring !== parsed.ring)) throw new UserError('Choose a framework dimension from the same ring.');
  if (canonical && parsed.indicatorNames?.length) throw new UserError('A framework reference uses its fixed indicators. Choose a custom dimension to define your own indicator names.');
  if (new Set(parsed.indicatorNames ?? []).size !== (parsed.indicatorNames?.length ?? 0)) throw new UserError('Indicator names must be distinct.');
  const auth = await getAuth();
  const seededIndicators = parsed.indicatorNames?.length
    ? parsed.indicatorNames.map(name => ({ name, unit: '' }))
    : canonical?.indicators.map(indicator => ({ name: indicator.name, unit: indicator.unit })) ?? [];
  const saved = await userDb(async db => {
    // Serialize structural changes so creation and reordering cannot race.
    await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenant.id)).for('update');
    const [existing] = await db.select({ id: dimensions.id }).from(dimensions).where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, parsed.slug)));
    if (existing) throw new UserError('That dimension address already exists, including archived dimensions. Restore it or choose another address.');
    const [last] = await db.select({ order: dimensions.displayOrder }).from(dimensions).where(eq(dimensions.tenantId, tenant.id)).orderBy(desc(dimensions.displayOrder)).limit(1);
    const [dimension] = await db.insert(dimensions).values({ tenantId: tenant.id, slug: parsed.slug, ring: parsed.ring, canonicalSlug: canonical?.slug ?? null, displayOrder: (last?.order ?? -1) + 1 }).returning();
    if (!dimension) throw new Error('dimension insert failed');
    const version = await appendDimensionVersion(db, { dimensionId: dimension.id, status: 'draft', origin: 'human', createdBy: auth.userId,
      changeNote: 'Create a custom dimension.', data: { name: parsed.name, icon: '', description: '', context: '', actions: [],
        indicators: seededIndicators.map(indicator => ({ ...indicator, value: null, year: null, target: null, source: '', source_url: '', confidence: 'low' as const, geographic_scale: 'city' as const })) }, vizLevel: null });
    await audit(tenant.id, 'dimension', dimension.id, 'create', null, { slug: dimension.slug, ring: dimension.ring, version_id: version.id }, db);
    return { dimensionId: dimension.id, versionId: version.id };
  });
  refresh(tenant.slug);
  return saved;
});

export const setDimensionArchived = action(async (input: { tenantSlug: string; dimensionId: string; archived: boolean; reason: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const parsed = z.object({ dimensionId: z.string().uuid(), archived: z.boolean(), reason: z.string().trim().min(1).max(1200) }).parse(input);
  await userDb(async db => {
    await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenant.id)).for('update');
    const [dimension] = await db.select().from(dimensions).where(and(eq(dimensions.id, parsed.dimensionId), eq(dimensions.tenantId, tenant.id))).for('update');
    if (!dimension) throw new UserError('Unknown dimension.');
    await db.update(dimensions).set({ archivedAt: parsed.archived ? new Date() : null }).where(eq(dimensions.id, dimension.id));
    await audit(tenant.id, 'dimension', dimension.id, parsed.archived ? 'archive' : 'restore', { archived_at: dimension.archivedAt }, { archived: parsed.archived, reason: parsed.reason }, db);
  });
  refresh(tenant.slug);
});

export const reorderDimensions = action(async (input: { tenantSlug: string; dimensionIds: string[] }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const ids = z.array(z.string().uuid()).min(1).max(200).parse(input.dimensionIds);
  await userDb(async db => {
    await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenant.id)).for('update');
    const active = await db.select({ id: dimensions.id }).from(dimensions).where(and(eq(dimensions.tenantId, tenant.id), isNull(dimensions.archivedAt))).orderBy(dimensions.displayOrder);
    const expected = new Set(active.map(row => row.id));
    if (new Set(ids).size !== ids.length || ids.length !== expected.size || ids.some(id => !expected.has(id))) throw new UserError('Reorder every active dimension exactly once. Reload the page if the list changed.');
    for (const [order, id] of ids.entries()) await db.update(dimensions).set({ displayOrder: order }).where(eq(dimensions.id, id));
    await audit(tenant.id, 'tenant', tenant.id, 'reorder_dimensions', { dimension_ids: active.map(row => row.id) }, { dimension_ids: ids }, db);
  });
  refresh(tenant.slug);
});
