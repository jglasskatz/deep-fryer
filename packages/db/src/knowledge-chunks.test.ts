import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withPostgresError } from './errors.js';

/**
 * Row-level security and retrieval tests for `knowledge_chunks` (migration
 * 0025). Integration tests execute real queries as `deep_fryer_app` via
 * `withAuthContext` whenever `DATABASE_URL` is configured, and skip cleanly
 * otherwise (following rls.test.ts).
 */
type DbExecutor = import('./client.js').DbExecutor;
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe('knowledge_chunks migration & RLS contract', () => {
  it('enables RLS, grants app-role access, and enforces tenant_is_public and policy_analysis guards', () => {
    const migrationPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../migrations/0025_knowledge_chunks.sql',
    );
    const sqlText = readFileSync(migrationPath, 'utf8');
    expect(sqlText).toContain('CREATE TABLE "knowledge_chunks"');
    expect(sqlText).toContain('GENERATED ALWAYS AS');
    expect(sqlText).toContain('USING gin ("search_vector")');
    expect(sqlText).toContain('ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY');
    expect(sqlText).toContain("visibility = 'public' AND public.tenant_is_public(tenant_id)");
    expect(sqlText).toContain('public.is_member(tenant_id)');
    expect(sqlText).toContain("source_kind <> 'policy_analysis' OR public.is_editor(tenant_id)");
    expect(sqlText).toContain("source_kind\" <> 'policy_analysis' OR \"knowledge_chunks\".\"visibility\" = 'member'");
    expect(sqlText).toContain('CREATE POLICY knowledge_chunks_editor_insert');
  });
});

