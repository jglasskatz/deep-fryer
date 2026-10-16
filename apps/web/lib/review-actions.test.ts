import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * The review queue's writes (SPEC.md §9) — approve a run's findings (and
 * publish them), flag a data gap — as a signed-in editor, each on a
 * one-connection pool (test/one-connection.ts). Both read the editor's
 * identity inside their userDb transaction (the version's author, audit()'s
 * actor, publishVersionFor's audit); the session is read through the pooled
 * client as in production (test/database-session.ts), so a read that is not
 * answered by the transaction would wait for a second connection and fail.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// Whoever `signedIn` names is the request's user.
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('review actions on their own transaction', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; sessionId?: string; editor?: string } = {};
  let tenantSlug = '';
  let dimensions: { dimensionId: string; slug: string }[] = [];
  let runId = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Review City' });
    const { tenant } = provisioned;
    tenantSlug = tenant.slug;
    dimensions = provisioned.dimensions;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    cleanup.editor = editor!.id;
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: editor!.id, role: 'editor' });

    // A finished run with one finding for the first dimension, as the worker
    // records it: an honest gap.
    const [run] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: tenant.id,
        status: 'complete',
        plan: { sessions: [], config_hash: 'h', plugin_version: 'v' },
        configSnapshot: {} as never,
      })
      .returning();
    runId = run!.id;
    const [session] = await db
      .insert(m.researchSessions)
      .values({ runId, kind: 'dimension', dimensionId: dimensions[0]!.dimensionId, status: 'complete' })
      .returning();
    cleanup.sessionId = session!.id;
    await db.insert(m.findings).values({
      sessionId: session!.id,
      dimensionId: dimensions[0]!.dimensionId,
      indicatorSlug: 'water-access',
      payload: {
        kind: 'gap',
        indicator_slug: 'water-access',
        reason: 'No city-level series is published.',
        scales_tried: ['city', 'county'],
        searched_at: new Date().toISOString(),
      },
    });
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // Findings are immutable (migration 0001's trigger refuses even the
    // owner), and they hold the portrait's dimensions and sessions in place.
    // This test's own finding goes in one transaction that lifts the trigger
    // for that one delete only: DDL is transactional, so no other session
    // ever sees findings without it.
    if (cleanup.sessionId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        await tx.delete(m.findings).where(eq(m.findings.sessionId, cleanup.sessionId!));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
    }
    // Then the session (it points at a dimension) and the dimensions with
    // their versions (an approved version points at the run), before the
    // portrait takes the run, its config, and its audit entries with it.
    if (cleanup.sessionId) await db.delete(m.researchSessions).where(eq(m.researchSessions.id, cleanup.sessionId));
    if (cleanup.tenantId) {
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, cleanup.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    }
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.editor) await db.delete(m.users).where(eq(m.users.id, cleanup.editor));
  });

  async function auditOf(entityId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const rows = await m.getDb().select().from(m.auditLog).where(eq(m.auditLog.entityId, entityId)).orderBy(m.auditLog.id);
    return rows.map((r) => [r.action, r.userId]);
  }

  async function publishedVersionOf(dimensionId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await m.getDb().select().from(m.dimensions).where(eq(m.dimensions.id, dimensionId));
    return row!.publishedVersionId;
  }

  it('approves and publishes a run’s findings on one transaction', async () => {
    const dimensionId = dimensions[0]!.dimensionId;
    signedIn = cleanup.editor!;
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).approveFindings({ tenantSlug, runId, dimensionId, publish: true }),
    );
    expect(res).toMatchObject({ ok: true });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    expect(await publishedVersionOf(dimensionId)).toBe(versionId);
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const [version] = await m.getDb().select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, versionId));
    expect(version).toMatchObject({ origin: 'research', researchRunId: runId, createdBy: cleanup.editor });
    expect(version!.data.gaps).toEqual([expect.objectContaining({ indicator: 'water-access' })]);
    expect(await auditOf(versionId)).toEqual([['approve_findings', cleanup.editor]]);
    expect(await auditOf(dimensionId)).toEqual([['publish', cleanup.editor]]);
  });

  it('flags a data gap and publishes it on one transaction', async () => {
    const dimensionId = dimensions[1]!.dimensionId;
    signedIn = cleanup.editor!;
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).flagGap({ tenantSlug, dimensionId, indicator: 'air-quality', reason: 'No monitor in the city.' }),
    );
    expect(res).toMatchObject({ ok: true });
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    expect(await publishedVersionOf(dimensionId)).toBe(versionId);
    expect(await auditOf(versionId)).toEqual([['flag_gap', cleanup.editor]]);
    expect(await auditOf(dimensionId)).toEqual([['publish', cleanup.editor]]);
  });
});
