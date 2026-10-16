'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { effectiveLimits, slugError, slugify, standing } from '@deep-fryer/core';
import {
  organizationBySlug,
  organizationMembers,
  organizations,
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

/** Empty optional fields arrive as '' from forms; they mean "not given". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/**
 * A new portrait (SPEC-v7 §4: "the city's name and state/country — that is
 * all"). Only those two are required; everything else has a default the
 * framework or the name provides, and the form offers them under "More
 * options" for whoever wants to set them now:
 * - the public address (slug) follows the name, made unique if taken;
 * - the boundary research targets is the jurisdiction's own legal boundary
 *   (defaultBoundary) — editable later under the portrait's settings;
 * - population is optional, as before.
 * Data portals and local targets default from the framework config
 * (provisionTenant), and the first research session (region context) writes
 * the region brief.
 */
const portraitSchema = z.object({
  name: z.string().trim().min(2, 'Name the city.').max(120),
  region: z.string().trim().min(2, 'Give the state/province and country, e.g. "NY, USA".').max(80),
  slug: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().optional()),
  definition: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .min(10, 'Describe the boundary research should target (e.g. "City of Ithaca municipal boundary"), or leave it blank.')
      .max(500)
      .optional(),
  ),
  population: z.preprocess(blankToUndefined, z.coerce.number().int().positive().max(100_000_000).optional()),
});

type PortraitInput = z.infer<typeof portraitSchema>;

/**
 * The boundary research targets when none is given. Precision is the point
 * of the field — it keeps county or metro figures from passing as the
 * city's — so the default names the jurisdiction's own legal boundary and
 * says what does not count.
 */
function defaultBoundary(name: string, region: string): string {
  return `The legal boundary of ${name}, ${region}, as its own government defines it; figures for a larger surrounding area (county, metro area, or state) are not figures for ${name}.`;
}

/**
 * Who administers the portrait, when the form does not say: the name as
 * given when it already names a kind of government ("Tompkins County",
 * "Town of Ithaca"), otherwise "City of …".
 */
function defaultOrganizationName(name: string): string {
  return /\b(city|town|county|village|borough|township|parish|municipality|district|region)\b/i.test(name)
    ? name
    : `City of ${name}`;
}

async function slugIsFree(db: DbExecutor, slug: string): Promise<boolean> {
  if (slugError(slug)) return false;
  const [tenant, org] = await Promise.all([tenantBySlug(db, slug), organizationBySlug(db, slug)]);
  return !tenant && !org;
}

async function assertSlugFree(db: DbExecutor, slug: string) {
  const err = slugError(slug);
  if (err) throw new UserError(err);
  if (!(await slugIsFree(db, slug))) throw new UserError(`"${slug}" is taken — choose another address.`);
}

/**
 * The address for a portrait whose form left it blank: the name's slug, or
 * — when that is taken or reserved ("Springfield" exists in most states) —
 * the name with its state, then numbered variants. A slug chosen by hand is
 * checked instead (assertSlugFree) and never silently changed.
 */
async function portraitSlug(db: DbExecutor, p: PortraitInput): Promise<string> {
  if (p.slug) {
    await assertSlugFree(db, p.slug);
    return p.slug;
  }
  const base = slugify(p.name) || slugify(p.region) || 'portrait';
  const withRegion = slugify(`${p.name} ${p.region.split(',')[0] ?? ''}`);
  const stem = base.slice(0, 45).replace(/-+$/g, '');
  const candidates = [base, withRegion, ...Array.from({ length: 8 }, (_, i) => `${stem}-${i + 2}`)];
  for (const candidate of candidates) {
    if (await slugIsFree(db, candidate)) return candidate;
  }
  throw new UserError('Every address for this name is taken — choose one under "More options".');
}

async function writeRegion(db: DbExecutor, tenantId: string, p: PortraitInput, userId: string | null) {
  const region = { name: p.name, definition: p.definition ?? defaultBoundary(p.name, p.region) };
  await db
    .insert(tenantConfig)
    .values({ tenantId, key: 'region', value: region, updatedBy: userId })
    .onConflictDoUpdate({
      target: [tenantConfig.tenantId, tenantConfig.key],
      set: { value: region, updatedBy: userId, updatedAt: new Date() },
    });
}

/**
 * Self-serve start (SPEC-v4 §2, SPEC-v7 §4): a signed-in person creates an
 * organization and its first portrait on a 30-day trial, from the city's
 * name and state/country alone (portraitSchema has the defaults). One trial
 * per person — each trial carries real research spend — and the
 * organization and portrait are created in one transaction. Then /start
 * offers "Build my doughnut" for the new portrait.
 */
export const startTrial = action(
  async (input: z.input<typeof portraitSchema> & { organizationName?: string; billingEmail?: string }) => {
    const ctx = await getAuth();
    if (!ctx.userId) throw new UserError('Sign in to start a portrait.');
    const p = portraitSchema.parse(input);
    const organizationName = z
      .string()
      .trim()
      .min(2, 'Name the organization (e.g. "City of Ithaca"), or leave it blank.')
      .max(120)
      .parse(input.organizationName?.trim() || defaultOrganizationName(p.name));
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

    const slug = await portraitSlug(db, p);
    await db.transaction(async (tx) => {
      const org = await provisionOrganization(tx, {
        slug,
        name: organizationName,
        billingEmail: billingEmail || ctx.email || undefined,
        ownerUserId: ctx.userId!,
        startTrial: true,
      });
      const { tenant } = await provisionTenant(tx, {
        slug,
        name: p.name,
        region: p.region,
        population: p.population,
        organizationId: org.id,
      });
      await writeRegion(tx, tenant.id, p, ctx.userId);
    });
    // Step two of /start: how the research is paid for, and "Build my doughnut".
    redirect(`/start?portrait=${encodeURIComponent(slug)}`);
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
    const slug = await portraitSlug(db, p);
    const ctx = await getAuth();
    const nextOrder = await db.execute<{ n: number }>(
      sql`SELECT coalesce(max(family_order), -1)::int + 1 AS n FROM tenants WHERE organization_id = ${org.id}`,
    );
    await db.transaction(async (tx) => {
      const { tenant } = await provisionTenant(tx, {
        slug,
        name: p.name,
        region: p.region,
        population: p.population,
        organizationId: org.id,
        familyOrder: Number(nextOrder[0]?.n ?? 0),
      });
      await writeRegion(tx, tenant.id, p, ctx.userId);
    });
    revalidatePath(`/o/${org.slug}`);
    redirect(`/${slug}/admin?welcome=1`);
  },
);

/**
 * The organization's language access contact (organizations.language_help),
 * shown on every translated public page: "For free help in your language,
 * contact: 311". Plain text, rendered as text — never a link — so it needs
 * no URL sanitizing; owners only.
 */
export const updateLanguageHelp = action(async (input: { orgSlug: string; languageHelp: string }) => {
  const db = systemDb();
  const org = await organizationBySlug(db, input.orgSlug);
  if (!org) throw new UserError('Unknown organization.');
  await requireOrgRole(org.id, ['owner']);
  const value = input.languageHelp.trim();
  if (value.length > 120) {
    throw new UserError('Keep it short: a phone number, email, or web address (at most 120 characters).');
  }
  await db.update(organizations).set({ languageHelp: value || null }).where(eq(organizations.id, org.id));
  revalidatePath(`/o/${org.slug}`);
});
