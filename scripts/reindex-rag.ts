#!/usr/bin/env tsx
/**
 * Rebuild `knowledge_chunks` for one portrait or every active portrait.
 *
 *   tsx scripts/reindex-rag.ts --tenant nyc
 *   tsx scripts/reindex-rag.ts --all
 *   tsx scripts/reindex-rag.ts --all --public-only
 *
 * Runs in the system context (table owner) so it can index both public
 * published versions and member-scoped drafts/policy analyses cleanly.
 */
import { eq, isNull } from 'drizzle-orm';
import { getDb, reindexTenantKnowledge, tenants } from '@deep-fryer/db';

const USAGE = [
  'Usage:',
  '  reindex-rag --tenant <slug> [--public-only]   reindex one portrait',
  '  reindex-rag --all [--public-only]             reindex every active portrait',
].join('\n');

interface Options {
  tenantSlug: string | null;
  all: boolean;
  includeMember: boolean;
}

function parseArgs(argv: string[]): Options | null {
  let tenantSlug: string | null = null;
  let all = false;
  let includeMember = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenant') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return null;
      tenantSlug = value.trim();
    } else if (arg?.startsWith('--tenant=')) {
      tenantSlug = arg.slice('--tenant='.length).trim();
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--public-only') {
      includeMember = false;
    } else {
      return null;
    }
  }

  if (all === Boolean(tenantSlug)) return null;
  return { tenantSlug, all, includeMember };
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) {
    console.error(USAGE);
    return 1;
  }

  const db = getDb();
  const rows = opts.all
    ? await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(isNull(tenants.archivedAt))
    : await db
        .select({ id: tenants.id, slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.slug, opts.tenantSlug!));

  if (rows.length === 0) {
    console.error(opts.tenantSlug ? `Unknown portrait '${opts.tenantSlug}'.` : 'No active portraits found.');
    return 1;
  }

  for (const row of rows) {
    const summary = await reindexTenantKnowledge(db, {
      tenantId: row.id,
      tenantSlug: row.slug,
      includeMember: opts.includeMember,
    });
    console.log(
      `[reindex-rag] ${row.slug}: total=${summary.total} inserted=${summary.inserted} updated=${summary.updated} deleted=${summary.deleted}`,
    );
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[reindex-rag] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
