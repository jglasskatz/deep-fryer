#!/usr/bin/env tsx
/**
 * Backfill the source knowledge base from evidence that predates it: every
 * evidence reference in published version history and in findings becomes a
 * sources row. Text is re-fetched from the live URL where it still resolves
 * (plain fetch + crude HTML→text — no browser in scripts); dead or missing
 * URLs get text-less rows so the snapshot is still cataloged. Idempotent on
 * (tenant, url_hash, content_hash) — safe to re-run.
 *
 * Handles BOTH filename schemes: worker captures (evidence/<12-hex>.png) and
 * Santa Cruz imports (evidence/<original-basename>.png, possibly with no
 * source URL at all).
 *
 *   pnpm backfill-sources [--tenant slug] [--dry]
 */
import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import {
  normalizeForMatch,
  stripHtml,
  SOURCE_TEXT_MAX_CHARS,
  type IndicatorEvidence,
} from '@deep-fryer/core';
import {
  dimensions,
  dimensionVersions,
  findings,
  getDb,
  recordSource,
  researchSessions,
  sources,
  tenants,
  type NewSource,
} from '@deep-fryer/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface EvidenceRef {
  evidence: IndicatorEvidence;
  url: string;
  sourceTier: number | null;
  dimensionId: string;
  runId: string | null;
  sessionId: string | null;
}

async function fetchText(
  url: string,
): Promise<{ text: string; mediaType: 'html' | 'pdf'; title: string | null } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const doc = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
      const { text } = await extractText(doc, { mergePages: true });
      const merged = (Array.isArray(text) ? text.join('\n') : text).trim();
      return merged ? { text: merged.slice(0, SOURCE_TEXT_MAX_CHARS), mediaType: 'pdf', title: null } : null;
    }
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
    const text = stripHtml(html);
    return text ? { text: text.slice(0, SOURCE_TEXT_MAX_CHARS), mediaType: 'html', title } : null;
  } catch {
    return null;
  }
}

async function backfillTenant(db: ReturnType<typeof getDb>, tenantId: string, slug: string, dry: boolean) {
  const dims = await db.select().from(dimensions).where(eq(dimensions.tenantId, tenantId));
  const dimIds = dims.map((d) => d.id);
  if (!dimIds.length) return;

  // (a) Published history: indicators inside dimension_versions.data.
  const versions = await db
    .select()
    .from(dimensionVersions)
    .where(inArray(dimensionVersions.dimensionId, dimIds));
  // (b) Findings payloads: carry run/session provenance + tier.
  const findingRows = await db
    .select({ finding: findings, runId: researchSessions.runId })
    .from(findings)
    .innerJoin(researchSessions, eq(findings.sessionId, researchSessions.id))
    .where(inArray(findings.dimensionId, dimIds));

  // Findings first (richer provenance), then versions fill remaining paths.
  const byPath = new Map<string, EvidenceRef>();
  for (const { finding, runId } of findingRows) {
    const p = finding.payload;
    if (p.kind === 'indicator' && p.evidence?.snapshot_path && !byPath.has(p.evidence.snapshot_path)) {
      byPath.set(p.evidence.snapshot_path, {
        evidence: p.evidence,
        url: p.source_url ?? '',
        sourceTier: p.source_tier ?? null,
        dimensionId: finding.dimensionId,
        runId,
        sessionId: finding.sessionId,
      });
    }
  }
  for (const v of versions) {
    for (const ind of v.data.indicators) {
      if (ind.evidence?.snapshot_path && !byPath.has(ind.evidence.snapshot_path)) {
        byPath.set(ind.evidence.snapshot_path, {
          evidence: ind.evidence,
          url: ind.source_url ?? '',
          sourceTier: ind.source_tier ?? null,
          dimensionId: v.dimensionId,
          runId: null,
          sessionId: null,
        });
      }
    }
  }

  const existing = await db
    .select({ snapshotPath: sources.snapshotPath })
    .from(sources)
    .where(eq(sources.tenantId, tenantId));
  const already = new Set(existing.map((r) => r.snapshotPath));

  let created = 0;
  let skipped = 0;
  let fetched = 0;
  let unfetchable = 0;
  for (const [snapshotPath, ref] of byPath) {
    if (already.has(snapshotPath)) {
      skipped += 1;
      continue;
    }
    const extracted = ref.url ? await fetchText(ref.url) : null;
    if (extracted) fetched += 1;
    else unfetchable += 1;

    // Hash basis mirrors capture: normalized text when we have it; otherwise
    // a synthetic basis (the script cannot assume it can read PNG bytes from
    // the bucket) that keeps the unique key honest per exhibit.
    const contentHash = extracted
      ? createHash('sha256')
          .update(normalizeForMatch(`${extracted.title ?? ''}\n${extracted.text}`))
          .digest('hex')
      : createHash('sha256').update(`backfill:${snapshotPath}`).digest('hex');

    const row: NewSource = {
      tenantId,
      url: ref.url,
      urlHash: createHash('sha256').update(ref.url).digest('hex').slice(0, 12),
      contentHash,
      title: extracted?.title ?? null,
      mediaType: extracted?.mediaType ?? (snapshotPath.endsWith('.pdf') ? 'pdf' : 'html'),
      text: extracted?.text ?? null,
      textSource: extracted ? extracted.mediaType : null,
      extraction: 'backfill',
      snapshotPath,
      pdfPath: ref.evidence.pdf_path ?? null,
      capturedAt: new Date(ref.evidence.captured_at),
      runId: ref.runId,
      sessionId: ref.sessionId,
      dimensionId: ref.dimensionId,
      sourceTier: ref.sourceTier,
    };
    if (dry) {
      console.log(
        `  would create ${snapshotPath} (${extracted ? `${extracted.mediaType} text` : 'no text'}${ref.sourceTier ? `, tier ${ref.sourceTier}` : ''})`,
      );
      created += 1;
      continue;
    }
    const inserted = await recordSource(db, row);
    if (inserted) created += 1;
    else skipped += 1;
  }

  console.log(
    `${slug}: ${created} created${dry ? ' (dry)' : ''}, ${skipped} already present, ` +
      `${fetched} with fetched text, ${unfetchable} snapshot-only`,
  );
}

async function main() {
  const db = getDb();
  const dry = process.argv.includes('--dry');
  const only = arg('tenant');
  const rows = only
    ? await db.select().from(tenants).where(eq(tenants.slug, only))
    : await db.select().from(tenants);
  if (!rows.length) throw new Error(only ? `tenant ${only} missing` : 'no tenants');
  for (const t of rows) {
    await backfillTenant(db, t.id, t.slug, dry);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
