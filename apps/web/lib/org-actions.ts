'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { effectiveLimits, slugError, standing } from '@deep-fryer/core';
import {
  organizationBySlug,
  organizationMembers,
  portraitCount,
  provisionOrganization,
  provisionTenant,
  subscriptionFor,
  subscriptions,
  tenantBySlug,
  tenantConfig,
  type DbExecutor,
} from '@deep-fryer/db';
import { getAuth, requireOrgRole } from './auth';
import { action, UserError } from './action-result';
import { systemDb } from './db';

const portraitSchema = z.object({
  name: z.string().trim().min(2, 'Name the jurisdiction.').max(120),
  slug: z.string().trim().toLowerCase(),
  region: z.string().trim().min(2, 'Give the state/province and country, e.g. "NY, USA".').max(80),
  definition: z
    .string()
    .trim()
    .min(10, 'Describe the boundary research should target (e.g. "City of Ithaca municipal boundary").')
    .max(500),
  population: z.coerce.number().int().positive().max(100_000_000).optional(),
});

async function assertSlugFree(db: DbExecutor, slug: string) {
  const err = slugError(slug);
  if (err) throw new UserError(err);
  const [tenant, org] = await Promise.all([tenantBySlug(db, slug), organizationBySlug(db, slug)]);
  if (tenant || org) throw new UserError(`"${slug}" is taken — choose another address.`);
}

async function writeRegion(
  db: DbExecutor,
  tenantId: string,
  p: z.infer<typeof portraitSchema>,
  userId: string | null,
) {
  const region = { name: p.name, definition: p.definition };
  await db
    .insert(tenantConfig)
    .values({ tenantId, key: 'region', value: region, updatedBy: userId })
    .onConflictDoUpdate({
      target: [tenantConfig.tenantId, tenantConfig.key],
      set: { value: region, updatedBy: userId, updatedAt: new Date() },
    });
}

/**
 * Self-serve start (SPEC-v4 §2): a signed-in person creates an organization
 * and its first portrait on a 30-day trial. One trial per person — each
 * trial carries real research spend — and the organization and portrait are
 * created in one transaction.
 */
export const startTrial = action(
  async (input: z.input<typeof portraitSchema> & { organizationName: string; billingEmail?: string }) => {
    const ctx = await getAuth();
    if (!ctx.userId) throw new UserError('Sign in to start a portrait.');
    const p = portraitSchema.parse(input);
    const organizationName = z
      .string()
      .trim()
      .min(2, 'Name the organization (e.g. "City of Ithaca").')
      .max(120)
      .parse(input.organizationName);
    const billingEmail = z
      .string()
      .trim()
      .email('Enter a valid billing email.')
      .optional()
      .or(z.literal(''))
      .parse(input.billingEmail);
    const db = systemDb();

    if (!ctx.devMode) {
      const [trials] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .innerJoin(subscriptions, eq(subscriptions.organizationId, organizationMembers.organizationId))
        .where(
          and(
            eq(organizationMembers.userId, ctx.userId),
            eq(organizationMembers.role, 'owner'),
            eq(subscriptions.plan, 'trial'),
          ),
        );
      if ((trials?.n ?? 0) > 0) {
        throw new UserError(
          'You already have a trial organization. Choose a plan for it under Billing, or contact us for a second evaluation.',
        );
      }
    }

    await assertSlugFree(db, p.slug);
    await db.transaction(async (tx) => {
      const org = await provisionOrganization(tx, {
        slug: p.slug,
        name: organizationName,
        billingEmail: billingEmail || ctx.email || undefined,
        ownerUserId: ctx.userId!,
        startTrial: true,
      });
      const { tenant } = await provisionTenant(tx, {
        slug: p.slug,
        name: p.name,
        region: p.region,
        population: p.population,
        organizationId: org.id,
      });
      await writeRegion(tx, tenant.id, p, ctx.userId);
    });
    redirect(`/${p.slug}/admin?welcome=1`);
  },
);

/** Org owners add another portrait (a borough, a district) within the plan's limit. */
export const addPortrait = action(
  async (input: z.input<typeof portraitSchema> & { orgSlug: string }) => {
    const db = systemDb();
    const org = await organizationBySlug(db, input.orgSlug);
    if (!org) throw new UserError('Unknown organization.');
    await requireOrgRole(org.id, ['owner']);
    const p = portraitSchema.parse(input);

    const sub = await subscriptionFor(db, org.id);
    if (!standing(sub).active) {
      throw new UserError('Adding portraits needs an active plan (see Billing).');
    }
    const limit = effectiveLimits(sub!).portraits;
    if ((await portraitCount(db, org.id)) >= limit) {
      throw new UserError(`Your plan includes ${limit} portrait${limit === 1 ? '' : 's'}. Upgrade to add more.`);
    }
    await assertSlugFree(db, p.slug);
    const ctx = await getAuth();
    const nextOrder = await db.execute<{ n: number }>(
      sql`SELECT coalesce(max(family_order), -1)::int + 1 AS n FROM tenants WHERE organization_id = ${org.id}`,
    );
    await db.transaction(async (tx) => {
      const { tenant } = await provisionTenant(tx, {
        slug: p.slug,
        name: p.name,
        region: p.region,
        population: p.population,
        organizationId: org.id,
        familyOrder: Number(nextOrder[0]?.n ?? 0),
      });
      await writeRegion(tx, tenant.id, p, ctx.userId);
    });
    revalidatePath(`/o/${org.slug}`);
    redirect(`/${p.slug}/admin?welcome=1`);
  },
);
