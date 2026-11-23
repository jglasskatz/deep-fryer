import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  RAG_MAX_CHUNKS,
  RAG_MAX_CONTEXT_CHARS,
  buildRelaxedTsQuery,
  capChunksToBudget,
  chunkCustomPageVersion,
  chunkDimensionVersion,
  chunkFindingEvidence,
  chunkOutreachContact,
  chunkPolicyAnalysis,
  extractSearchTerms,
  type FindingPayload,
  type KnowledgeChunkDraft,
  type KnowledgeSourceKind,
  type KnowledgeVisibility,
  type RetrievedChunk,
} from '@deep-fryer/core';
import type { DbExecutor } from './client.js';
import {
  customPages,
  customPageVersions,
  dimensions,
  dimensionVersions,
  findings,
  knowledgeChunks,
  outreachContacts,
  outreachContactVersions,
  policyAnalyses,
} from './schema.js';

export interface ReindexSummary {
  inserted: number;
  updated: number;
  deleted: number;
  total: number;
}

type ChunkKey = string;
const chunkKey = (visibility: string, sourceKind: string, sourceRef: string): ChunkKey =>
  `${visibility}\u001f${sourceKind}\u001f${sourceRef}`;

/**
 * Diff-syncs a scoped slice of `knowledge_chunks` for one tenant: unchanged
 * chunks (matching `contentHash`) are left untouched, changed chunks update in
 * place, new chunks insert, and stale chunks delete. Never sets `search_vector`
 * directly because Postgres computes it as a `GENERATED ALWAYS` column.
 */
async function syncChunkSlice(
  db: DbExecutor,
  tenantId: string,
  existing: ReadonlyArray<{
    id: string;
    visibility: KnowledgeVisibility;
    sourceKind: KnowledgeSourceKind;
    sourceRef: string;
    contentHash: string;
  }>,
  drafts: readonly KnowledgeChunkDraft[],
): Promise<ReindexSummary> {
  // Deduplicate incoming drafts deterministically (last wins on identical key).
  const desiredByKey = new Map<ChunkKey, KnowledgeChunkDraft>();
  for (const draft of drafts) {
    if (!draft.content.trim()) continue;
    desiredByKey.set(chunkKey(draft.visibility, draft.sourceKind, draft.sourceRef), draft);
  }

  const existingByKey = new Map(existing.map((r) => [chunkKey(r.visibility, r.sourceKind, r.sourceRef), r]));
  const toInsert: KnowledgeChunkDraft[] = [];
  const toUpdate: Array<{ id: string; draft: KnowledgeChunkDraft }> = [];
  const toDeleteIds: string[] = [];

  for (const [key, draft] of desiredByKey) {
    const prev = existingByKey.get(key);
    if (!prev) {
      toInsert.push(draft);
    } else if (prev.contentHash !== draft.contentHash) {
      toUpdate.push({ id: prev.id, draft });
    }
  }

  for (const [key, prev] of existingByKey) {
    if (!desiredByKey.has(key)) toDeleteIds.push(prev.id);
  }

  if (toDeleteIds.length > 0) {
    await db
      .delete(knowledgeChunks)
      .where(and(eq(knowledgeChunks.tenantId, tenantId), inArray(knowledgeChunks.id, toDeleteIds)));
  }

  const now = new Date();
  for (const { id, draft } of toUpdate) {
    await db
      .update(knowledgeChunks)
      .set({
        dimensionSlug: draft.dimensionSlug,
        title: draft.title,
        citationLabel: draft.citationLabel,
        citationUrl: draft.citationUrl,
        content: draft.content,
        contentHash: draft.contentHash,
        updatedAt: now,
      })
      .where(and(eq(knowledgeChunks.id, id), eq(knowledgeChunks.tenantId, tenantId)));
  }

  if (toInsert.length > 0) {
    await db.insert(knowledgeChunks).values(
      toInsert.map((draft) => ({
        tenantId,
        visibility: draft.visibility,
        sourceKind: draft.sourceKind,
        sourceRef: draft.sourceRef,
        dimensionSlug: draft.dimensionSlug,
        title: draft.title,
        citationLabel: draft.citationLabel,
        citationUrl: draft.citationUrl,
        content: draft.content,
        contentHash: draft.contentHash,
        updatedAt: now,
      })),
    );
  }

  return {
    inserted: toInsert.length,
    updated: toUpdate.length,
    deleted: toDeleteIds.length,
    total: desiredByKey.size,
  };
}

