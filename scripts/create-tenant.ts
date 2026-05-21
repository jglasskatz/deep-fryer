#!/usr/bin/env tsx
import {
  socialFrameworkDimensions,
  ecologicalFrameworkDimensions,
} from '@deep-fryer/core';
import { db } from '@deep-fryer/db';

interface CreateTenantArgs {
  slug: string;
  name: string;
  region?: string;
  population?: number;
  description?: string;
  ownerEmail: string;
}

async function createTenant(args: CreateTenantArgs): Promise<void> {
  // TODO: implement in a follow-up session.
  // 1. Insert tenant row.
  // 2. Look up or invite the owner user via Supabase auth admin API; insert tenant_member.
  // 3. Seed dimensions from socialFrameworkDimensions + ecologicalFrameworkDimensions.
  // 4. Create an initial empty draft dimension_version for each.
  // 5. Audit-log the creation.
  void args;
  void db;
  void socialFrameworkDimensions;
  void ecologicalFrameworkDimensions;
  throw new Error('create-tenant: not implemented yet');
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
await createTenant(args);
