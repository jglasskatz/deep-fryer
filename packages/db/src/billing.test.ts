import { describe, expect, it } from 'vitest';
import { decideResearchSpend } from './billing.js';
import type { Subscription } from './schema.js';

/**
 * The research spend decision (SPEC-v7 §4), pure: an organization's own API
 * key waives the session allowance and nothing else. The locking wrapper,
 * gateResearchSpend, is exercised against Postgres through the actions that
 * use it (apps/web lib/research-actions.test.ts). The stored decision — the
 * `funding` column (migration 0012) and the counts that follow it — is
 * exercised against Postgres at the end of this file.
 */
const now = new Date('2026-10-16T12:00:00Z');
const DAY = 86_400_000;

function trial(overrides: Partial<Subscription> = {}): Subscription {
  return {
    organizationId: '00000000-0000-4000-8000-000000000001',
    plan: 'trial',
    status: 'trialing',
    collection: 'card',
    currentPeriodStart: new Date(now.getTime() - 5 * DAY),
    currentPeriodEnd: new Date(now.getTime() + 25 * DAY),
    trialEndsAt: new Date(now.getTime() + 25 * DAY),
    cancelAtPeriodEnd: false,
    researchSessionsOverride: null,
    portraitsOverride: null,
    seatsOverride: null,
    ...overrides,
  } as Subscription;
}

describe('decideResearchSpend', () => {
  it('checks the allowance when there is no key', () => {
    expect(decideResearchSpend(trial(), 0, false, 22, now)).toMatchObject({ funding: 'plan', check: { allowed: true } });
    const over = decideResearchSpend(trial(), 22, false, 22, now);
    expect(over.funding).toBe('plan');
    expect(over.check).toMatchObject({ allowed: false, remaining: 8 });
    expect(over.check.message).toMatch(/needs 22 research sessions; 8 of 30 remain/);
  });

  it('waives the allowance with a key on file, and reports the count as information', () => {
    const spent = decideResearchSpend(trial(), 30, true, 22, now);
    expect(spent).toEqual({
      funding: 'organization_key',
      check: { allowed: true, used: 30, limit: 30, remaining: 0, message: null },
    });
    // However large the run.
    expect(decideResearchSpend(trial({ researchSessionsOverride: 0 }), 0, true, 500, now).check.allowed).toBe(true);
  });

  it('still requires good standing with a key on file', () => {
    expect(decideResearchSpend(null, 0, true, 1, now)).toMatchObject({
      funding: 'organization_key',
      check: { allowed: false, message: expect.stringMatching(/no plan yet/) },
    });
    expect(decideResearchSpend(trial({ status: 'canceled' }), 0, true, 1, now).check).toMatchObject({
      allowed: false,
      message: expect.stringMatching(/canceled/),
    });
    const ended = trial({ trialEndsAt: new Date(now.getTime() - DAY), currentPeriodEnd: new Date(now.getTime() - DAY) });
    expect(decideResearchSpend(ended, 0, true, 1, now).check).toMatchObject({
      allowed: false,
      message: expect.stringMatching(/trial has ended/),
    });
  });
});

