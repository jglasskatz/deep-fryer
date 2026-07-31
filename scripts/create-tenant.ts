#!/usr/bin/env tsx
import { getDb, provisionTenant, tenantBySlug } from '@deep-fryer/db';

interface CreateTenantArgs {
  slug: string;
  name: string;
  region?: string;
  population?: number;
  description?: string;
  ownerEmail: string;
}

/**
 * Resolve (or invite) the owner in Supabase auth. Local dev without Supabase
 * env provisions the tenant with no member and prints a warning — RLS-gated
 * surfaces need a real Supabase project.
 */
async function resolveOwner(email: string): Promise<string | undefined> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipping owner membership.');
    return undefined;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`Supabase listUsers failed: ${error.message}`);
  const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError) throw new Error(`Supabase invite failed: ${inviteError.message}`);
  console.log(`Invited ${email} via Supabase auth.`);
  return invited.user.id;
}

async function createTenant(args: CreateTenantArgs): Promise<void> {
  const db = getDb();

  const existing = await tenantBySlug(db, args.slug);
  if (existing) {
    throw new Error(`tenant '${args.slug}' already exists`);
  }

  const ownerUserId = await resolveOwner(args.ownerEmail);
  const { tenant, dimensions } = await provisionTenant(db, { ...args, ownerUserId });

  console.log(`Created tenant '${tenant.slug}' (${tenant.id})`);
  console.log(`  ${dimensions.length} framework dimensions seeded with initial draft versions`);
  console.log(`  owner: ${ownerUserId ? args.ownerEmail : '(none — no Supabase env)'}`);
  console.log(`Public page will render at /${tenant.slug} once versions are published.`);
}

function parseArgs(argv: string[]): CreateTenantArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const slug = get('--slug');
  const name = get('--name');
  const ownerEmail = get('--owner');
  if (!slug || !name || !ownerEmail) {
    console.error('Usage: create-tenant --slug <slug> --name <name> --owner <email> [--region <r>] [--population <n>] [--description <d>]');
    process.exit(1);
  }
  const populationRaw = get('--population');
  return {
    slug,
    name,
    region: get('--region'),
    population: populationRaw ? Number(populationRaw) : undefined,
    description: get('--description'),
    ownerEmail,
  };
}

const args = parseArgs(process.argv.slice(2));
createTenant(args)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
