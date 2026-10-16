import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * createPolicyAnalysis and cancelPolicyAnalysis — the research quota gate
 * applied to policy analyses. Runs as the dev-mode identity (no AUTH_SECRET:
 * the local developer is owner everywhere), against real Postgres, including
 * graphile-worker's real queue tables: the job is added in the same
 * transaction as the analysis, and these tests read it back. Only Next's
 * cache revalidation is stubbed, and the queue helpers are wrapped so a test
 * can make the queue fail.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const queue = vi.hoisted(() => ({ schemaDown: false, addFails: false }));
vi.mock('@deep-fryer/research', async (orig) => {
  const real = await orig<typeof import('@deep-fryer/research')>();
  return {
    ...real,
    ensureJobQueueSchema: async () => {
      if (queue.schemaDown) throw new Error('connection refused');
      return real.ensureJobQueueSchema();
    },
    // Evaluated inside the transaction while the add_job statement is built,
    // so throwing here fails the enqueue after the row and audit are written.
    policyJobKey: (id: string) => {
      if (queue.addFails) throw new Error('add_job failed');
      return real.policyJobKey(id);
    },
  };
});
// Server actions revalidate pages; there is no Next request here.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// For the one signed-in test: whoever `signedIn` names is the request's
// user, the session read through the pooled client as in production
// (test/database-session.ts). Dev mode never calls auth().
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const BRIEF =
  'Expand the city’s cooling-center network to every community district, open from June through September, with extended hours during heat advisories.';

