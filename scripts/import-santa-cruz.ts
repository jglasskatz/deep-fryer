#!/usr/bin/env tsx
/**
 * Migrate the Santa Cruz portrait out of the doughnut-santa-cruz repo —
 * with its evidence (SPEC.md §12 M1): parses docs/data.js, creates/updates
 * the tenant, publishes one imported version per dimension, and migrates the
 * referenced screenshots into tenant storage (Supabase when configured,
 * apps/web/public/evidence/<slug>/ for local dev).
 *
 * Usage:
 *   pnpm import-santa-cruz --from /path/to/doughnut-santa-cruz \
 *     [--jurisdiction city_santa_cruz] [--slug santacruz]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import type { DimensionData, Ring } from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  getDb,
  provisionTenant,
  tenantBySlug,
} from '@deep-fryer/db';
import { tenantStorage, type TenantStorage } from '@deep-fryer/research';

interface ScEntry {
  name: string;
  level: number | null;
  indicator?: string;
  value?: string;
  year?: number;
  target?: string;
  context?: string;
  source?: string;
  sourceUrl?: string;
  screenshot?: string | null;
  actions?: string[];
}

interface ScJurisdiction {
  name: string;
  population: string;
  description: string;
  ecological: ScEntry[];
  social: ScEntry[];
}

// SC display names → framework slugs where slugification alone doesn't match.
const SLUG_OVERRIDES: Record<string, string> = {
  'ozone layer depletion': 'ozone-depletion',
};

function slugify(name: string): string {
  return (
    SLUG_OVERRIDES[name] ??
    name
      .toLowerCase()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  );
}

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback?: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  const from = get('--from');
  if (!from) {
    console.error('Usage: import-santa-cruz --from <path to doughnut-santa-cruz> [--jurisdiction city_santa_cruz] [--slug santacruz]');
    process.exit(1);
  }
  return {
    from,
    jurisdiction: get('--jurisdiction', 'city_santa_cruz') as string,
    slug: get('--slug', 'santacruz') as string,
  };
}

async function loadJurisdictions(repoPath: string): Promise<Record<string, ScJurisdiction>> {
  const source = await readFile(path.join(repoPath, 'docs', 'data.js'), 'utf8');
  const fn = new Function(`${source}; return JURISDICTIONS;`);
  return fn() as Record<string, ScJurisdiction>;
}

/** Thin wrapper over the shared tenant storage (same backend as the worker). */
async function migrateEvidence(
  storage: TenantStorage,
  localPath: string,
  destName: string,
): Promise<string | null> {
  try {
    const body = await readFile(localPath);
    return await storage.put(`evidence/${destName}`, body, 'image/png');
  } catch (err) {
    console.warn(`  ! upload failed for ${destName}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const all = await loadJurisdictions(args.from);
  const jurisdiction = all[args.jurisdiction];
  if (!jurisdiction) {
    throw new Error(`jurisdiction '${args.jurisdiction}' not found; have: ${Object.keys(all).join(', ')}`);
  }

  let tenant = await tenantBySlug(db, args.slug);
  if (!tenant) {
    const population = Number(jurisdiction.population.replace(/[^0-9]/g, '')) || undefined;
    ({ tenant } = await provisionTenant(db, {
      slug: args.slug,
      name: jurisdiction.name,
      region: 'CA, USA',
      population,
      description: jurisdiction.description,
    }));
    console.log(`Provisioned tenant '${args.slug}'`);
  } else {
    console.log(`Tenant '${args.slug}' exists — importing new versions on top`);
  }

  const storage = await tenantStorage(args.slug, {
    localFallbackDir: path.join(process.cwd(), 'apps', 'web', 'public', 'evidence', args.slug),
  });
  console.log(`Evidence destination: ${storage.describe()}`);

  const importedAt = new Date().toISOString();
  let imported = 0;
  let withEvidence = 0;

  // The tenant's dimensions are fully known up front — one query, not one per entry.
  const existingDims = await db
    .select()
    .from(dimensions)
    .where(eq(dimensions.tenantId, tenant.id));
  const dimByKey = new Map(existingDims.map((d) => [`${d.ring}:${d.slug}`, d]));

  for (const ring of ['social', 'ecological'] as Ring[]) {
    let ringOrder = 0;
    for (const entry of jurisdiction[ring]) {
      const slug = slugify(entry.name);
      // Preserve the source portrait's wedge order (the live SC site's
      // ordering is canonical for imported portraits, not framework order).
      const displayOrder = (ring === 'ecological' ? 100 : 0) + ringOrder++;

      let dimension = dimByKey.get(`${ring}:${slug}`);
      if (dimension && dimension.displayOrder !== displayOrder) {
        await db
          .update(dimensions)
          .set({ displayOrder })
          .where(eq(dimensions.id, dimension.id));
        dimension = { ...dimension, displayOrder };
      }
      if (!dimension) {
        // Custom dimension outside the framework (e.g. "waste & materials"):
        // created without canonical_slug, appended to display order.
        [dimension] = await db
          .insert(dimensions)
          .values({
            tenantId: tenant.id,
            ring,
            slug,
            canonicalSlug: null,
            displayOrder,
          })
          .returning();
        if (!dimension) throw new Error(`failed to create custom dimension ${slug}`);
        dimByKey.set(`${ring}:${slug}`, dimension);
        console.log(`  + custom dimension '${entry.name}' (${slug})`);
      }

      let evidencePath: string | null = null;
      if (entry.screenshot) {
        const local = path.join(args.from, 'docs', entry.screenshot);
        if (existsSync(local)) {
          evidencePath = await migrateEvidence(storage, local, path.basename(entry.screenshot));
          if (evidencePath) withEvidence++;
        } else {
          console.warn(`  ! screenshot missing on disk: ${entry.screenshot}`);
        }
      }

      const data: DimensionData = {
        name: entry.name.replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
        icon: '',
        description: '',
        context: entry.context ?? '',
        indicators: [
          {
            name: entry.indicator ?? entry.name,
            value: entry.value ?? null,
            unit: '',
            year: entry.year ?? null,
            target: entry.target ?? null,
            source: entry.source ?? '',
            source_url: entry.sourceUrl ?? '',
            ...(evidencePath
              ? { evidence: { snapshot_path: evidencePath, captured_at: importedAt } }
              : {}),
            confidence: 'medium' as const,
            geographic_scale: 'city' as const,
          },
        ],
        actions: entry.actions ?? [],
      };

      const version = await appendDimensionVersion(db, {
        dimensionId: dimension.id,
        status: 'published',
        data,
        vizLevel: typeof entry.level === 'number' ? entry.level : null,
        origin: 'import',
        publishedAt: new Date(),
      });

      await db
        .update(dimensions)
        .set({ publishedVersionId: version.id })
        .where(eq(dimensions.id, dimension.id));
      imported++;
    }
  }

  // Archive framework dimensions the SC portrait has no data for, so the
  // public doughnut shows the portrait as curated, not empty gray wedges.
  const archived = await db
    .update(dimensions)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(dimensions.tenantId, tenant.id),
        isNull(dimensions.archivedAt),
        isNull(dimensions.publishedVersionId),
      ),
    )
    .returning({ slug: dimensions.slug });
  for (const d of archived) {
    console.log(`  archived empty framework dimension '${d.slug}'`);
  }

  console.log(`Imported ${imported} dimensions (${withEvidence} with evidence snapshots).`);
  console.log(`Public portrait: /${args.slug}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
