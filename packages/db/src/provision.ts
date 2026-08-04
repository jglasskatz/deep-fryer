import { framework, getThreshold } from '@deep-fryer/contract';
import { defaultTenantConfig, type DimensionData } from '@deep-fryer/core';
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

  const config = defaultTenantConfig(args.name, args.region ?? args.name);
  await db.insert(tenantConfig).values(
    Object.entries(config).map(([key, value]) => ({
      tenantId: tenant.id,
      key,
      value,
      updatedBy: args.ownerUserId,
    })),
  );

  const insertedDims = await db
    .insert(dimensions)
    .values(
      framework.dimensions.map((dim, order) => ({
        tenantId: tenant.id,
        ring: dim.ring,
        slug: dim.slug,
        canonicalSlug: dim.canonical_slug,
        displayOrder: order,
      })),
    )
    .returning();
  const dimIdBySlug = new Map(insertedDims.map((d) => [d.slug, d.id]));

  const versionRows = framework.dimensions.map((dim) => {
    const dimensionId = dimIdBySlug.get(dim.slug);
    if (!dimensionId) throw new Error(`dimension insert missing for ${dim.slug}`);
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
    return {
      dimensionId,
      versionNum: 1,
      status: 'draft' as const,
      data,
      origin: 'import' as const,
      createdBy: args.ownerUserId,
    };
  });
  await db.insert(dimensionVersions).values(versionRows);

  await db.insert(auditLog).values({
    tenantId: tenant.id,
    userId: args.ownerUserId,
    entity: 'tenant',
    entityId: tenant.id,
    action: 'provision',
    after: { slug: args.slug, name: args.name, dimensions: insertedDims.length },
  });

  return {
    tenant,
    dimensions: insertedDims.map((d) => ({ dimensionId: d.id, slug: d.slug })),
  };
}

export async function tenantBySlug(db: Db, slug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return tenant ?? null;
}