describe.skipIf(!hasDb)('knowledge_chunks RLS and retrieval under deep_fryer_app', () => {
  it('enforces public/member/tenant/unpublished/archived boundaries and ranks chunks', async () => {
    const m = await import('./index.js');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();

    const [editorA, viewerA, stranger] = await db
      .insert(m.users)
      .values([1, 2, 3].map(() => ({ email: `${uniq()}@example.org` })))
      .returning();

    const cityA = await m.provisionTenant(db, { slug: uniq(), name: 'City A' });
    const cityB = await m.provisionTenant(db, { slug: uniq(), name: 'City B' });
    await db.insert(m.tenantMembers).values([
      { tenantId: cityA.tenant.id, userId: editorA!.id, role: 'editor' },
      { tenantId: cityA.tenant.id, userId: viewerA!.id, role: 'viewer' },
    ]);

    // Seed public, member-draft, and member-policy chunks for City A (still unpublished)
    // and City B (published).
    await db.insert(m.knowledgeChunks).values([
      {
        tenantId: cityA.tenant.id,
        visibility: 'public',
        sourceKind: 'indicator',
        sourceRef: 'dim:housing:ind:rent-burden',
        dimensionSlug: 'housing',
        title: 'Housing: Rent-burdened households',
        citationLabel: 'Housing: Rent-burdened households (ACS, 2024)',
        citationUrl: 'https://data.census.gov/acs',
        content: 'Measured value: 48.1% of renter households are rent-burdened in City A.',
        contentHash: 'hash-a-pub',
      },
      {
        tenantId: cityA.tenant.id,
        visibility: 'member',
        sourceKind: 'evidence_text',
        sourceRef: 'finding:f1:part-1',
        dimensionSlug: 'housing',
        title: 'Housing: Draft researcher note',
        citationLabel: 'Housing draft note',
        citationUrl: `/${cityA.tenant.slug}/dim/housing`,
        content: 'Internal draft housing review note for City A.',
        contentHash: 'hash-a-mem',
      },
      {
        tenantId: cityA.tenant.id,
        visibility: 'member',
        sourceKind: 'policy_analysis',
        sourceRef: 'policy:p1:summary-1',
        dimensionSlug: 'housing',
        title: 'Policy analysis: Rent cap proposal',
        citationLabel: 'Policy analysis: Rent cap proposal',
        citationUrl: `/${cityA.tenant.slug}/admin/policy/p1`,
        content: 'Unreleased policy brief evaluating rent stabilization in City A.',
        contentHash: 'hash-a-pol',
      },
      {
        tenantId: cityB.tenant.id,
        visibility: 'public',
        sourceKind: 'indicator',
        sourceRef: 'dim:energy:ind:clean-grid',
        dimensionSlug: 'energy',
        title: 'Energy: Clean electricity share',
        citationLabel: 'Energy: Clean electricity share (2024)',
        citationUrl: 'https://energy.example.gov/grid',
        content: 'Measured value: 62% clean electricity in City B.',
        contentHash: 'hash-b-pub',
      },
      {
        tenantId: cityB.tenant.id,
        visibility: 'member',
        sourceKind: 'evidence_text',
        sourceRef: 'finding:b1:part-1',
        dimensionSlug: 'energy',
        title: 'Energy: City B internal draft',
        citationLabel: 'City B draft',
        citationUrl: `/${cityB.tenant.slug}/dim/energy`,
        content: 'Secret draft energy data for City B.',
        contentHash: 'hash-b-mem',
      },
    ]);

    // Check constraint blocks public policy_analysis rows even in system context.
    await expect(
      withPostgresError(
        db.insert(m.knowledgeChunks).values({
          tenantId: cityA.tenant.id,
          visibility: 'public',
          sourceKind: 'policy_analysis',
          sourceRef: 'policy:illegal:1',
          dimensionSlug: null,
          title: 'Illegal public policy',
          citationLabel: 'Illegal',
          citationUrl: null,
          content: 'Should fail check constraint',
          contentHash: 'hash-illegal',
        }),
      ),
    ).rejects.toThrow(/knowledge_chunks_policy_member_only/);

    // Publish City B only; City A remains unpublished.
    const dimB = cityB.dimensions[0]!.dimensionId;
    const vB = (await m.latestVersion(db, dimB))!;
    await db
      .update(m.dimensionVersions)
      .set({ status: 'published', publishedAt: new Date() })
      .where(eq(m.dimensionVersions.id, vB.id));
    await db.update(m.dimensions).set({ publishedVersionId: vB.id }).where(eq(m.dimensions.id, dimB));

    const as = (userId: string | null) => <T>(fn: (tx: DbExecutor) => Promise<T>) =>
      m.withAuthContext(db, userId, fn);

    try {
      // 1. Unpublished City A: anon and stranger see 0 chunks (even visibility = 'public').
      expect(
        await as(null)((tx) =>
          tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityA.tenant.id)),
        ),
      ).toHaveLength(0);
      expect(
        await as(stranger!.id)((tx) =>
          tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityA.tenant.id)),
        ),
      ).toHaveLength(0);

      // 2. Members of City A see their portrait before publish: viewer sees public+member (no policy_analysis); editor sees all 3.
      const viewerRowsA = await as(viewerA!.id)((tx) =>
        tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityA.tenant.id)),
      );
      expect(viewerRowsA.map((r) => r.sourceKind).sort()).toEqual(['evidence_text', 'indicator']);

      const editorRowsA = await as(editorA!.id)((tx) =>
        tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityA.tenant.id)),
      );
      expect(editorRowsA).toHaveLength(3);

      // 3. Published City B: anon and editor of A see ONLY City B's public chunk, never City B's member chunk.
      const anonRowsB = await as(null)((tx) =>
        tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityB.tenant.id)),
      );
      expect(anonRowsB).toHaveLength(1);
      expect(anonRowsB[0]!.visibility).toBe('public');

      const editorARowsB = await as(editorA!.id)((tx) =>
        tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityB.tenant.id)),
      );
      expect(editorARowsB).toHaveLength(1);
      expect(editorARowsB[0]!.visibility).toBe('public');

      // 4. Cross-tenant writes and non-editor writes are blocked by RLS.
      await expect(
        withPostgresError(
          as(editorA!.id)((tx) =>
            tx.insert(m.knowledgeChunks).values({
              tenantId: cityB.tenant.id,
              visibility: 'public',
              sourceKind: 'indicator',
              sourceRef: 'dim:energy:ind:forged',
              dimensionSlug: 'energy',
              title: 'Forged',
              citationLabel: 'Forged',
              citationUrl: null,
              content: 'Cross-tenant attack',
              contentHash: 'hash-forged',
            }),
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      await expect(
        withPostgresError(
          as(viewerA!.id)((tx) =>
            tx.insert(m.knowledgeChunks).values({
              tenantId: cityA.tenant.id,
              visibility: 'public',
              sourceKind: 'indicator',
              sourceRef: 'dim:housing:ind:viewer-write',
              dimensionSlug: 'housing',
              title: 'Viewer write',
              citationLabel: 'Viewer',
              citationUrl: null,
              content: 'Viewers cannot write',
              contentHash: 'hash-viewer',
            }),
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      // 5. Publish City A -> anon can now retrieve public housing chunk via retrievePortraitChunks, still never member chunks.
      const dimA = cityA.dimensions[0]!.dimensionId;
      const vA = (await m.latestVersion(db, dimA))!;
      await db
        .update(m.dimensionVersions)
        .set({ status: 'published', publishedAt: new Date() })
        .where(eq(m.dimensionVersions.id, vA.id));
      await db.update(m.dimensions).set({ publishedVersionId: vA.id }).where(eq(m.dimensions.id, dimA));

      const anonHits = await as(null)((tx) =>
        m.retrievePortraitChunks(tx, {
          tenantId: cityA.tenant.id,
          question: 'What share of renter households are rent burdened?',
          includeMember: true, // Even if caller asks for member, RLS restricts anon to public only!
        }),
      );
      expect(anonHits).toHaveLength(1);
      expect(anonHits[0]!.visibility).toBe('public');
      expect(anonHits[0]!.sourceRef).toBe('dim:housing:ind:rent-burden');

      const editorHits = await as(editorA!.id)((tx) =>
        m.retrievePortraitChunks(tx, {
          tenantId: cityA.tenant.id,
          question: 'rent stabilization policy brief housing',
          includeMember: true,
        }),
      );
      expect(editorHits.some((c) => c.sourceKind === 'policy_analysis')).toBe(true);

      // 6. Archive City A -> anon immediately sees 0 chunks again.
      await db.update(m.tenants).set({ archivedAt: new Date() }).where(eq(m.tenants.id, cityA.tenant.id));
      expect(
        await as(null)((tx) =>
          tx.select().from(m.knowledgeChunks).where(eq(m.knowledgeChunks.tenantId, cityA.tenant.id)),
        ),
      ).toHaveLength(0);
    } finally {
      for (const t of [cityA, cityB]) {
        await db.update(m.dimensions).set({ publishedVersionId: null }).where(eq(m.dimensions.tenantId, t.tenant.id));
        await db.delete(m.tenants).where(eq(m.tenants.id, t.tenant.id));
        await db.delete(m.organizations).where(eq(m.organizations.id, t.tenant.organizationId));
      }
      await db.delete(m.users).where(inArray(m.users.id, [editorA!.id, viewerA!.id, stranger!.id]));
    }
  }, 60_000);
});