/**
 * Refreshes the public `knowledge_chunks` slice for a single dimension.
 * Safe to invoke inside a `userDb` transaction on publish/revert (editor+ RLS
 * write policies allow writing chunks for the acting editor's own tenant).
 */
export async function reindexDimensionKnowledge(
  db: DbExecutor,
  input: {
    tenantId: string;
    tenantSlug: string;
    dimensionId: string;
    evidenceTexts?: Readonly<Record<string, string>>;
  },
): Promise<ReindexSummary> {
  const [dim] = await db
    .select({
      id: dimensions.id,
      slug: dimensions.slug,
      ring: dimensions.ring,
      publishedVersionId: dimensions.publishedVersionId,
      archivedAt: dimensions.archivedAt,
    })
    .from(dimensions)
    .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, input.tenantId)));

  if (!dim) return { inserted: 0, updated: 0, deleted: 0, total: 0 };

  let drafts: KnowledgeChunkDraft[] = [];
  if (!dim.archivedAt && dim.publishedVersionId) {
    const [version] = await db
      .select({ versionNum: dimensionVersions.versionNum, data: dimensionVersions.data })
      .from(dimensionVersions)
      .where(eq(dimensionVersions.id, dim.publishedVersionId));
    if (version) {
      drafts = chunkDimensionVersion({
        tenantSlug: input.tenantSlug,
        dimensionSlug: dim.slug,
        ring: dim.ring,
        versionNum: version.versionNum,
        data: version.data,
        visibility: 'public',
        evidenceTexts: input.evidenceTexts,
      });
    }
  }

  const existing = await db
    .select({
      id: knowledgeChunks.id,
      visibility: knowledgeChunks.visibility,
      sourceKind: knowledgeChunks.sourceKind,
      sourceRef: knowledgeChunks.sourceRef,
      contentHash: knowledgeChunks.contentHash,
    })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.tenantId, input.tenantId),
        eq(knowledgeChunks.visibility, 'public'),
        eq(knowledgeChunks.dimensionSlug, dim.slug),
        inArray(knowledgeChunks.sourceKind, ['indicator', 'evidence_text']),
      ),
    );

  return syncChunkSlice(db, input.tenantId, existing, drafts);
}

/**
 * Refreshes the public `knowledge_chunks` slice for one custom page on publish
 * or unpublish (runs cleanly inside the caller's `userDb` transaction).
 */
export async function reindexCustomPageKnowledge(
  db: DbExecutor,
  input: { tenantId: string; tenantSlug: string; pageId: string },
): Promise<ReindexSummary> {
  const [page] = await db
    .select({
      id: customPages.id,
      slug: customPages.slug,
      publishedVersionId: customPages.publishedVersionId,
    })
    .from(customPages)
    .where(and(eq(customPages.id, input.pageId), eq(customPages.tenantId, input.tenantId)));

  if (!page) return { inserted: 0, updated: 0, deleted: 0, total: 0 };

  let drafts: KnowledgeChunkDraft[] = [];
  if (page.publishedVersionId) {
    const [version] = await db
      .select({
        title: customPageVersions.title,
        mdxBody: customPageVersions.mdxBody,
        versionNum: customPageVersions.versionNum,
        status: customPageVersions.status,
      })
      .from(customPageVersions)
      .where(eq(customPageVersions.id, page.publishedVersionId));
    if (version && version.status === 'published') {
      drafts = chunkCustomPageVersion({
        tenantSlug: input.tenantSlug,
        pageSlug: page.slug,
        title: version.title,
        mdxBody: version.mdxBody,
        versionNum: version.versionNum,
        visibility: 'public',
      });
    }
  }

  const existing = await db
    .select({
      id: knowledgeChunks.id,
      visibility: knowledgeChunks.visibility,
      sourceKind: knowledgeChunks.sourceKind,
      sourceRef: knowledgeChunks.sourceRef,
      contentHash: knowledgeChunks.contentHash,
    })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.tenantId, input.tenantId),
        eq(knowledgeChunks.visibility, 'public'),
        eq(knowledgeChunks.sourceKind, 'custom_page'),
        like(knowledgeChunks.sourceRef, `page:${page.slug}:%`),
      ),
    );

  return syncChunkSlice(db, input.tenantId, existing, drafts);
}

