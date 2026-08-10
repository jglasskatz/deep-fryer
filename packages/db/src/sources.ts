import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { getDb } from './client.js';
import { sources, type NewSource, type Source } from './schema.js';

type Db = ReturnType<typeof getDb>;

/**
 * Source knowledge base access (SPEC.md §8). Writes are idempotent on
 * (tenant, url_hash, content_hash) so session retries and re-captures of
 * unchanged pages collapse into one row; search is Postgres FTS over the
 * generated tsvector (migration 0005).
 */

/** Insert a capture; returns null when an identical capture already exists. */
export async function recordSource(db: Db, values: NewSource): Promise<Source | null> {
  const [row] = await db
    .insert(sources)
    .values(values)
    .onConflictDoNothing({ target: [sources.tenantId, sources.urlHash, sources.contentHash] })
    .returning();
  return row ?? null;
}

/**
 * Tier is only known once a finding cites the source; the most authoritative
 * citation wins (LEAST — tier 1 beats tier 4).
 */
export async function reconcileSourceTier(
  db: Db,
  tenantId: string,
  snapshotPath: string,
  tier: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE sources
       SET source_tier = LEAST(coalesce(source_tier, ${tier}), ${tier})
     WHERE tenant_id = ${tenantId} AND snapshot_path = ${snapshotPath}
  `);
}

export interface SourceSearchHit {
  source: Source;
  rank: number;
  /** ts_headline snippet with <mark> tags around matches. */
  headline: string;
}

export async function searchSources(
  db: Db,
  tenantId: string,
  query: string,
  limit = 30,
): Promise<SourceSearchHit[]> {
  const rows = await db.execute<Record<string, unknown> & { rank: number; headline: string }>(sql`
    SELECT s.*, ts_rank(s.tsv, q) AS rank,
           ts_headline('english', left(coalesce(s."text", ''), 20000), q,
                       'StartSel=<mark>,StopSel=</mark>,MaxWords=40') AS headline
      FROM sources s, websearch_to_tsquery('english', ${query}) q
     WHERE s.tenant_id = ${tenantId} AND s.tsv @@ q
     ORDER BY rank DESC
     LIMIT ${limit}
  `);
  return [...rows].map((r) => ({
    source: {
      id: r.id,
      tenantId: r.tenant_id,
      url: r.url,
      urlHash: r.url_hash,
      contentHash: r.content_hash,
      title: r.title,
      mediaType: r.media_type,
      text: r.text,
      textSource: r.text_source,
      extraction: r.extraction,
      snapshotPath: r.snapshot_path,
      pdfPath: r.pdf_path,
      capturedAt: new Date(r.captured_at as string),
      runId: r.run_id,
      sessionId: r.session_id,
      dimensionId: r.dimension_id,
      sourceTier: r.source_tier,
      textPublic: r.text_public,
      createdAt: new Date(r.created_at as string),
    } as Source,
    rank: Number(r.rank),
    headline: String(r.headline ?? ''),
  }));
}

export async function listSources(db: Db, tenantId: string): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(eq(sources.tenantId, tenantId))
    .orderBy(sources.dimensionId, sources.sourceTier, desc(sources.capturedAt));
}

export async function sourceById(db: Db, tenantId: string, id: string): Promise<Source | null> {
  const [row] = await db
    .select()
    .from(sources)
    .where(and(eq(sources.tenantId, tenantId), eq(sources.id, id)));
  return row ?? null;
}

/** Batch join key for findings/indicators → their source rows. */
export async function sourcesBySnapshotPaths(
  db: Db,
  tenantId: string,
  paths: string[],
): Promise<Map<string, Source>> {
  if (paths.length === 0) return new Map();
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.tenantId, tenantId), inArray(sources.snapshotPath, paths)));
  return new Map(rows.map((r) => [r.snapshotPath, r]));
}
