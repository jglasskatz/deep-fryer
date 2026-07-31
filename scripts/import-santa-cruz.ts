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
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { and, eq, isNull, max } from 'drizzle-orm';
import type { DimensionData, Ring } from '@deep-fryer/core';
import {
  dimensions,
  dimensionVersions,
  getDb,
  provisionTenant,
  tenantBySlug,
} from '@deep-fryer/db';

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

interface EvidenceMigrator {
  migrate(localPath: string, destName: string): Promise<string | null>;
  describe(): string;
}

function makeEvidenceMigrator(tenantSlug: string): EvidenceMigrator {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    const bucket = `tenant-${tenantSlug}`;
    let clientPromise: Promise<import('@supabase/supabase-js').SupabaseClient> | null = null;
    const client = () => {
      clientPromise ??= import('@supabase/supabase-js').then(async ({ createClient }) => {
        const c = createClient(url, serviceKey, { auth: { persistSession: false } });
        const { data: buckets } = await c.storage.listBuckets();
        if (!buckets?.some((b) => b.name === bucket)) {
          await c.storage.createBucket(bucket, { public: true });
        }
        return c;
      });
      return clientPromise;
    };
    return {
      describe: () => `Supabase storage bucket ${bucket}`,
      async migrate(localPath, destName) {
        const c = await client();
        const storagePath = `evidence/${destName}`;
        const body = await readFile(localPath);
        const { error } = await c.storage
          .from(bucket)
          .upload(storagePath, body, { upsert: true, contentType: 'image/png' });
        if (error) {
          console.warn(`  ! upload failed for ${destName}: ${error.message}`);
          return null;
        }
        return storagePath;
      },
    };
  }

  const publicDir = path.join(process.cwd(), 'apps', 'web', 'public', 'evidence', tenantSlug);
  return {
    describe: () => `${publicDir} (no Supabase env — local copy)`,
    async migrate(localPath, destName) {
      await mkdir(path.join(publicDir, 'evidence'), { recursive: true });
      const storagePath = `evidence/${destName}`;
      await copyFile(localPath, path.join(publicDir, storagePath));
      return storagePath;
    },
  };
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

  const migrator = makeEvidenceMigrator(args.slug);
  console.log(`Evidence destination: ${migrator.describe()}`);

  const importedAt = new Date().toISOString();
  let imported = 0;
  let withEvidence = 0;

  for (const ring of ['social', 'ecological'] as Ring[]) {
    const entries = jurisdiction[ring === 'social' ? 'social' : 'ecological'];
    for (const entry of entries) {
      const slug = slugify(entry.name);

      let [dimension] = await db
        .select()
        .from(dimensions)
        .where(
          and(
            eq(dimensions.tenantId, tenant.id),
            eq(dimensions.ring, ring),
            eq(dimensions.slug, slug),
          ),
        );

      if (!dimension) {
        // Custom dimension outside the framework (e.g. "waste & materials"):
        // created without canonical_slug, appended to display order.
        const [{ maxOrder }] = await db
          .select({ maxOrder: max(dimensions.displayOrder) })
          .from(dimensions)
          .where(eq(dimensions.tenantId, tenant.id));
        [dimension] = await db
          .insert(dimensions)
          .values({
            tenantId: tenant.id,
            ring,
            slug,
            canonicalSlug: null,
            displayOrder: (maxOrder ?? 0) + 1,
          })
          .returning();
        if (!dimension) throw new Error(`failed to create custom dimension ${slug}`);
        console.log(`  + custom dimension '${entry.name}' (${slug})`);
      }

      let evidencePath: string | null = null;
      if (entry.screenshot) {
        const local = path.join(args.from, 'docs', entry.screenshot);
        if (existsSync(local)) {
          evidencePath = await migrator.migrate(local, path.basename(entry.screenshot));
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

      const [{ maxVersion }] = await db
        .select({ maxVersion: max(dimensionVersions.versionNum) })
        .from(dimensionVersions)
        .where(eq(dimensionVersions.dimensionId, dimension.id));

      const [version] = await db
        .insert(dimensionVersions)
        .values({
          dimensionId: dimension.id,
          versionNum: (maxVersion ?? 0) + 1,
          status: 'published',
          data,
          vizLevel: typeof entry.level === 'number' ? entry.level : null,
          origin: 'import',
          publishedAt: new Date(),
        })
        .returning();
      if (!version) throw new Error(`failed to insert version for ${slug}`);

      await db
        .update(dimensions)
        .set({ publishedVersionId: version.id })
        .where(eq(dimensions.id, dimension.id));
      imported++;
    }
  }

  // Archive framework dimensions the SC portrait has no data for, so the
  // public doughnut shows the portrait as curated, not empty gray wedges.
  const allDims = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenant.id), isNull(dimensions.archivedAt)));
  for (const d of allDims) {
    if (!d.publishedVersionId) {
      await db.update(dimensions).set({ archivedAt: new Date() }).where(eq(dimensions.id, d.id));
      console.log(`  archived empty framework dimension '${d.slug}'`);
    }
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
