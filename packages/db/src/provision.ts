import { framework, getThreshold } from '@deep-fryer/contract';
import {
  TRIAL_DAYS,
  defaultTenantConfig,
  slugError,
  type DimensionData,
  type PlanId,
} from '@deep-fryer/core';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import {
  auditLog,
  dimensions,
  dimensionVersions,
  organizationMembers,
  organizations,
  subscriptions,
  tenantConfig,
  tenantMembers,
  tenants,
  type Organization,
} from './schema.js';

export interface ProvisionOrganizationArgs {
  slug: string;
  name: string;
  billingEmail?: string;
  /** Becomes the organization's owner (and so owner of all its portraits). */
  ownerUserId?: string;
  /**
   * Starting plan. 'trial' starts a TRIAL_DAYS self-serve trial; a contract
   * plan is set by staff tooling (scripts/seed-nyc-org.ts). Omitted = no
   * subscription row (the organization must choose a plan to research).
   */
  startTrial?: boolean;
}

/** Create an organization, its owner membership, and optionally a trial. */
export async function provisionOrganization(
  db: DbExecutor,
  args: ProvisionOrganizationArgs,
): Promise<Organization> {
  const err = slugError(args.slug);
  if (err) throw new Error(`organization slug: ${err}`);

  const [org] = await db
    .insert(organizations)
    .values({ slug: args.slug, name: args.name, billingEmail: args.billingEmail })
    .returning();
  if (!org) throw new Error('organization insert returned no row');

  if (args.ownerUserId) {
    await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: args.ownerUserId, role: 'owner' });
  }

  if (args.startTrial) {
    const start = new Date();
    const end = new Date(start.getTime() + TRIAL_DAYS * 86_400_000);
    await db.insert(subscriptions).values({
      organizationId: org.id,
      plan: 'trial' satisfies PlanId,
      status: 'trialing',
      collection: 'card',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialEndsAt: end,
    });
  }
  return org;
}

export interface ProvisionTenantArgs {
  slug: string;
  name: string;
  region?: string;
  population?: number;
  description?: string;
  /**
   * The organization that will hold this portrait. Omitted = a new
   * single-portrait organization with the same slug and name (the v2
   * provisioning shape).
   */
  organizationId?: string;
  /** Owner of the portrait (tenant-level role); also org owner when the org is new. */
  ownerUserId?: string;
  familyOrder?: number;
  shortName?: string;
}

/**
 * Provision a tenant the way onboarding does (SPEC.md §12 M0): tenant row,
 * §6 config defaults, the 21 framework dimensions, and an initial draft
 * version per dimension with indicators prefilled from the contract (value
 * null, target from thresholds) so the review plane has real shape from day
 * one.
 *
 * Transactional (SPEC-v3 §2.2 item 4): a failure anywhere leaves no
 * half-provisioned tenant behind.
 */
export async function provisionTenant(db: DbExecutor, args: ProvisionTenantArgs) {
  const err = slugError(args.slug);
  if (err) throw new Error(`portrait slug: ${err}`);

  return db.transaction(async (tx) => {
    const organizationId =
      args.organizationId ??
      (
        await provisionOrganization(tx, {
          slug: args.slug,
          name: args.name,
          ownerUserId: args.ownerUserId,
        })
      ).id;

    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: args.slug,
        name: args.name,
        region: args.region,
        population: args.population,
        description: args.description,
        organizationId,
        familyOrder: args.familyOrder ?? 0,
        shortName: args.shortName,
      })
      .returning();
    if (!tenant) throw new Error('tenant insert returned no row');

    if (args.ownerUserId) {
      await tx.insert(tenantMembers).values({
        tenantId: tenant.id,
        userId: args.ownerUserId,
        role: 'owner',
        joinedAt: new Date(),
      });
    }

    const config = defaultTenantConfig(args.name, args.region ?? args.name);
    await tx.insert(tenantConfig).values(
      Object.entries(config).map(([key, value]) => ({
        tenantId: tenant.id,
        key,
        value,
        updatedBy: args.ownerUserId,
      })),
    );

    const insertedDims = await tx
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
    await tx.insert(dimensionVersions).values(versionRows);

    await tx.insert(auditLog).values({
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
  });
}

export async function tenantBySlug(db: DbExecutor, slug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return tenant ?? null;
}

export async function organizationBySlug(db: DbExecutor, slug: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return org ?? null;
}
