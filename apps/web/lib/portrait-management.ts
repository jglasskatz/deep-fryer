import 'server-only';
import { desc, eq, inArray } from 'drizzle-orm';
import { dimensions, latestVersionsByDimension, outreachContacts, outreachContactVersions } from '@deep-fryer/db';
import { userDb } from './db';

export async function portraitDimensionsForAdmin(tenantId: string) {
  return userDb(async db => {
    const rows = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenantId)).orderBy(dimensions.displayOrder, dimensions.slug);
    const versions = await latestVersionsByDimension(db, rows.map(row => row.id));
    return rows.map(row => ({ ...row, name: versions.get(row.id)?.data.name ?? row.slug, indicatorCount: versions.get(row.id)?.data.indicators.length ?? 0 }));
  });
}

export async function outreachContactsForAdmin(tenantId: string) {
  return userDb(async db => {
    const rows = await db.select().from(outreachContacts).where(eq(outreachContacts.tenantId, tenantId));
    const versions = rows.length ? await db.select().from(outreachContactVersions)
      .where(inArray(outreachContactVersions.contactId, rows.map(row => row.id)))
      .orderBy(desc(outreachContactVersions.versionNum)) : [];
    return rows.map(row => ({ ...row, versions: versions.filter(version => version.contactId === row.id) }));
  });
}
