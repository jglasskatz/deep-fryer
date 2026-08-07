#!/usr/bin/env tsx
/**
 * Seed engagement actions (scripts/nyc-actions.ts) into every published
 * dimension version of the NYC family: appends a human-origin version with
 * the actions merged (change note per the immutability contract) and
 * publishes it. Idempotent — skips dimensions whose published actions
 * already match.
 */
import { eq } from 'drizzle-orm';
import {
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  getDb,
  latestVersion,
  tenantBySlug,
} from '@deep-fryer/db';
import { NYC_ACTIONS } from './nyc-actions.js';

const SLUGS = ['nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'];

async function main() {
  const db = getDb();
  for (const slug of SLUGS) {
    const tenant = await tenantBySlug(db, slug);
    if (!tenant) throw new Error(`tenant ${slug} missing`);
    const dims = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenant.id));
    for (const dim of dims) {
      const def = NYC_ACTIONS[dim.slug];
      if (!def) continue;
      const actions = [...(def.byTenant?.[slug] ?? []), ...def.actions];
      const base = await latestVersion(db, dim.id);
      if (!base) continue;
      if (JSON.stringify(base.data.actions) === JSON.stringify(actions)) continue;

      const version = await appendDimensionVersion(db, {
        dimensionId: dim.id,
        status: 'draft',
        data: { ...base.data, actions },
        vizLevel: base.vizLevel,
        origin: 'human',
        changeNote:
          'Seed engagement actions (curated from the NYC impact research; research sessions draft these per SPEC §9 in future runs)',
        createdBy: null,
      });
      await db
        .update(dimensionVersions)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(dimensionVersions.id, version.id));
      await db
        .update(dimensions)
        .set({ publishedVersionId: version.id })
        .where(eq(dimensions.id, dim.id));
      console.log(`${slug}/${dim.slug}: actions seeded (v${version.versionNum})`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