/**
 * Full deterministic reindex of a portrait's `knowledge_chunks`.
 *
 * Indexes published dimensions, published custom pages, and published outreach
 * contacts into `visibility = 'public'`. When `includeMember` is true (default),
 * also indexes unpublished latest dimension/page drafts, finding notes/source
 * excerpts, and completed policy analyses into `visibility = 'member'`.
 */
export async function reindexTenantKnowledge(
  db: DbExecutor,
  input: {
    tenantId: string;
    tenantSlug: string;
    includeMember?: boolean;
    /** Optional captured readable texts keyed by evidence text_path or indicator key. */
    evidenceTexts?: Readonly<Record<string, string>>;
  },
): Promise<ReindexSummary> {
  const includeMember = input.includeMember ?? true;
  const drafts: KnowledgeChunkDraft[] = [];

  // 1. Dimensions (published -> public; newer drafts -> member)
  const dims = await db
    .select({
      id: dimensions.id,
      slug: dimensions.slug,
      ring: dimensions.ring,
      publishedVersionId: dimensions.publishedVersionId,
    })
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, input.tenantId), isNull(dimensions.archivedAt)));

  const dimById = new Map(dims.map((d) => [d.id, d]));
  const publishedDimVersionIds = dims
    .map((d) => d.publishedVersionId)
    .filter((id): id is string => Boolean(id));

  const publishedVersions = publishedDimVersionIds.length
    ? await db
        .select({
          id: dimensionVersions.id,
          dimensionId: dimensionVersions.dimensionId,
          versionNum: dimensionVersions.versionNum,
          data: dimensionVersions.data,
        })
        .from(dimensionVersions)
        .where(inArray(dimensionVersions.id, publishedDimVersionIds))
    : [];

  const dimNames = new Map<string, string>();
  for (const v of publishedVersions) {
    const dim = dimById.get(v.dimensionId);
    if (!dim) continue;
    dimNames.set(dim.id, v.data.name);
    drafts.push(
      ...chunkDimensionVersion({
        tenantSlug: input.tenantSlug,
        dimensionSlug: dim.slug,
        ring: dim.ring,
        versionNum: v.versionNum,
        data: v.data,
        visibility: 'public',
        evidenceTexts: input.evidenceTexts,
      }),
    );
  }

  if (includeMember && dims.length > 0) {
    const dimIds = dims.map((d) => d.id);
    const latestVersions = await db
      .selectDistinctOn([dimensionVersions.dimensionId], {
        id: dimensionVersions.id,
        dimensionId: dimensionVersions.dimensionId,
        versionNum: dimensionVersions.versionNum,
        data: dimensionVersions.data,
      })
      .from(dimensionVersions)
      .where(inArray(dimensionVersions.dimensionId, dimIds))
      .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum));

    for (const v of latestVersions) {
      const dim = dimById.get(v.dimensionId);
      if (!dim) continue;
      if (!dimNames.has(dim.id)) dimNames.set(dim.id, v.data.name);
      if (v.id === dim.publishedVersionId) continue;
      drafts.push(
        ...chunkDimensionVersion({
          tenantSlug: input.tenantSlug,
          dimensionSlug: dim.slug,
          ring: dim.ring,
          versionNum: v.versionNum,
          data: v.data,
          visibility: 'member',
          evidenceTexts: input.evidenceTexts,
        }),
      );
    }

    // Findings carrying notes or captured source_text excerpts -> member visibility
    const dimFindings = await db
      .select({
        id: findings.id,
        dimensionId: findings.dimensionId,
        payload: findings.payload,
      })
      .from(findings)
      .where(inArray(findings.dimensionId, dimIds))
      .orderBy(desc(findings.createdAt))
      .limit(500);

    for (const f of dimFindings) {
      const dim = dimById.get(f.dimensionId);
      if (!dim) continue;
      const payload = f.payload as FindingPayload & { source_text?: string };
      const textPath = payload.kind !== 'gap' ? payload.evidence?.text_path : undefined;
      const externalText = textPath && input.evidenceTexts ? input.evidenceTexts[textPath] : undefined;
      drafts.push(
        ...chunkFindingEvidence({
          tenantSlug: input.tenantSlug,
          findingId: f.id,
          dimensionSlug: dim.slug,
          dimensionName: dimNames.get(dim.id) ?? dim.slug,
          payload,
          sourceText: externalText,
          visibility: 'member',
        }),
      );
    }
  }

  // 2. Custom pages (published -> public; unpublished drafts -> member)
  const pages = await db
    .select({
      id: customPages.id,
      slug: customPages.slug,
      publishedVersionId: customPages.publishedVersionId,
    })
    .from(customPages)
    .where(eq(customPages.tenantId, input.tenantId));

  const pageById = new Map(pages.map((p) => [p.id, p]));
  const pubPageIds = pages.map((p) => p.publishedVersionId).filter((id): id is string => Boolean(id));
  if (pubPageIds.length > 0) {
    const pubPages = await db
      .select({
        pageId: customPageVersions.pageId,
        title: customPageVersions.title,
        mdxBody: customPageVersions.mdxBody,
        versionNum: customPageVersions.versionNum,
        status: customPageVersions.status,
      })
      .from(customPageVersions)
      .where(inArray(customPageVersions.id, pubPageIds));
    for (const pv of pubPages) {
      const page = pageById.get(pv.pageId);
      if (!page || pv.status !== 'published') continue;
      drafts.push(
        ...chunkCustomPageVersion({
          tenantSlug: input.tenantSlug,
          pageSlug: page.slug,
          title: pv.title,
          mdxBody: pv.mdxBody,
          versionNum: pv.versionNum,
          visibility: 'public',
        }),
      );
    }
  }

  if (includeMember && pages.length > 0) {
    const latestPages = await db
      .selectDistinctOn([customPageVersions.pageId], {
        id: customPageVersions.id,
        pageId: customPageVersions.pageId,
        title: customPageVersions.title,
        mdxBody: customPageVersions.mdxBody,
        versionNum: customPageVersions.versionNum,
      })
      .from(customPageVersions)
      .where(inArray(customPageVersions.pageId, pages.map((p) => p.id)))
      .orderBy(customPageVersions.pageId, desc(customPageVersions.versionNum));
    for (const lp of latestPages) {
      const page = pageById.get(lp.pageId);
      if (!page || lp.id === page.publishedVersionId) continue;
      drafts.push(
        ...chunkCustomPageVersion({
          tenantSlug: input.tenantSlug,
          pageSlug: page.slug,
          title: lp.title,
          mdxBody: lp.mdxBody,
          versionNum: lp.versionNum,
          visibility: 'member',
        }),
      );
    }
  }

  // 3. Outreach contacts (published only -> public, strictly public fields)
  const publishedContacts = await db
    .select({
      contactId: outreachContacts.id,
      data: outreachContactVersions.data,
    })
    .from(outreachContacts)
    .innerJoin(
      outreachContactVersions,
      and(
        eq(outreachContactVersions.id, outreachContacts.publishedVersionId),
        eq(outreachContactVersions.contactId, outreachContacts.id),
      ),
    )
    .where(
      and(
        eq(outreachContacts.tenantId, input.tenantId),
        isNull(outreachContacts.archivedAt),
        eq(outreachContactVersions.status, 'published'),
      ),
    );
  for (const contact of publishedContacts) {
    drafts.push(
      ...chunkOutreachContact({
        tenantSlug: input.tenantSlug,
        contactId: contact.contactId,
        data: contact.data,
        visibility: 'public',
      }),
    );
  }

  // 4. Policy analyses (ALWAYS member-only, completed only)
  if (includeMember) {
    const analyses = await db
      .select({
        id: policyAnalyses.id,
        title: policyAnalyses.title,
        brief: policyAnalyses.brief,
        sourceUrl: policyAnalyses.sourceUrl,
        result: policyAnalyses.result,
        projections: policyAnalyses.projections,
      })
      .from(policyAnalyses)
      .where(and(eq(policyAnalyses.tenantId, input.tenantId), eq(policyAnalyses.status, 'complete')))
      .orderBy(desc(policyAnalyses.createdAt))
      .limit(100);
    for (const analysis of analyses) {
      drafts.push(
        ...chunkPolicyAnalysis({
          tenantSlug: input.tenantSlug,
          analysisId: analysis.id,
          title: analysis.title,
          brief: analysis.brief,
          sourceUrl: analysis.sourceUrl,
          result: analysis.result,
          projections: analysis.projections,
        }),
      );
    }
  }

  const visibilities: KnowledgeVisibility[] = includeMember ? ['public', 'member'] : ['public'];
  const existing = await db
    .select({
      id: knowledgeChunks.id,
      visibility: knowledgeChunks.visibility,
      sourceKind: knowledgeChunks.sourceKind,
      sourceRef: knowledgeChunks.sourceRef,
      contentHash: knowledgeChunks.contentHash,
    })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.tenantId, input.tenantId), inArray(knowledgeChunks.visibility, visibilities)));

  return syncChunkSlice(db, input.tenantId, existing, drafts);
}

