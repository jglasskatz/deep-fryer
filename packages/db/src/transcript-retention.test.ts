import { afterAll, describe, expect, it } from 'vitest';
import { pruneExpiredTranscripts } from './transcript-retention.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const now = new Date('2026-10-23T12:00:00Z');
const age = (days: number) => new Date(now.getTime() - days * 86400_000);
const uniq = () => `retention-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('configured transcript retention', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => { for (const fn of cleanup.reverse()) await fn(); });

  async function seed(retention?: unknown) {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Retention test' });
    await db.delete(m.tenantConfig).where(eq(m.tenantConfig.tenantId, tenant.id));
    if (retention !== undefined) await db.insert(m.tenantConfig).values({ tenantId: tenant.id, key: 'retention', value: retention });
    const [run] = await db.insert(m.researchRuns).values({
      tenantId: tenant.id, status: 'complete', plan: { sessions: [], config_hash: 'test', plugin_version: 'test' },
      configSnapshot: {} as never, tokenUsage: { test: { input_tokens: 123, output_tokens: 45 } }, completedAt: now,
    }).returning();
    cleanup.push(async () => {
      await db.delete(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, tenant.id));
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    });
    const session = async (days: number, status: 'complete' | 'failed' | 'running' = 'complete') =>
      (await db.insert(m.researchSessions).values({ runId: run!.id, kind: 'region_context', status, transcript: Buffer.from('audit bytes'), startedAt: age(days + 1), completedAt: age(days) }).returning())[0]!;
    const policy = async (days: number, status: 'complete' | 'failed' | 'running' = 'complete') =>
      (await db.insert(m.policyAnalyses).values({ tenantId: tenant.id, title: 'Retention test', brief: 'A policy', status, transcript: Buffer.from('policy bytes'), completedAt: age(days), tokenUsage: { input_tokens: 7, output_tokens: 8 } }).returning())[0]!;
    return { m, db, tenant, run: run!, session, policy, eq };
  }

  it('clears only transcript bytes after a tenant’s retention period, retaining outputs, usage and active work', async () => {
    const { m, db, tenant, run, session, policy, eq } = await seed({ transcript_days: 30 });
    const old = await session(31);
    const boundary = await session(30);
    const active = await session(100, 'running');
    const oldPolicy = await policy(31, 'failed');
    const activePolicy = await policy(100, 'running');
    expect(await pruneExpiredTranscripts(db, now, [tenant.id])).toEqual({ research: 1, policy: 1 });
    const readSession = async (id: string) => (await db.select().from(m.researchSessions).where(eq(m.researchSessions.id, id)))[0]!;
    expect((await readSession(old.id)).transcript).toBeNull();
    expect((await readSession(boundary.id)).transcript).toEqual(Buffer.from('audit bytes'));
    expect((await readSession(active.id)).transcript).toEqual(Buffer.from('audit bytes'));
    const policies = await db.select().from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, tenant.id));
    expect(policies.find((p) => p.id === oldPolicy.id)).toMatchObject({ transcript: null, title: 'Retention test', tokenUsage: { input_tokens: 7, output_tokens: 8 } });
    expect(policies.find((p) => p.id === activePolicy.id)!.transcript).toEqual(Buffer.from('policy bytes'));
    expect((await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run.id)))[0]!.tokenUsage).toEqual(run.tokenUsage);
    expect(await pruneExpiredTranscripts(db, now, [tenant.id])).toEqual({ research: 0, policy: 0 });
  });

  it('uses the seven-year default for unset or malformed config and never shortens an oversized policy', async () => {
    for (const config of [undefined, { transcript_days: 'forever' }, { transcript_days: -1 }, { transcript_days: 3.5 }]) {
      const { db, tenant, session } = await seed(config);
      await session(2555);
      await session(2556);
      expect(await pruneExpiredTranscripts(db, now, [tenant.id])).toEqual({ research: 1, policy: 0 });
    }
    const { db, tenant, session } = await seed({ transcript_days: 1e30 });
    await session(10000);
    expect(await pruneExpiredTranscripts(db, now, [tenant.id])).toEqual({ research: 0, policy: 0 });
  });

  it('retains a settled session until its parent run has finished', async () => {
    const { m, db, tenant, run, session, eq } = await seed({ transcript_days: 1 });
    await session(100);
    await db.update(m.researchRuns).set({ status: 'running' }).where(eq(m.researchRuns.id, run.id));
    expect(await pruneExpiredTranscripts(db, now, [tenant.id])).toEqual({ research: 0, policy: 0 });
    expect(await pruneExpiredTranscripts(db, now, [])).toEqual({ research: 0, policy: 0 });
  });
});
