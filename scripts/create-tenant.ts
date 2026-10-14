#!/usr/bin/env tsx
/**
 * Staff provisioning: create an organization and its first portrait, with
 * an owner who signs in with the given email (SPEC-v4 §2). Self-serve
 * customers use /start instead; this is for sales-led onboarding.
 *
 *   tsx scripts/create-tenant.ts --slug ithaca --name "Ithaca" \
 *     --owner clerk@cityofithaca.org [--org-name "City of Ithaca"] \
 *     [--region "NY, USA"] [--population 32000] [--description "..."] \
 *     [--plan trial|community|city|metro|enterprise] [--contract-end 2027-06-30] \
 *     [--language-help "(607) 274-6570"]
 *
 * --plan trial starts a 30-day trial; any other plan records a staff
 * contract through --contract-end (default one year). Omit --plan to leave
 * the organization without a plan (it can buy one under Billing).
 */
import { eq } from 'drizzle-orm';
import { getDb, organizations, provisionOrganization, provisionTenant, subscriptions, tenantBySlug, users } from '@deep-fryer/db';
import { isPlanId } from '@deep-fryer/core';

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const slug = get('--slug');
  const name = get('--name');
  const ownerEmail = get('--owner')?.toLowerCase();
  if (!slug || !name || !ownerEmail) {
    console.error('Usage: create-tenant --slug <slug> --name <name> --owner <email> [--org-name] [--region] [--population] [--description] [--plan] [--contract-end] [--language-help]');
    process.exit(1);
  }
  const plan = get('--plan');
  if (plan && !isPlanId(plan)) throw new Error(`unknown plan '${plan}'`);
  const population = get('--population');
  return {
    slug,
    name,
    ownerEmail,
    orgName: get('--org-name') ?? name,
    region: get('--region'),
    population: population ? Number(population) : undefined,
    description: get('--description'),
    plan,
    contractEnd: get('--contract-end'),
    /** Language access contact for translated pages, e.g. "311" or "(607) 274-6570". */
    languageHelp: get('--language-help'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  if (await tenantBySlug(db, args.slug)) throw new Error(`portrait '${args.slug}' already exists`);

  const [owner] = await db
    .insert(users)
    .values({ email: args.ownerEmail })
    .onConflictDoUpdate({ target: users.email, set: { email: args.ownerEmail } })
    .returning();

  const result = await db.transaction(async (tx) => {
    const org = await provisionOrganization(tx, {
      slug: args.slug,
      name: args.orgName,
      ownerUserId: owner!.id,
      billingEmail: args.ownerEmail,
      startTrial: args.plan === 'trial',
    });
    if (args.languageHelp) {
      await tx.update(organizations).set({ languageHelp: args.languageHelp.trim() }).where(eq(organizations.id, org.id));
    }
    if (args.plan && args.plan !== 'trial') {
      const end = args.contractEnd ? new Date(`${args.contractEnd}T23:59:59Z`) : new Date(Date.now() + 365 * 86_400_000);
      await tx.insert(subscriptions).values({
        organizationId: org.id,
        plan: args.plan,
        status: 'active',
        collection: 'contract',
        currentPeriodStart: new Date(),
        currentPeriodEnd: end,
      });
    }
    const { tenant, dimensions } = await provisionTenant(tx, {
      slug: args.slug,
      name: args.name,
      region: args.region,
      population: args.population,
      description: args.description,
      organizationId: org.id,
    });
    return { org, tenant, dimensions };
  });

  console.log(`Created organization '${result.org.slug}' and portrait '${result.tenant.slug}' (${result.tenant.id})`);
  console.log(`  ${result.dimensions.length} framework dimensions seeded with initial draft versions`);
  console.log(`  owner: ${args.ownerEmail} — signs in at /login with that address`);
  console.log(`  plan: ${args.plan ?? '(none — choose under Billing)'}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
