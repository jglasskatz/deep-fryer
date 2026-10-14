import 'server-only';
import { cache } from 'react';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { organizations, tenants } from '@deep-fryer/db';
import { userDb } from './db';
import { hasDatabase } from './env';

/**
 * Portrait families (SPEC-v4 §2): the portraits one organization holds,
 * compared side by side. NYC is the first — the city plus its five
 * boroughs — and was hard-coded in v3 (lib/nyc-family.ts); any organization
 * with two or more portraits now gets the same family nav, compare, and
 * insights views from its own data.
 */
export interface FamilyMember {
  slug: string;
  name: string;
  /** Compact column label ("BX"). */
  short: string;
}

export interface Family {
  organization: { id: string; slug: string; name: string };
  members: FamilyMember[];
  /**
   * The whole-jurisdiction portrait, if the family has one: by convention
   * the member whose slug equals the organization's (NYC: `nyc` over the
   * five boroughs). Compare views treat it as context, not a contestant.
   */
  whole: string | null;
  /** Singular noun for members in copy ("borough"). */
  noun: string;
}

function initials(name: string): string {
  const words = name.replace(/^The\s+/i, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export const familyByOrgSlug = cache(async (orgSlug: string): Promise<Family | null> => {
  if (!hasDatabase()) return null;
  const found = await userDb(async (db) => {
    const [org] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.slug, orgSlug), isNull(organizations.archivedAt)));
    if (!org) return null;
    const rows = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.organizationId, org.id), isNull(tenants.archivedAt)))
      .orderBy(asc(tenants.familyOrder), asc(tenants.name));
    return { org, rows };
  });
  if (!found) return null;
  const { org, rows } = found;
  return {
    organization: { id: org.id, slug: org.slug, name: org.name },
    members: rows.map((t) => ({ slug: t.slug, name: t.name, short: t.shortName ?? initials(t.name) })),
    whole: rows.some((t) => t.slug === org.slug) ? org.slug : null,
    noun: org.memberNoun?.trim() || 'portrait',
  };
});

/** The family a portrait belongs to, or null when it stands alone. */
export const familyForTenant = cache(async (tenantSlug: string): Promise<Family | null> => {
  if (!hasDatabase()) return null;
  const [row] = await userDb((db) =>
    db
      .select({ orgSlug: organizations.slug })
      .from(tenants)
      .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
      .where(eq(tenants.slug, tenantSlug)),
  );
  if (!row) return null;
  const family = await familyByOrgSlug(row.orgSlug);
  return family && family.members.length > 1 ? family : null;
});

/** The organization holding a portrait (for billing/admin links), or null. */
export const organizationOfTenant = cache(
  async (tenantSlug: string): Promise<{ id: string; slug: string; name: string } | null> => {
    if (!hasDatabase()) return null;
    const [row] = await userDb((db) =>
      db
        .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
        .from(tenants)
        .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
        .where(eq(tenants.slug, tenantSlug)),
    );
    return row ?? null;
  },
);
