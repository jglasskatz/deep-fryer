#!/usr/bin/env tsx
/**
 * Replace ozone-layer depletion with the extreme-heat custom dimension across
 * the NYC family (owner decision 2026-08-07; precedent + rationale in
 * scripts/nyc-portrait-config.ts and docs/SPEC-v3.md §1.2). Archives the
 * ozone dimension (versions retained — nothing is deleted) and creates
 * extreme-heat in its display slot. Idempotent.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { dimensions, getDb, tenantBySlug } from '@deep-fryer/db';
import { CUSTOM_DIMENSIONS } from './nyc-portrait-config.js';

const SLUGS = ['nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island'];

async function main() {
  const db = getDb();
  const heat = CUSTOM_DIMENSIONS['extreme-heat']!;
  for (const slug of SLUGS) {
    const tenant = await tenantBySlug(db, slug);
    if (!tenant) throw new Error(`tenant ${slug} missing`);

    const [ozone] = await db
      .select()
      .from(dimensions)
      .where(
        and(
          eq(dimensions.tenantId, tenant.id),
          eq(dimensions.slug, 'ozone-depletion'),
          isNull(dimensions.archivedAt),
        ),
      );
    if (ozone) {
      await db
        .update(dimensions)
        .set({ archivedAt: new Date() })
        .where(eq(dimensions.id, ozone.id));
    }

    const [existing] = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, 'extreme-heat')));
    if (!existing) {
      await db.insert(dimensions).values({
        tenantId: tenant.id,
        ring: heat.ring,
        slug: 'extreme-heat',
        canonicalSlug: null,
        displayOrder: ozone?.displayOrder ?? 21,
      });
      console.log(`${slug}: ozone archived, extreme-heat created`);
    } else {
      console.log(`${slug}: extreme-heat already present`);
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
