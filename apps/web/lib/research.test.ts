import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';
import { givePlan } from './test-plans';

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// The queue is graphile-worker's; the gate under test is ours.
const queue = vi.hoisted(() => ({ enqueue: vi.fn(async (_runId: string) => {}) }));
vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: queue.enqueue,
}));

describe.skipIf(!hasDb)('applyRun — the research quota gate', () => {
  // Plan-funded research needs the deployment's research key (compose says so with this flag).
  const saved = process.env.DF_RESEARCH_KEY_CONFIGURED;
  beforeAll(() => {
    process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.DF_RESEARCH_KEY_CONFIGURED;
    else process.env.DF_RESEARCH_KEY_CONFIGURED = saved;
  });

  it('lets a paid plan run one full pass, then refuses what would exceed the allowance', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionOrganization, provisionTenant, organizations, tenants, researchRuns } =
      await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'Gate Town' });
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'Gate Town', organizationId: org.id });
    await givePlan(org.id, { researchSessions: 30 });

    // A plan of 30 sessions this period. A full pass is 22.
    const full = await createPlannedRun({ tenantId: tenant.id });
    expect(full.sessionCount).toBe(22);
    await applyRun(tenant.id, full.run.id);

    const again = await createPlannedRun({ tenantId: tenant.id });
    await expect(applyRun(tenant.id, again.run.id)).rejects.toThrow(/needs 22 research sessions; 8 of 30 remain/);
    // Refused runs stay plannable later — nothing was reserved.
    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, again.run.id));
    expect(row!.appliedAt).toBeNull();

    // Applying the same run twice is refused.
    await expect(applyRun(tenant.id, full.run.id)).rejects.toThrow(/already applied/);

    await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  });

  it('refuses research for an organization without a plan', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionOrganization, provisionTenant, organizations, tenants, researchRuns } =
      await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'No Plan' });
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'No Plan', organizationId: org.id });
    const planned = await createPlannedRun({ tenantId: tenant.id });
    await expect(applyRun(tenant.id, planned.run.id)).rejects.toThrow(/^Choose a plan to build your doughnut/);
    await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  });

  it('undoes an apply whose enqueue failed, unless the worker has already claimed the run', async () => {
    const { createPlannedRun, applyRun } = await import('./research');
    const { getDb, provisionOrganization, provisionTenant, organizations, tenants, researchRuns } =
      await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const org = await provisionOrganization(db, { slug: uniq(), name: 'Queue Town' });
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'Queue Town', organizationId: org.id });
    await givePlan(org.id, { researchSessions: 100 });
    try {
      // The queue did not answer: applied_at is cleared, so the run counts nowhere (and the worker, finding it
      // unapplied, would skip a job that did get written).
      const lost = await createPlannedRun({ tenantId: tenant.id });
      queue.enqueue.mockImplementationOnce(async () => {
        throw new Error('connection reset');
      });
      await expect(applyRun(tenant.id, lost.run.id)).rejects.toThrow(/connection reset/);
      const [cleared] = await db.select().from(researchRuns).where(eq(researchRuns.id, lost.run.id));
      expect(cleared).toMatchObject({ status: 'planned', appliedAt: null });

      // The job was written and the worker claimed the run before the reply was lost: the run is running on
      // the plan, so it must stay applied — and counted.
      const claimed = await createPlannedRun({ tenantId: tenant.id });
      queue.enqueue.mockImplementationOnce(async (runId: string) => {
        await db.update(researchRuns).set({ status: 'running' }).where(eq(researchRuns.id, runId));
        throw new Error('connection reset');
      });
      await expect(applyRun(tenant.id, claimed.run.id)).rejects.toThrow(/connection reset/);
      const [kept] = await db.select().from(researchRuns).where(eq(researchRuns.id, claimed.run.id));
      expect(kept!.status).toBe('running');
      expect(kept!.appliedAt).not.toBeNull();
    } finally {
      await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });
});

describe.skipIf(!hasDb)('createPlannedRun', () => {
  it('plans exactly the edited indicator list even with a framework reference', async () => {
    const m=await import('@deep-fryer/db'); const {eq}=await import('drizzle-orm');const db=m.getDb();
    const {tenant,dimensions}=await m.provisionTenant(db,{slug:uniq(),name:'Locally adapted framework'});
    const dimension=dimensions.find(d=>d.slug==='housing')!;
    try {
      const original=await m.latestVersion(db,dimension.dimensionId);
      const data={name:'Local housing measures',icon:'',description:'',context:'',actions:[],...original?.data,
        indicators:[{name:'Locally defined count',unit:'households',value:null,year:null,target:null,source:'',source_url:'',confidence:'low' as const,geographic_scale:'city' as const}]};
      await m.appendDimensionVersion(db,{dimensionId:dimension.dimensionId,status:'draft',origin:'human',changeNote:'Use locally defined measures.',data,vizLevel:null});
      const planned=await (await import('./research')).createPlannedRun({tenantId:tenant.id,dimensionIds:[dimension.dimensionId]});
      const sessions=planned.run.plan.sessions.filter(s=>s.kind==='dimension');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.prompt).toContain('Locally defined count');
      expect(sessions[0]!.prompt).not.toContain('Rent-burdened renter households');
      await m.appendDimensionVersion(db,{dimensionId:dimension.dimensionId,status:'draft',origin:'human',changeNote:'Remove all unsupported measures.',data:{...data,indicators:[]},vizLevel:null});
      const empty=await (await import('./research')).createPlannedRun({tenantId:tenant.id,dimensionIds:[dimension.dimensionId]});
      expect(empty.run.plan.sessions.map(s=>s.prompt).join('\n')).not.toContain('Rent-burdened renter households');
    } finally {
      await db.delete(m.tenants).where(eq(m.tenants.id,tenant.id));await db.delete(m.organizations).where(eq(m.organizations.id,tenant.organizationId));
    }
  });

  it('plans a run on its own transaction, reading the portrait config there too', async () => {
    // Planning used to read the config through tenantConfigMap — a second
    // userDb transaction on another pooled connection, while its own held
    // one: on a one-connection pool a single request waited forever
    // (test/one-connection.ts).
    const { getDb, provisionTenant, organizations, tenants, researchRuns } = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = getDb();
    const { tenant } = await provisionTenant(db, { slug: uniq(), name: 'One Connection' });
    try {
      const planned = await onOneConnection(async () => (await import('./research')).createPlannedRun({ tenantId: tenant.id }));
      expect(planned.sessionCount).toBe(22);
      expect(planned.run.configSnapshot).toMatchObject({ region: expect.anything(), threshold_overrides: {} });
    } finally {
      await db.delete(researchRuns).where(eq(researchRuns.tenantId, tenant.id));
      await db.delete(tenants).where(eq(tenants.id, tenant.id));
      await db.delete(organizations).where(eq(organizations.id, tenant.organizationId));
    }
  });
});
