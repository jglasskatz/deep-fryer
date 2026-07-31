import { framework, defaultPortraitConfig, getThreshold } from '@deep-fryer/contract';
import {
  defaultNotifications,
  defaultRetention,
  defaultReviewPolicy,
  type DimensionData,
} from '@deep-fryer/core';
import { eq } from 'drizzle-orm';
import type { getDb } from './client.js';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  tenantConfig,
  tenantMembers,
  tenants,
} from './schema.js';

type Db = ReturnType<typeof getDb>;

export interface ProvisionTenantArgs {
  slug: string;
  name: string;
  region?: string;
  population?: number;
  description?: string;
  /** Supabase auth user id of the owner; omitted in local dev. */
  ownerUserId?: string;
}

/**
 * Provision a tenant the way onboarding does (SPEC.md §12 M0): tenant row,
 * §6 config defaults, the 21 framework dimensions, and an initial draft
 * version per dimension with indicators prefilled from the contract
 * (value null, target from thresholds) so the review plane has real shape
 * from day one.
 */
export async function provisionTenant(db: Db, args: ProvisionTenantArgs) {
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: args.slug,
      name: args.name,
      region: args.region,
      population: args.population,
      description: args.description,
    })
    .returning();
  if (!tenant) throw new Error('tenant insert returned no row');

  if (args.ownerUserId) {
    await db.insert(tenantMembers).values({
      tenantId: tenant.id,
      userId: args.ownerUserId,
      role: 'owner',
      joinedAt: new Date(),
    });
  }

  const portrait = defaultPortraitConfig(args.name, args.region ?? args.name);
  const configRows = [
    { key: 'region', value: portrait.region },
    { key: 'source_priority', value: portrait.source_priority },
    { key: 'recency', value: portrait.recency },
    { key: 'scale_policy', value: portrait.scale_policy },
    { key: 'threshold_overrides', value: {} },
    { key: 'review_policy', value: defaultReviewPolicy },
    { key: 'retention', value: defaultRetention },
    { key: 'notifications', value: defaultNotifications },
  ];
  await db.insert(tenantConfig).values(
    configRows.map((row) => ({
      tenantId: tenant.id,
      key: row.key,
      value: row.value,
      updatedBy: args.ownerUserId,
    })),
  );

  const created: { dimensionId: string; slug: string }[] = [];
  let order = 0;
  for (const dim of framework.dimensions) {
    const [dimension] = await db
      .insert(dimensions)
      .values({
        tenantId: tenant.id,
        ring: dim.ring,
        slug: dim.slug,
        canonicalSlug: dim.canonical_slug,
        displayOrder: order++,
      })
      .returning();
    if (!dimension) throw new Error(`dimension insert returned no row for ${dim.slug}`);

    const data: DimensionData = {
      name: dim.name,
      icon: dim.icon,
      description: dim.description,
      context: '',
      indicators: dim.indicators.map((ind) => ({
        name: ind.name,
        value: null,
        unit: ind.unit,
        year: null,
        target: getThreshold(ind.threshold_ref)?.target ?? null,
        source: '',
        source_url: '',
        confidence: 'low' as const,
        geographic_scale: 'city' as const,
      })),
      actions: [],
    };

    const [version] = await db
      .insert(dimensionVersions)
      .values({
        dimensionId: dimension.id,
        versionNum: 1,
        status: 'draft',
        data,
        origin: 'import',
        createdBy: args.ownerUserId,
      })
      .returning();
    if (!version) throw new Error(`version insert returned no row for ${dim.slug}`);
    created.push({ dimensionId: dimension.id, slug: dim.slug });
  }

  await db.insert(auditLog).values({
    tenantId: tenant.id,
    userId: args.ownerUserId,
    entity: 'tenant',
    entityId: tenant.id,
    action: 'provision',
    after: { slug: args.slug, name: args.name, dimensions: created.length },
  });

  return { tenant, dimensions: created };
}

export async function tenantBySlug(db: Db, slug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return tenant ?? null;
}