export interface RetrievePortraitChunksInput {
  tenantId: string;
  question: string;
  includeMember: boolean;
  dimensionSlug?: string | null;
  limit?: number;
  maxChars?: number;
}

type RawChunkRow = {
  id: string;
  visibility: KnowledgeVisibility;
  source_kind: KnowledgeSourceKind;
  source_ref: string;
  dimension_slug: string | null;
  title: string;
  citation_label: string;
  citation_url: string | null;
  content: string;
  content_hash: string;
  score: number;
};

/**
 * Hybrid native Postgres 16 retrieval over `knowledge_chunks`:
 * - Combines `websearch_to_tsquery` (phrase/AND precision) with a sanitized
 *   OR-token `to_tsquery` fallback so multi-word civic questions still retrieve
 *   relevant indicators when one conversational word is absent.
 * - Uses `ts_rank_cd(..., 32)` for BM25-style length-normalized cover density,
 *   plus dimension/slug boosts and indicator preference.
 * - Runs on the caller's executor (`userDb` / anonymous `withAuthContext`), so
 *   Postgres RLS enforces tenant and visibility boundaries independently of
 *   the explicit WHERE predicates below.
 */
export async function retrievePortraitChunks(
  db: DbExecutor,
  input: RetrievePortraitChunksInput,
): Promise<RetrievedChunk[]> {
  const limit = Math.max(1, Math.min(input.limit ?? RAG_MAX_CHUNKS, 20));
  const maxChars = Math.max(500, Math.min(input.maxChars ?? RAG_MAX_CONTEXT_CHARS, 32_000));
  const terms = extractSearchTerms(input.question);
  const relaxedQuery = buildRelaxedTsQuery(input.question);
  if (!relaxedQuery || terms.length === 0) return [];

  const candidateLimit = Math.max(limit * 3, 24);
  const dimFilter = input.dimensionSlug ?? null;
  // Pass terms as a Postgres text[] literal safely via sql array binding.
  const termsArrayLiteral = `{${terms.join(',')}}`;
  const visibilityPredicate = input.includeMember
    ? sql`kc.visibility IN ('public', 'member')`
    : sql`kc.visibility = 'public'`;

  const rows = await db.execute<RawChunkRow>(sql`
    WITH q AS (
      SELECT
        websearch_to_tsquery('english', ${input.question}) AS strict_q,
        to_tsquery('english', ${relaxedQuery}) AS relaxed_q
    )
    SELECT
      kc.id,
      kc.visibility,
      kc.source_kind,
      kc.source_ref,
      kc.dimension_slug,
      kc.title,
      kc.citation_label,
      kc.citation_url,
      kc.content,
      kc.content_hash,
      (
        (ts_rank_cd(kc.search_vector, q.strict_q, 32) * 3.0)
        + ts_rank_cd(kc.search_vector, q.relaxed_q, 32)
        + CASE WHEN ${dimFilter}::text IS NOT NULL AND kc.dimension_slug = ${dimFilter}::text THEN 0.5 ELSE 0.0 END
        + CASE
            WHEN kc.dimension_slug IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(${termsArrayLiteral}::text[]) AS t(term)
              WHERE kc.dimension_slug LIKE '%' || t.term || '%'
            ) THEN 0.35
            ELSE 0.0
          END
        + CASE WHEN kc.source_kind = 'indicator' THEN 0.1 ELSE 0.0 END
      )::double precision AS score
    FROM knowledge_chunks kc, q
    WHERE kc.tenant_id = ${input.tenantId}::uuid
      AND ${visibilityPredicate}
      AND (
        (q.strict_q <> ''::tsquery AND kc.search_vector @@ q.strict_q)
        OR kc.search_vector @@ q.relaxed_q
      )
    ORDER BY score DESC, kc.updated_at DESC, kc.id ASC
    LIMIT ${candidateLimit}
  `);

  const mapped: RetrievedChunk[] = rows.map((row) => ({
    id: row.id,
    visibility: row.visibility,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    dimensionSlug: row.dimension_slug,
    title: row.title,
    citationLabel: row.citation_label,
    citationUrl: row.citation_url,
    content: row.content,
    contentHash: row.content_hash,
    score: Number(row.score),
  }));

  return capChunksToBudget(mapped, maxChars, limit);
}
