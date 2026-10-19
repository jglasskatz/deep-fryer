import { describe, expect, it } from 'vitest';

/**
 * Integration tests over a real Postgres (migrations applied). They run
 * whenever DATABASE_URL is set — local dev and CI both have one — and skip
 * with a visible notice otherwise rather than faking a database.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('db integration', () => {
  it('provisions a tenant (with its own organization) and enforces version-append numbering', async () => {
    const { getDb, provisionTenant, tenantBySlug, appendDimensionVersion, latestVersion, publishedDoughnut, organizations } =
      await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const slug = uniq();

    const { tenant, dimensions } = await provisionTenant(db, { slug, name: 'Test City' });
    expect(dimensions).toHaveLength(21);
    expect((await tenantBySlug(db, slug))?.id).toBe(tenant.id);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, tenant.organizationId));
    expect(org?.slug).toBe(slug);

    const dimId = dimensions[0]!.dimensionId;
    const v1 = await latestVersion(db, dimId);
    expect(v1?.versionNum).toBe(1);

    const v2 = await appendDimensionVersion(db, {
      dimensionId: dimId,
      status: 'draft',
      data: v1!.data,
      origin: 'human',
      changeNote: 'test edit',
    });
    expect(v2.versionNum).toBe(2);
    expect((await latestVersion(db, dimId))?.id).toBe(v2.id);

    // Concurrent appends all land with distinct, gapless numbers.
    const racers = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        appendDimensionVersion(db, {
          dimensionId: dimId,
          status: 'draft',
          data: v1!.data,
          origin: 'human',
          changeNote: `race ${i}`,
        }),
      ),
    );
    expect(racers.map((v) => v.versionNum).sort()).toEqual([3, 4, 5, 6]);

    // Nothing published yet → portrait exists with zero dimensions.
    const portrait = await publishedDoughnut<{ dimensions: unknown[] }>(db, slug);
    expect(portrait?.dimensions).toHaveLength(0);

    await cleanup(tenant.id, tenant.organizationId);
  });

  it('refuses reserved and malformed slugs before touching the database', async () => {
    const { getDb, provisionTenant } = await import('./index.js');
    await expect(provisionTenant(getDb(), { slug: 'login', name: 'x' })).rejects.toThrow(/reserved/);
    await expect(provisionTenant(getDb(), { slug: 'Bad Slug', name: 'x' })).rejects.toThrow(/lowercase/);
  });

  it('only lets published_version_id point at a published version of the same dimension', async () => {
    const { getDb, provisionTenant, dimensions, dimensionVersions, latestVersion } = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const { tenant, dimensions: dims } = await provisionTenant(db, { slug: uniq(), name: 'Guard City' });
    const [a, b] = dims;
    const draftA = (await latestVersion(db, a!.dimensionId))!;

    // A draft cannot be published by pointer alone…
    await expect(
      db.update(dimensions).set({ publishedVersionId: draftA.id }).where(eq(dimensions.id, a!.dimensionId)),
    ).rejects.toThrow(/published version of this dimension/);

    // …nor can another dimension's published version be borrowed.
    await db.update(dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(dimensionVersions.id, draftA.id));
    await expect(
      db.update(dimensions).set({ publishedVersionId: draftA.id }).where(eq(dimensions.id, b!.dimensionId)),
    ).rejects.toThrow(/published version of this dimension/);

    await db.update(dimensions).set({ publishedVersionId: draftA.id }).where(eq(dimensions.id, a!.dimensionId));
    await cleanup(tenant.id, tenant.organizationId);
  });

  it('meters research usage per organization: reservations while queued, non-failed sessions once done', async () => {
    const {
      getDb, provisionOrganization, provisionTenant, researchRuns, researchSessions,
      researchSessionsUsed, portraitCount, seatCount, users, tenantMembers,
    } = await import('./index.js');
    const db = getDb();
    // Metering counts runs whatever the plan; the organization needs none here.
    const org = await provisionOrganization(db, { slug: uniq(), name: 'Metro' });
    const a = await provisionTenant(db, { slug: uniq(), name: 'Borough A', organizationId: org.id });
    const b = await provisionTenant(db, { slug: uniq(), name: 'Borough B', organizationId: org.id });
    expect(await portraitCount(db, org.id)).toBe(2);

    const plan = (n: number) => ({
      sessions: Array.from({ length: n }, () => ({
        kind: 'dimension' as const, prompt: '', tool_allowlist: [], output_schema_ref: '', config_hash: '',
      })),
      config_hash: 'h',
      plugin_version: 'v',
    });
    const config = {} as never;
    const now = new Date();
    const [queued] = await db.insert(researchRuns).values({
      tenantId: a.tenant.id, status: 'planned', plan: plan(5), configSnapshot: config, appliedAt: now,
    }).returning();
    const [done] = await db.insert(researchRuns).values({
      tenantId: b.tenant.id, status: 'complete', plan: plan(3), configSnapshot: config, appliedAt: now,
    }).returning();
    await db.insert(researchSessions).values([
      { runId: done!.id, kind: 'dimension', status: 'complete' },
      { runId: done!.id, kind: 'dimension', status: 'failed' },
      { runId: done!.id, kind: 'dimension', status: 'complete' },
    ]);
    // Planned but never applied: free.
    await db.insert(researchRuns).values({
      tenantId: a.tenant.id, status: 'planned', plan: plan(22), configSnapshot: config,
    });
    expect(queued).toBeTruthy();

    const used = await researchSessionsUsed(db, org.id, new Date(now.getTime() - 1000));
    expect(used).toBe(5 + 2);

    const [u1] = await db.insert(users).values({ email: `${uniq()}@example.gov` }).returning();
    await db.insert(tenantMembers).values([
      { tenantId: a.tenant.id, userId: u1!.id, role: 'editor' },
      { tenantId: b.tenant.id, userId: u1!.id, role: 'viewer' },
    ]);
    expect(await seatCount(db, org.id)).toBe(1);

    await cleanup(a.tenant.id, null);
    await cleanup(b.tenant.id, org.id);
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.id, u1!.id));
  });
});

/** Delete test tenants (cascades) and their organization. */
async function cleanup(tenantId: string, organizationId: string | null) {
  const { getDb, tenants, organizations, researchRuns, researchSessions, findings, dimensions } =
    await import('./index.js');
  const { eq, inArray } = await import('drizzle-orm');
  const db = getDb();
  const runs = await db.select({ id: researchRuns.id }).from(researchRuns).where(eq(researchRuns.tenantId, tenantId));
  if (runs.length) {
    const sessionIds = (
      await db.select({ id: researchSessions.id }).from(researchSessions).where(inArray(researchSessions.runId, runs.map((r) => r.id)))
    ).map((s) => s.id);
    if (sessionIds.length) {
      const fs = await db.select({ id: findings.id }).from(findings).where(inArray(findings.sessionId, sessionIds));
      expect(fs).toHaveLength(0); // findings are immutable; tests never create them
    }
  }
  await db.update(dimensions).set({ publishedVersionId: null }).where(eq(dimensions.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
  if (organizationId) await db.delete(organizations).where(eq(organizations.id, organizationId));
}

describe.skipIf(hasDb)('db integration (skipped)', () => {
  it('needs DATABASE_URL', () => {
    expect(hasDb).toBe(false);
  });
});
