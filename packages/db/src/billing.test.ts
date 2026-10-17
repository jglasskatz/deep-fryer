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

/** A paid card plan in good standing with a 30-session allowance this period (a contract override). */
function paid(overrides: Partial<Subscription> = {}): Subscription {
  return {
    organizationId: '00000000-0000-4000-8000-000000000001',
    plan: 'community',
    status: 'active',
    collection: 'card',
    currentPeriodStart: new Date(now.getTime() - 5 * DAY),
    currentPeriodEnd: new Date(now.getTime() + 25 * DAY),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    firstInvoicePaidAt: null,
    researchSessionsOverride: 30,
    portraitsOverride: null,
    seatsOverride: null,
    ...overrides,
  } as Subscription;
}

describe('decideResearchSpend', () => {
  it('checks the allowance when there is no key', () => {
    expect(decideResearchSpend(paid(), 0, false, 22, now)).toMatchObject({ funding: 'plan', check: { allowed: true } });
    const over = decideResearchSpend(paid(), 22, false, 22, now);
    expect(over.funding).toBe('plan');
    expect(over.check).toMatchObject({ allowed: false, remaining: 8 });
    expect(over.check.message).toMatch(/needs 22 research sessions; 8 of 30 remain/);
  });

  it('waives the allowance with a key on file, and reports the count as information', () => {
    const spent = decideResearchSpend(paid(), 30, true, 22, now);
    expect(spent).toEqual({
      funding: 'organization_key',
      check: { allowed: true, used: 30, limit: 30, remaining: 0, message: null },
    });
    // However large the run.
    expect(decideResearchSpend(paid({ researchSessionsOverride: 0 }), 0, true, 500, now).check.allowed).toBe(true);
  });

  it('refuses an organization without a plan — every one /start creates — whoever would pay', () => {
    for (const hasKey of [false, true]) {
      const { funding, check } = decideResearchSpend(null, 0, hasKey, 22, now);
      expect(funding).toBe(hasKey ? 'organization_key' : 'plan');
      expect(check).toMatchObject({ allowed: false, limit: 0, remaining: 0 });
      expect(check.message).toMatch(/^Choose a plan to build your doughnut/);
    }
  });

  it('still requires good standing with a key on file', () => {
    expect(decideResearchSpend(null, 0, true, 1, now)).toMatchObject({
      funding: 'organization_key',
      check: { allowed: false, message: expect.stringMatching(/Choose a plan/) },
    });
    expect(decideResearchSpend(paid({ status: 'canceled' }), 0, true, 1, now).check).toMatchObject({
      allowed: false,
      message: expect.stringMatching(/canceled/),
    });
  });

  it('refuses a trial started before trials were retired, mid-trial, whoever would pay', () => {
    // Five days into its 30 days: it was once promised 30 sessions, enough for a 22-session build.
    const trial = paid({
      plan: 'trial',
      status: 'trialing',
      trialEndsAt: new Date(now.getTime() + 25 * DAY),
      researchSessionsOverride: null,
    });
    for (const hasKey of [false, true]) {
      expect(decideResearchSpend(trial, 0, hasKey, 22, now).check).toMatchObject({
        allowed: false,
        limit: 0,
        message: expect.stringMatching(/evaluation period has ended/),
      });
    }
  });

  it('refuses a fresh invoice subscription whose first invoice is still open, whoever would pay', () => {
    // What "Request an annual invoice" writes for Metro on day 0: Stripe calls a send_invoice subscription active.
    const requested = paid({
      plan: 'metro',
      collection: 'invoice',
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 365 * DAY),
      researchSessionsOverride: null,
      firstInvoicePaidAt: null,
    });
    for (const hasKey of [false, true]) {
      expect(decideResearchSpend(requested, 0, hasKey, 22, now).check).toMatchObject({
        allowed: false,
        message: expect.stringMatching(/^Research starts once the first invoice is paid/),
      });
    }
    // Once it is paid, the plan's allowance.
    expect(decideResearchSpend({ ...requested, firstInvoicePaidAt: now }, 0, false, 22, now).check).toMatchObject({
      allowed: true,
      limit: 600,
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
      type Funding = 'plan' | 'organization_key';
      const run = async (status: 'planned' | 'running' | 'complete', sessions: number, funding: Funding) => {
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
      const analysis = (status: 'queued' | 'complete' | 'failed', funding: Funding) => ({
        tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.', status,
        funding,
      });
      await db.insert(m.policyAnalyses).values([
        analysis('queued', 'plan'),
        analysis('failed', 'plan'),
        analysis('complete', 'organization_key'),
        analysis('queued', 'organization_key'),
      ]);

      const since = new Date(now.getTime() - 60_000);
      expect(await m.researchSessionsUsed(db, tenant.organizationId, since)).toBe(5 + 2 + 2 + 1);
      expect(await m.researchSessionsOnOrganizationKey(db, tenant.organizationId, since)).toBe(7 + 4 + 2);

      // Removing the key changes neither number: what ran on it was never the plan's.
      expect(await m.deleteOrganizationApiKey(db, tenant.organizationId)).toBe('Ab12');
      expect(await m.researchSessionsUsed(db, tenant.organizationId, since)).toBe(10);
      expect(await m.researchSessionsOnOrganizationKey(db, tenant.organizationId, since)).toBe(13);
      // Nothing before the period's start counts.
      expect(await m.researchSessionsUsed(db, tenant.organizationId, new Date(now.getTime() + 60_000))).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('charges spends made after a stale period end to that period, so the allowance still runs down', async () => {
    const { m, db, tenant, cleanup } = await portrait();
    try {
      // A card plan of 30 sessions whose period ended yesterday: its renewal has not reached us yet (core
      // standing keeps it active within STRIPE_SYNC_GRACE_MS). A full build applied today, after that end…
      const now = Date.now();
      await db.insert(m.subscriptions).values({
        organizationId: tenant.organizationId, plan: 'community', status: 'active', collection: 'card',
        currentPeriodStart: new Date(now - 31 * DAY), currentPeriodEnd: new Date(now - DAY), researchSessionsOverride: 30,
      });
      await db.insert(m.researchRuns).values({
        tenantId: tenant.id, status: 'planned', plan: plan(22), configSnapshot: {} as never, appliedAt: new Date(now), funding: 'plan',
      });
      // …counts, so a second one does not fit: it used to fall outside [start, end) and leave the allowance untouched.
      const gate = await db.transaction((tx) => m.gateResearchSpend(tx, tenant.organizationId, 22));
      expect(gate.check).toMatchObject({ allowed: false, used: 22, remaining: 8 });
    } finally {
      await cleanup();
    }
  });

  it('keeps funding, and applied runs, out of the app role\'s reach, and lets editors read funding on analyses', async () => {
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
      // The system context (the gate, in applyRun) records the decision…
      const thisRun = eq(m.researchRuns.id, planned!.id);
      await db.update(m.researchRuns).set({ funding: 'organization_key', appliedAt: new Date() }).where(thisRun);
      // …and a request in a person's context cannot touch an applied run at all (migration 0013): not its
      // funding, not its applied_at (which places it in a billing period), not its plan (the sessions the gate
      // counted), and it cannot delete it or give it another id or portrait to plan a run in its place.
      const denied = /permission denied for table research_runs/;
      for (const set of [{ funding: 'plan' as const }, { appliedAt: new Date(0) }, { plan: plan(9) }, { id: crypto.randomUUID() }]) {
        await expect(asEditor((tx) => tx.update(m.researchRuns).set(set).where(thisRun))).rejects.toThrow(denied);
      }
      await expect(asEditor((tx) => tx.delete(m.researchRuns).where(thisRun))).rejects.toThrow(denied);
      // The app only ever inserts a planned run, and that is all it may insert: not one already applied,
      // running, or completed (which would count, or look finished, without passing the gate).
      for (const extra of [
        { appliedAt: new Date() },
        { status: 'running' as const },
        { status: 'complete' as const, completedAt: new Date() },
      ]) {
        await expect(asEditor((tx) => tx.insert(m.researchRuns).values({ ...values, ...extra }))).rejects.toThrow(
          /row-level security/,
        );
      }
      const [after] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, planned!.id));
      expect(after).toMatchObject({ funding: 'organization_key', tenantId: tenant.id });
      expect(after!.plan.sessions).toHaveLength(1);

      // Analyses are written in the system context only; editors read who paid.
      await db.insert(m.policyAnalyses).values({
        tenantId: tenant.id, title: 'Cooling centers', brief: 'Open a cooling center in every district.',
        funding: 'organization_key',
      });
      const readByEditor = await asEditor((tx) =>
        tx
          .select({ funding: m.policyAnalyses.funding })
          .from(m.policyAnalyses)
          .where(eq(m.policyAnalyses.tenantId, tenant.id)),
      );
      expect(readByEditor).toEqual([{ funding: 'organization_key' }]);
    } finally {
      await cleanup();
      await db.delete(m.users).where(eq(m.users.id, editor!.id));
    }
  });
});