describe.skipIf(!hasDb)('createPolicyAnalysis', () => {
  const savedSecret = process.env.AUTH_SECRET;
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });
  afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });

  /** A portrait whose organization is on a trial with `allowance` research sessions. */
  async function portrait(allowance: number | null) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Policy Town', startTrial: allowance !== null });
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Policy Town', organizationId: org.id });
    // New portraits start with every feature off (SPEC-v7 §3); these actions sit behind policy_analysis.
    const { setPortraitFeatures } = await import('./test-features');
    await setPortraitFeatures(tenant.id, { policy_analysis: true });
    if (allowance !== null) {
      await db
        .update(m.subscriptions)
        .set({ researchSessionsOverride: allowance })
        .where(eq(m.subscriptions.organizationId, org.id));
    }
    cleanup.push(async () => {
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
    });
    return { org, tenant };
  }

  async function analysesOf(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.policyAnalyses)
      .where(eq(m.policyAnalyses.tenantId, tenantId));
  }

  /** The queued graphile-worker job for an analysis, if any; removed again at cleanup. */
  async function jobFor(analysisId: string) {
    const m = await import('@deep-fryer/db');
    const { sql } = await import('drizzle-orm');
    const key = `policy:${analysisId}`;
    cleanup.push(() => m.getDb().execute(sql`select graphile_worker.remove_job(${key})`));
    const rows = await m.getDb().execute<{ task_identifier: string; payload: { analysisId: string } }>(
      sql`select t.identifier as task_identifier, j.payload
            from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id = j.task_id
           where j.key = ${key}`,
    );
    return rows[0] ?? null;
  }

  async function auditOf(tenantId: string) {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    return m
      .getDb()
      .select()
      .from(m.auditLog)
      .where(and(eq(m.auditLog.tenantId, tenantId), eq(m.auditLog.entity, 'policy_analysis')));
  }

  it('queues an analysis and its job together within the allowance, then refuses what would exceed it', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { DEV_USER_ID } = await import('./auth');
    const { tenant } = await portrait(1);

    const res = await createPolicyAnalysis({
      tenantSlug: tenant.slug,
      title: '  Cooling   centers  ',
      brief: BRIEF,
      sourceUrl: 'https://example.gov/cooling.pdf',
    });
    expect(res.ok).toBe(true);
    const { id } = (res as { ok: true; data: { id: string } }).data;
    expect(await jobFor(id)).toEqual({ task_identifier: 'policy_analyze', payload: { analysisId: id } });

    const [row] = await analysesOf(tenant.id);
    expect(row).toMatchObject({
      id,
      status: 'queued',
      title: 'Cooling centers',
      brief: BRIEF,
      sourceUrl: 'https://example.gov/cooling.pdf',
      requestedBy: DEV_USER_ID,
      // No key on file: the gate funded it from the plan, and the row says so (migration 0012).
      funding: 'plan',
    });
    const audit = await auditOf(tenant.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: id, action: 'create' });

    // The one session is now spent: the next analysis is refused, and nothing is inserted.
    const refused = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Second', brief: BRIEF });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { ok: false; error: string }).error).toMatch(
      /A policy analysis uses 1 research session; 0 of 1 remain this billing period/,
    );
    expect(await analysesOf(tenant.id)).toHaveLength(1);
  });

  it('saves nothing and reserves nothing when the job cannot be added', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { tenant } = await portrait(1);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempt = (title: string) => createPolicyAnalysis({ tenantSlug: tenant.slug, title, brief: BRIEF });
    const queueDown = /could not be started — the job queue did not answer\. Nothing was saved or counted against your plan/;

    try {
      // The queue cannot be reached at all: refused before the transaction.
      queue.schemaDown = true;
      expect((await attempt('Queue unreachable')) as { error: string }).toMatchObject({ ok: false, error: expect.stringMatching(queueDown) });
      queue.schemaDown = false;

      // The job insert fails mid-transaction: the analysis row and its audit
      // entry, already written, roll back with it.
      queue.addFails = true;
      expect((await attempt('Queue refuses')) as { error: string }).toMatchObject({ ok: false, error: expect.stringMatching(queueDown) });
    } finally {
      queue.schemaDown = false;
      queue.addFails = false;
      errorLog.mockRestore();
    }
    expect(await analysesOf(tenant.id)).toHaveLength(0);
    expect(await auditOf(tenant.id)).toHaveLength(0);

    // Nothing was reserved, so the allowance of one still fits an analysis.
    const retry = await attempt('Queue back');
    expect(retry.ok).toBe(true);
    expect(await jobFor((retry as { ok: true; data: { id: string } }).data.id)).not.toBeNull();
  });

  it('cancels a queued analysis, releasing its session, but never one that has started', async () => {
    const { createPolicyAnalysis, cancelPolicyAnalysis } = await import('./policy-actions');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { tenant } = await portrait(1);

    const created = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Stuck in the queue', brief: BRIEF });
    const { id } = (created as { ok: true; data: { id: string } }).data;
    await jobFor(id);
    expect(await cancelPolicyAnalysis({ tenantSlug: tenant.slug, id })).toEqual({ ok: true, data: { id } });
    const [row] = await analysesOf(tenant.id);
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Cancelled before it started/) });
    expect((await auditOf(tenant.id)).map((a) => a.action).sort()).toEqual(['cancel', 'create']);

    // Cancelled analyses are not billed: the allowance of one fits another…
    const next = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Second try', brief: BRIEF });
    expect(next.ok).toBe(true);
    const nextId = (next as { ok: true; data: { id: string } }).data.id;
    await jobFor(nextId);

    // …which the worker claims; a running analysis cannot be cancelled.
    await m.getDb().update(m.policyAnalyses).set({ status: 'running' }).where(eq(m.policyAnalyses.id, nextId));
    expect(await cancelPolicyAnalysis({ tenantSlug: tenant.slug, id: nextId })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/already started or finished/),
    });
    // Twice is the same as once; another portrait's or a malformed id changes nothing.
    expect(await cancelPolicyAnalysis({ tenantSlug: tenant.slug, id })).toMatchObject({ ok: false });
    const { tenant: other } = await portrait(1);
    expect(await cancelPolicyAnalysis({ tenantSlug: other.slug, id: nextId })).toMatchObject({ ok: false });
    expect(await cancelPolicyAnalysis({ tenantSlug: tenant.slug, id: 'not-a-uuid' })).toMatchObject({ ok: false });
    expect((await analysesOf(tenant.id)).find((r) => r.id === nextId)!.status).toBe('running');
  });

  it('refuses an organization without a plan with the billing message', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { tenant } = await portrait(null);
    const res = await createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'No plan', brief: BRIEF });
    expect((res as { ok: false; error: string }).error).toMatch(/no plan yet/);
    expect(await analysesOf(tenant.id)).toHaveLength(0);
  });

  it('validates the title, brief length, and https-only source before spending anything', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    const { POLICY_BRIEF_MAX_CHARS } = await import('@deep-fryer/core');
    const { tenant } = await portrait(5);
    const attempt = async (over: Partial<{ title: string; brief: string; sourceUrl: string }>) =>
      createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Valid title', brief: BRIEF, ...over });

    expect(await attempt({ title: 'ab' })).toEqual({ ok: false, error: 'Give the analysis a title of at least 3 characters.' });
    expect((await attempt({ brief: 'Too short.' })) as { error: string }).toMatchObject({ error: expect.stringMatching(/at least 50 characters/) });
    expect((await attempt({ brief: 'x'.repeat(POLICY_BRIEF_MAX_CHARS + 1) })) as { error: string }).toMatchObject({
      error: expect.stringMatching(/over the 60,000-character limit/),
    });
    expect(await attempt({ sourceUrl: 'http://example.gov/brief' })).toEqual({ ok: false, error: 'The source link must start with https://.' });
    expect(await attempt({ sourceUrl: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    expect(await analysesOf(tenant.id)).toHaveLength(0);

    // A blank source is "no source", not an invalid one.
    const ok = await attempt({ sourceUrl: '   ' });
    expect(ok.ok).toBe(true);
    const [row] = await analysesOf(tenant.id);
    expect(row!.sourceUrl).toBeNull();
    expect(await jobFor(row!.id)).not.toBeNull();
  });

  it('starts and cancels an analysis for a signed-in editor, each in one transaction on one connection', async () => {
    // Both audit inside a system-context transaction, and audit() reads its
    // actor with getAuth(): in a server action that was a session read on
    // the pooled client, waiting for a second connection while the
    // transaction held the first — and the subscription row lock, holding up
    // every other research spend of the organization. Such a transaction has
    // no idle timeout, so nothing ever ended the wait.
    const m = await import('@deep-fryer/db');
    const { tenant } = await portrait(2);
    const [editor] = await m.getDb().insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    await m.getDb().insert(m.tenantMembers).values({ tenantId: tenant.id, userId: editor!.id, role: 'editor' });
    cleanup.push(async () => {
      const { eq } = await import('drizzle-orm');
      await m.getDb().delete(m.users).where(eq(m.users.id, editor!.id));
    });
    process.env.AUTH_SECRET = 'test-secret';
    signedIn = editor!.id;
    try {
      const created = await onOneConnection(async () =>
        (await import('./policy-actions')).createPolicyAnalysis({ tenantSlug: tenant.slug, title: 'Signed in', brief: BRIEF }),
      );
      expect(created).toMatchObject({ ok: true });
      const { id } = (created as { ok: true; data: { id: string } }).data;
      await jobFor(id);
      const cancelled = await onOneConnection(async () =>
        (await import('./policy-actions')).cancelPolicyAnalysis({ tenantSlug: tenant.slug, id }),
      );
      expect(cancelled).toEqual({ ok: true, data: { id } });
    } finally {
      delete process.env.AUTH_SECRET;
      signedIn = null;
    }
    expect((await analysesOf(tenant.id))[0]).toMatchObject({ status: 'failed', requestedBy: editor!.id });
    expect((await auditOf(tenant.id)).map((a) => [a.action, a.userId]).sort()).toEqual(
      [
        ['cancel', editor!.id],
        ['create', editor!.id],
      ].sort(),
    );
  });

  it('refuses an unknown portrait', async () => {
    const { createPolicyAnalysis } = await import('./policy-actions');
    expect(await createPolicyAnalysis({ tenantSlug: uniq(), title: 'Nowhere', brief: BRIEF })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unknown portrait/),
    });
  });
});