// ---- The stored decision (migration 0012), against Postgres -------------------

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('research funding as stored on runs and analyses (Postgres)', () => {
  /** A portrait in its own organization, removed again (runs first: their sessions) by `cleanup`. */
  async function portrait() {
    const m = await import('./index.js');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Funding Town' });
    const cleanup = async () => {
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, tenant.organizationId));
    };
    return { m, db, eq, tenant, cleanup };
  }

  const plan = (n: number) => ({
    sessions: Array.from({ length: n }, () => ({
      kind: 'dimension' as const, prompt: '', tool_allowlist: [], output_schema_ref: '', config_hash: '',
    })),
    config_hash: 'h',
    plugin_version: 'v',
  });

  it('counts only plan-funded sessions against the allowance, and the key-funded ones apart', async () => {
    const { m, db, tenant, cleanup } = await portrait();
    try {
      // A key on file (a stand-in ciphertext: nothing here decrypts it), removed below.
      await m.upsertOrganizationApiKey(db, {
        organizationId: tenant.organizationId, ciphertext: 'v1:stand-in:ciphertext', keyHint: 'Ab12', createdBy: null,
        validatedAt: new Date(),
      });
      const now = new Date();
      const run = async (status: 'planned' | 'running' | 'complete', sessions: number, funding: 'plan' | 'organization_key') => {
        const [row] = await db.insert(m.researchRuns).values({
          tenantId: tenant.id, status, plan: plan(sessions), configSnapshot: {} as never, appliedAt: now, funding,
        }).returning();
        return row!;
      };
      // Plan-funded: a queued run reserves its 5 sessions, a running one its 2,
      // and a finished one counts its 2 sessions that did not fail.
      await run('planned', 5, 'plan');
      await run('running', 2, 'plan');
      const done = await run('complete', 3, 'plan');
      await db.insert(m.researchSessions).values([
        { runId: done.id, kind: 'dimension', status: 'complete' },
        { runId: done.id, kind: 'dimension', status: 'complete' },
        { runId: done.id, kind: 'dimension', status: 'failed' },
      ]);
      // Key-funded, by the same rules: 7 reserved, 4 finished.
      await run('planned', 7, 'organization_key');
      const doneOnKey = await run('complete', 4, 'organization_key');
      await db.insert(m.researchSessions).values(
        Array.from({ length: 4 }, () => ({ runId: doneOnKey.id, kind: 'dimension' as const, status: 'complete' as const })),
      );
      // Analyses: one session each unless failed.
      const analysis = (status: 'queued' | 'complete' | 'failed', funding: 'plan' | 'organization_key') => ({
        tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.', status, funding,
      });
      await db.insert(m.policyAnalyses).values([
        analysis('queued', 'plan'),
        analysis('failed', 'plan'),
        analysis('complete', 'organization_key'),
        analysis('queued', 'organization_key'),
      ]);

      const since = new Date(now.getTime() - 60_000);
      const until = new Date(now.getTime() + 60_000);
      expect(await m.researchSessionsUsed(db, tenant.organizationId, since, until)).toBe(5 + 2 + 2 + 1);
      expect(await m.researchSessionsOnOrganizationKey(db, tenant.organizationId, since, until)).toBe(7 + 4 + 2);

      // Removing the key changes neither number: what ran on it was never the plan's.
      expect(await m.deleteOrganizationApiKey(db, tenant.organizationId)).toBe('Ab12');
      expect(await m.researchSessionsUsed(db, tenant.organizationId, since, until)).toBe(10);
      expect(await m.researchSessionsOnOrganizationKey(db, tenant.organizationId, since, until)).toBe(13);
    } finally {
      await cleanup();
    }
  });

  it('keeps funding out of the app role\'s reach on runs, and lets editors read it on analyses', async () => {
    const { m, db, eq, tenant, cleanup } = await portrait();
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@example.gov`, displayName: 'ed' }).returning();
    try {
      await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: editor!.id, role: 'editor' });
      const asEditor = <T>(fn: (tx: import('./client.js').DbExecutor) => Promise<T>) =>
        m.withAuthContext(db, editor!.id, fn);
      const values = { tenantId: tenant.id, plan: plan(1), configSnapshot: {} as never };

      // Planning a run as the person works, and the run is not funded by anything but the plan's default…
      const [planned] = await asEditor((tx) => tx.insert(m.researchRuns).values(values).returning());
      expect(planned!.funding).toBe('plan');
      // …but the app role can neither choose the funding nor change it later.
      await expect(
        asEditor((tx) => tx.insert(m.researchRuns).values({ ...values, funding: 'organization_key' })),
      ).rejects.toThrow(/decided by the research gate/);
      await db.update(m.researchRuns).set({ funding: 'organization_key', appliedAt: new Date() }).where(eq(m.researchRuns.id, planned!.id));
      await expect(
        asEditor((tx) => tx.update(m.researchRuns).set({ funding: 'plan' }).where(eq(m.researchRuns.id, planned!.id))),
      ).rejects.toThrow(/cannot be changed/);
      // Writing the same value is not a change (and other columns stay writable as before).
      await asEditor((tx) =>
        tx.update(m.researchRuns).set({ funding: 'organization_key', requestedBy: editor!.id }).where(eq(m.researchRuns.id, planned!.id)),
      );
      const [after] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, planned!.id));
      expect(after!.funding).toBe('organization_key');

      // Analyses are written in the system context only; editors read who paid.
      await db.insert(m.policyAnalyses).values({
        tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.', funding: 'organization_key',
      });
      expect(
        await asEditor((tx) =>
          tx.select({ funding: m.policyAnalyses.funding }).from(m.policyAnalyses).where(eq(m.policyAnalyses.tenantId, tenant.id)),
        ),
      ).toEqual([{ funding: 'organization_key' }]);
    } finally {
      await cleanup();
      await db.delete(m.users).where(eq(m.users.id, editor!.id));
    }
  });
});
