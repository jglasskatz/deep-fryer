import { and, eq, inArray } from 'drizzle-orm';
import { appendDimensionVersion, dimensions, getDb, latestVersion } from '@deep-fryer/db';

/** Public submission fixtures must publish their selected dimensions, rather
 * than only mark the parent portrait public. Uses the isolated test DB only. */
export async function publishInvolvementTestDimensions(tenantId: string, slugs = ['housing', 'food']) {
  const db = getDb();
  const rows = await db.select().from(dimensions).where(and(eq(dimensions.tenantId, tenantId), inArray(dimensions.slug, slugs)));
  for (const row of rows) {
    const latest = await latestVersion(db, row.id);
    const version = await appendDimensionVersion(db, { dimensionId: row.id,
      status: 'published', publishedAt: new Date(), origin: 'import', data: latest?.data ?? {name:row.slug,icon:'',description:'',context:'',actions:[],indicators:[]}, vizLevel:null,
    });
    await db.update(dimensions).set({publishedVersionId:version.id}).where(eq(dimensions.id,row.id));
  }
}
