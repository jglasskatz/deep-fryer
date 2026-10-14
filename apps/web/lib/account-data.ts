import 'server-only';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  accounts,
  organizationMembers,
  organizations,
  subscriptions,
  tenantMembers,
  tenants,
  users,
} from '@deep-fryer/db';
import { systemDb } from './db';

export interface AccountOverview {
  user: { id: string; email: string | null; name: string | null; displayName: string | null };
  providers: string[];
  organizations: {
    id: string;
    slug: string;
    name: string;
    role: 'owner' | 'billing';
    plan: string | null;
    status: string | null;
    portraits: { slug: string; name: string }[];
  }[];
  portraits: { slug: string; name: string; role: string; organizationName: string }[];
}

/** Everything /account shows, in a handful of queries. */
export async function accountOverview(userId: string): Promise<AccountOverview | null> {
  const db = systemDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return null;

  const [linked, orgRows, tenantRows] = await Promise.all([
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)),
    db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        role: organizationMembers.role,
        plan: subscriptions.plan,
        status: subscriptions.status,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .leftJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
      .where(and(eq(organizationMembers.userId, userId), isNull(organizations.archivedAt)))
      .orderBy(asc(organizations.name)),
    db
      .select({
        slug: tenants.slug,
        name: tenants.name,
        role: tenantMembers.role,
        organizationName: organizations.name,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .innerJoin(organizations, eq(organizations.id, tenants.organizationId))
      .where(and(eq(tenantMembers.userId, userId), isNull(tenants.archivedAt)))
      .orderBy(asc(tenants.name)),
  ]);

  const orgIds = orgRows.map((o) => o.id);
  const orgPortraits = orgIds.length
    ? await db
        .select({ organizationId: tenants.organizationId, slug: tenants.slug, name: tenants.name })
        .from(tenants)
        .where(and(inArray(tenants.organizationId, orgIds), isNull(tenants.archivedAt)))
        .orderBy(asc(tenants.familyOrder), asc(tenants.name))
    : [];

  return {
    user: { id: user.id, email: user.email, name: user.name, displayName: user.displayName },
    providers: linked.map((l) => l.provider),
    organizations: orgRows.map((o) => ({
      ...o,
      portraits: orgPortraits
        .filter((p) => p.organizationId === o.id)
        .map(({ slug, name }) => ({ slug, name })),
    })),
    portraits: tenantRows,
  };
}
