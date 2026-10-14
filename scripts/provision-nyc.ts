#!/usr/bin/env tsx
/**
 * Provision the NYC portrait family as one organization: the whole-city
 * doughnut plus one per borough, billed and administered together
 * (SPEC-v4 §2). Idempotent:
 *
 * - creates organization `nyc` (member noun "borough", tax-exempt) if absent;
 * - creates missing tenants inside it, or moves existing ones in (tenants
 *   provisioned before organizations existed each got their own org in
 *   migration 0002 — those now-empty orgs are removed);
 * - sets family order and short labels (NYC, MN, BK, QN, BX, SI);
 * - refreshes each tenant's region config;
 * - ensures a contract subscription (Metro plan by default — six portraits,
 *   a quarterly refresh of the whole family fits its 600 sessions/year);
 * - optionally makes --owner the organization owner (they sign in with that
 *   email and land with full access to all six portraits).
 *
 *   tsx scripts/provision-nyc.ts [--owner you@cityhall.nyc.gov]
 *       [--plan metro|enterprise] [--contract-end 2027-06-30]
 *       [--billing-email ap@cityhall.nyc.gov] [--po PO-12345]
 *
 * Boroughs are county-equivalents, so the default scale policy
 * (city → county) matches how NYC data is actually published.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  getDb,
  organizationBySlug,
  organizationMembers,
  organizations,
  provisionOrganization,
  provisionTenant,
  subscriptions,
  tenantBySlug,
  tenantConfig,
  tenants,
  users,
} from '@deep-fryer/db';
import { isPlanId } from '@deep-fryer/core';

const ORG_SLUG = 'nyc';
const ORG_NAME = 'City of New York';

const NYC_CONTEXT = [
  'Primary portals: NYC Open Data (data.cityofnewyork.us), DOHMH Community Health Profiles,',
  "DCP Population FactFinder, Mayor's Office of Climate & Environmental Justice (GHG inventories),",
  'DEP water/harbor water quality reports, NYCHA & HPD housing data, ACS county-equivalents.',
  'Each borough is a county: use county-level federal series where city publications lack borough cuts.',
].join(' ');

const TENANTS = [
  {
    slug: 'nyc',
    name: 'New York City',
    short: 'NYC',
    population: 8804190,
    description: 'The five boroughs — the whole-city doughnut.',
    definition:
      'The City of New York: all five boroughs (New York, Kings, Queens, Bronx, and Richmond Counties).',
  },
  {
    slug: 'manhattan',
    name: 'Manhattan',
    short: 'MN',
    population: 1694251,
    description: 'Borough of Manhattan.',
    definition: 'The Borough of Manhattan (New York County, NY).',
  },
  {
    slug: 'brooklyn',
    name: 'Brooklyn',
    short: 'BK',
    population: 2736074,
    description: 'Borough of Brooklyn.',
    definition: 'The Borough of Brooklyn (Kings County, NY).',
  },
  {
    slug: 'queens',
    name: 'Queens',
    short: 'QN',
    population: 2405464,
    description: 'Borough of Queens.',
    definition: 'The Borough of Queens (Queens County, NY).',
  },
  {
    slug: 'bronx',
    name: 'The Bronx',
    short: 'BX',
    population: 1472654,
    description: 'Borough of The Bronx.',
    definition: 'The Borough of The Bronx (Bronx County, NY).',
  },
  {
    slug: 'staten-island',
    name: 'Staten Island',
    short: 'SI',
    population: 495747,
    description: 'Borough of Staten Island.',
    definition: 'The Borough of Staten Island (Richmond County, NY).',
  },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  const ownerEmail = arg('owner')?.toLowerCase();
  const planArg = arg('plan');
  if (planArg && (!isPlanId(planArg) || !['metro', 'enterprise'].includes(planArg))) {
    throw new Error('--plan must be metro or enterprise for the NYC contract');
  }

  // 1. The organization.
  let org = await organizationBySlug(db, ORG_SLUG);
  if (!org) {
    org = await provisionOrganization(db, { slug: ORG_SLUG, name: ORG_NAME });
    console.log(`created organization ${ORG_SLUG}`);
  }
  await db
    .update(organizations)
    .set({
      name: ORG_NAME,
      memberNoun: 'borough',
      // Local Law 30: every translated page points residents to free
      // interpretation; NYC 311 provides it in 175+ languages. Kept if an
      // owner has since set something else in the app.
      languageHelp: org.languageHelp ?? '311',
      taxExempt: true,
      billingEmail: arg('billing-email') ?? org.billingEmail,
    })
    .where(eq(organizations.id, org.id));

  // 2. The six portraits, inside it, in family order.
  for (const [order, t] of TENANTS.entries()) {
    let tenant = await tenantBySlug(db, t.slug);
    if (!tenant) {
      ({ tenant } = await provisionTenant(db, {
        slug: t.slug,
        name: t.name,
        region: 'NY, USA',
        population: t.population,
        description: t.description,
        organizationId: org.id,
        familyOrder: order,
        shortName: t.short,
      }));
      console.log(`provisioned ${t.slug}`);
    } else {
      await db
        .update(tenants)
        .set({ organizationId: org.id, familyOrder: order, shortName: t.short })
        .where(eq(tenants.id, tenant.id));
      console.log(`exists ${t.slug} — grouped under ${ORG_SLUG}, region config refreshed`);
    }
    const [regionRow] = await db
      .select()
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'region')));
    const existingNotes = (regionRow?.value as { context_notes?: string } | undefined)?.context_notes;
    const region = {
      name: t.name,
      definition: t.definition,
      // Keep notes the portrait config script appended (" :: " sections).
      context_notes: existingNotes?.startsWith(NYC_CONTEXT) ? existingNotes : NYC_CONTEXT,
    };
    await db
      .insert(tenantConfig)
      .values({ tenantId: tenant.id, key: 'region', value: region })
      .onConflictDoUpdate({
        target: [tenantConfig.tenantId, tenantConfig.key],
        set: { value: region, updatedAt: new Date() },
      });
  }

  // 3. Organizations left empty by the regrouping (one per borough from
  //    migration 0002) are removed — but never one with a Stripe customer.
  const slugs = TENANTS.map((t) => t.slug).filter((s) => s !== ORG_SLUG);
  const emptied = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(
      and(
        inArray(organizations.slug, slugs),
        sql`${organizations.stripeCustomerId} IS NULL`,
        sql`NOT EXISTS (SELECT 1 FROM tenants t WHERE t.organization_id = ${organizations.id})`,
      ),
    );
  if (emptied.length) {
    await db.delete(organizations).where(
      inArray(
        organizations.id,
        emptied.map((o) => o.id),
      ),
    );
    console.log(`removed emptied organizations: ${emptied.map((o) => o.slug).join(', ')}`);
  }

  // 4. The contract.
  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, org.id));
  const end = arg('contract-end')
    ? new Date(`${arg('contract-end')}T23:59:59Z`)
    : new Date(Date.now() + 365 * 86_400_000);
  if (!existing || planArg || arg('contract-end') || arg('po')) {
    const values = {
      plan: planArg ?? existing?.plan ?? 'metro',
      status: 'active' as const,
      collection: 'contract' as const,
      currentPeriodStart: existing?.currentPeriodStart ?? new Date(),
      currentPeriodEnd: end,
      poNumber: arg('po') ?? existing?.poNumber ?? null,
      updatedAt: new Date(),
    };
    await db
      .insert(subscriptions)
      .values({ organizationId: org.id, ...values })
      .onConflictDoUpdate({ target: subscriptions.organizationId, set: values });
    console.log(`contract: ${values.plan}, active through ${end.toISOString().slice(0, 10)}`);
  }

  // 5. Owner.
  if (ownerEmail) {
    const [user] = await db
      .insert(users)
      .values({ email: ownerEmail })
      .onConflictDoUpdate({ target: users.email, set: { email: ownerEmail } })
      .returning();
    await db
      .insert(organizationMembers)
      .values({ organizationId: org.id, userId: user!.id, role: 'owner' })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.userId],
        set: { role: 'owner' },
      });
    console.log(`owner: ${ownerEmail} (signs in with that address)`);
  }

  const count = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tenants)
    .where(eq(tenants.organizationId, org.id));
  console.log(`NYC family ready: organization ${ORG_SLUG} with ${count[0]?.n ?? 0} portraits`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
