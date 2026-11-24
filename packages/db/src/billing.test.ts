import { describe, expect, it } from 'vitest';
import { standing, standingMessage } from '@deep-fryer/core';
import { withPostgresError } from './errors.js';
import { FIRST_DOUGHNUT_ADD_KEY_MESSAGE, PAID_FIRST_DOUGHNUT, decideResearchSpend } from './billing.js';
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

// The deployment's first-doughnut choice (DF_FIRST_DOUGHNUT). `paid`, the default, is every test above.
describe('decideResearchSpend with the first-doughnut choice', () => {
  const own = (firstFullBuild: boolean) => ({ choice: 'own' as const, firstFullBuild });

  it('under paid, refuses a first full build without a plan exactly as without the choice', () => {
    for (const hasKey of [false, true]) {
      const paidChoice = decideResearchSpend(null, 0, hasKey, 22, now, { choice: 'paid', firstFullBuild: true });
      expect(paidChoice).toEqual(decideResearchSpend(null, 0, hasKey, 22, now));
      expect(paidChoice.check.message).toMatch(/^Choose a plan to build your doughnut/);
    }
  });

  it('under own, lets an organization with no plan build its first doughnut on its own key', () => {
    expect(decideResearchSpend(null, 0, true, 22, now, own(true))).toEqual({
      funding: 'organization_key',
      check: { allowed: true, used: 0, limit: 0, remaining: 0, message: null },
    });
  });

  it('under own, tells an organization with no plan and no key how to get its first doughnut', () => {
    const { funding, check } = decideResearchSpend(null, 0, false, 22, now, own(true));
    expect(funding).toBe('plan');
    expect(check).toMatchObject({ allowed: false, limit: 0, remaining: 0 });
    expect(check.message).toBe(FIRST_DOUGHNUT_ADD_KEY_MESSAGE);
    expect(check.message).toMatch(/own Anthropic API key, with no plan/);
  });

  it('under own, refuses a second build, or anything but a full build, without a plan', () => {
    for (const hasKey of [false, true]) {
      expect(decideResearchSpend(null, 0, hasKey, 22, now, own(false)).check).toMatchObject({
        allowed: false,
        message: expect.stringMatching(/^Choose a plan to build your doughnut/),
      });
    }
  });

  it('under own, decides an organization in good standing, or one with a retired trial, as before', () => {
    const trial = paid({ plan: 'trial', status: 'trialing', trialEndsAt: new Date(now.getTime() + 25 * DAY) });
    for (const sub of [trial, paid(), paid({ researchSessionsOverride: 0 }), paid({ status: 'past_due' })]) {
      for (const hasKey of [false, true]) {
        expect(decideResearchSpend(sub, 0, hasKey, 22, now, own(true))).toEqual(decideResearchSpend(sub, 0, hasKey, 22, now));
      }
    }
    expect(decideResearchSpend(trial, 0, true, 22, now, own(true)).check.allowed).toBe(false);
  });

  it('under own, lets an organization whose subscription has no standing build its first doughnut on its key', () => {
    const withoutStanding = {
      incomplete: paid({ status: 'incomplete' }),
      awaiting_payment: paid({ collection: 'invoice', firstInvoicePaidAt: null }),
      canceled: paid({ status: 'canceled' }),
      unpaid: paid({ status: 'unpaid' }),
      period_ended: paid({ collection: 'contract', currentPeriodEnd: new Date(now.getTime() - DAY) }),
    };
    for (const [reason, sub] of Object.entries(withoutStanding)) {
      expect(standing(sub, now)).toMatchObject({ active: false, reason });
      expect(decideResearchSpend(sub, 0, true, 22, now, own(true))).toEqual({
        funding: 'organization_key',
        check: { allowed: true, used: 0, limit: 0, remaining: 0, message: null },
      });
      // Without a key: why the plan does not count, then that the key route is open.
      const noKey = decideResearchSpend(sub, 0, false, 22, now, own(true));
      expect(noKey.check.allowed).toBe(false);
      expect(noKey.check.message).toBe(
        `${standingMessage(standing(sub, now).reason)} Your first doughnut can also be built on your organization’s own Anthropic API key, with no plan: an organization owner adds the key under Billing.`,
      );
      // Anything but a first full build is decided as before.
      for (const hasKey of [false, true]) {
        expect(decideResearchSpend(sub, 0, hasKey, 22, now, own(false))).toEqual(decideResearchSpend(sub, 0, hasKey, 22, now));
      }
    }
  });

  it('weights plan-funded quota checks by strategy (standard 1x, hybrid 1.5x, deep 3x) to prevent quota arbitrage (P2.2)', () => {
    const sub = paid({ researchSessionsOverride: 30 });
    // Standard 22-session run needs 22 credits -> fits in 30.
    expect(decideResearchSpend(sub, 0, false, 22, now, PAID_FIRST_DOUGHNUT, 'standard').check.allowed).toBe(true);
    // Hybrid 22-session run needs ceil(22 * 1.5) = 33 credits -> refused on a 30-credit plan!
    const hybrid = decideResearchSpend(sub, 0, false, 22, now, PAID_FIRST_DOUGHNUT, 'hybrid');
    expect(hybrid.funding).toBe('plan');
    expect(hybrid.check.allowed).toBe(false);
    // Deep 22-session run needs ceil(22 * 3) = 66 credits -> refused on a 30-credit plan!
    const deep = decideResearchSpend(sub, 0, false, 22, now, PAID_FIRST_DOUGHNUT, 'deep');
    expect(deep.funding).toBe('plan');
    expect(deep.check.allowed).toBe(false);
    // On an organization's own key, plan quota is waived for all strategies.
    expect(decideResearchSpend(sub, 0, true, 22, now, PAID_FIRST_DOUGHNUT, 'deep').check.allowed).toBe(true);
    // A 66-credit plan allows a 22-session deep run.
    const larger = paid({ researchSessionsOverride: 66 });
    expect(decideResearchSpend(larger, 0, false, 22, now, PAID_FIRST_DOUGHNUT, 'deep').check.allowed).toBe(true);
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

  describe('the first-doughnut choice at the gate', () => {
    /** The plan "Build my doughnut" makes for this portrait: the region overview and one session per dimension. */
    async function fullPlan(m: typeof import('./index.js'), db: import('./client.js').DbExecutor, tenantId: string) {
      const { eq } = await import('drizzle-orm');
      const dims = await db.select({ slug: m.dimensions.slug }).from(m.dimensions).where(eq(m.dimensions.tenantId, tenantId));
      const session = { prompt: '', tool_allowlist: [], output_schema_ref: '', config_hash: '' };
      return {
        sessions: [
          { kind: 'region_context' as const, ...session },
          ...dims.map((d) => ({ kind: 'dimension' as const, dimension_slug: d.slug, ...session })),
        ],
        config_hash: 'h',
        plugin_version: 'v',
      };
    }

    it('without a choice or under paid, refuses a new organization’s first build with today’s message, key or not', async () => {
      const { m, db, tenant, cleanup } = await portrait();
      try {
        const plan = await fullPlan(m, db, tenant.id);
        for (const withKey of [false, true]) {
          if (withKey) {
            await m.upsertOrganizationApiKey(db, {
              organizationId: tenant.organizationId, ciphertext: 'v1:stand-in:ciphertext', keyHint: 'Ab12', createdBy: null,
              validatedAt: new Date(),
            });
          }
          for (const options of [undefined, { firstDoughnut: 'paid' as const, run: { tenantId: tenant.id, plan } }]) {
            const gate = await db.transaction((tx) =>
              m.gateResearchSpend(tx, tenant.organizationId, plan.sessions.length, new Date(), options),
            );
            expect(gate.check).toMatchObject({ allowed: false, message: expect.stringMatching(/^Choose a plan to build your doughnut/) });
          }
        }
      } finally {
        await cleanup();
      }
    });

    it('under own, applies one first full build on the organization’s key with no plan, and refuses the second', async () => {
      const { m, db, eq, tenant, cleanup } = await portrait();
      const second = await m.provisionTenant(db, { slug: uniq(), name: 'Funding Town East', organizationId: tenant.organizationId });
      try {
        const plan = await fullPlan(m, db, tenant.id);
        const own = (tenantId: string, p: typeof plan) => ({ firstDoughnut: 'own' as const, run: { tenantId, plan: p } });
        const gate = (options: ReturnType<typeof own>) =>
          db.transaction((tx) => m.gateResearchSpend(tx, tenant.organizationId, options.run.plan.sessions.length, new Date(), options));

        // No key yet: told how to get the first doughnut.
        expect((await gate(own(tenant.id, plan))).check).toMatchObject({ allowed: false, message: m.FIRST_DOUGHNUT_ADD_KEY_MESSAGE });

        await m.upsertOrganizationApiKey(db, {
          organizationId: tenant.organizationId, ciphertext: 'v1:stand-in:ciphertext', keyHint: 'Ab12', createdBy: null,
          validatedAt: new Date(),
        });
        // A run over some dimensions is not a full build, and one without the region overview is not either.
        const someDimensions = { ...plan, sessions: plan.sessions.slice(0, 4) };
        const noOverview = { ...plan, sessions: plan.sessions.slice(1) };
        for (const p of [someDimensions, noOverview]) {
          expect((await gate(own(tenant.id, p))).check.allowed).toBe(false);
        }
        // A full build is let through, on the organization's key.
        const first = await gate(own(tenant.id, plan));
        expect(first).toMatchObject({ subscription: null, funding: 'organization_key', check: { allowed: true, message: null } });

        // Applied, as applyRun records it…
        await db.insert(m.researchRuns).values({
          tenantId: tenant.id, status: 'planned', plan, configSnapshot: {} as never, appliedAt: new Date(), funding: first.funding,
        });
        // …the second build is refused, on this portrait or another of the organization's.
        const secondPlan = await fullPlan(m, db, second.tenant.id);
        for (const options of [own(tenant.id, plan), own(second.tenant.id, secondPlan)]) {
          expect((await gate(options)).check).toMatchObject({
            allowed: false,
            message: expect.stringMatching(/^Choose a plan to build your doughnut/),
          });
        }
      } finally {
        await db.delete(m.tenants).where(eq(m.tenants.id, second.tenant.id));
        await cleanup();
      }
    });

    it('under own, lets a group whose checkout did not finish, or whose invoice is unpaid, build its first doughnut on its key', async () => {
      const rows = {
        incomplete: { status: 'incomplete' as const, collection: 'card' as const },
        awaiting_payment: { status: 'active' as const, collection: 'invoice' as const },
      };
      for (const [reason, row] of Object.entries(rows)) {
        const { m, db, tenant, cleanup } = await portrait();
        try {
          const now = Date.now();
          await db.insert(m.subscriptions).values({
            organizationId: tenant.organizationId, plan: 'community', ...row,
            currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY),
          });
          const plan = await fullPlan(m, db, tenant.id);
          const options = { firstDoughnut: 'own' as const, run: { tenantId: tenant.id, plan } };
          const gate = () =>
            db.transaction((tx) => m.gateResearchSpend(tx, tenant.organizationId, plan.sessions.length, new Date(), options));

          // No key: the plan's own reason first, then the key route.
          const noKey = await gate();
          expect(noKey.subscription?.status).toBe(row.status);
          expect(noKey.check.allowed).toBe(false);
          expect(noKey.check.message).toBe(
            `${standingMessage(standing(noKey.subscription).reason)} Your first doughnut can also be built on your organization’s own Anthropic API key, with no plan: an organization owner adds the key under Billing.`,
          );

          await m.upsertOrganizationApiKey(db, {
            organizationId: tenant.organizationId, ciphertext: 'v1:stand-in:ciphertext', keyHint: 'Ab12', createdBy: null,
            validatedAt: new Date(),
          });
          // Under paid, the first build is refused; under own, it goes through on the key.
          const paidGate = await db.transaction((tx) =>
            m.gateResearchSpend(tx, tenant.organizationId, plan.sessions.length, new Date(), { ...options, firstDoughnut: 'paid' }),
          );
          expect(paidGate.check.allowed).toBe(false);
          const first = await gate();
          expect({ reason, funding: first.funding, allowed: first.check.allowed }).toEqual({
            reason, funding: 'organization_key', allowed: true,
          });
          await db.insert(m.researchRuns).values({
            tenantId: tenant.id, status: 'planned', plan, configSnapshot: {} as never, appliedAt: new Date(), funding: first.funding,
          });
          // The second needs the plan to stand: refused with the plan's own reason, as under paid.
          const second = await gate();
          expect(second.check).toMatchObject({ allowed: false, message: standingMessage(standing(second.subscription).reason) });
        } finally {
          await cleanup();
        }
      }
    });

    it('under own, lets only one of two first builds started at once through', async () => {
      const { m, db, eq, tenant, cleanup } = await portrait();
      const second = await m.provisionTenant(db, { slug: uniq(), name: 'Funding Town West', organizationId: tenant.organizationId });
      try {
        await m.upsertOrganizationApiKey(db, {
          organizationId: tenant.organizationId, ciphertext: 'v1:stand-in:ciphertext', keyHint: 'Ab12', createdBy: null,
          validatedAt: new Date(),
        });
        /** What applyRun does inside its transaction: ask the gate, then record the applied run when it says yes. */
        const apply = (tenantId: string, plan: Awaited<ReturnType<typeof fullPlan>>, hold: Promise<void>) =>
          db.transaction(async (tx) => {
            const g = await m.gateResearchSpend(tx, tenant.organizationId, plan.sessions.length, new Date(), {
              firstDoughnut: 'own', run: { tenantId, plan },
            });
            if (g.check.allowed) {
              await tx.insert(m.researchRuns).values({
                tenantId, status: 'planned', plan, configSnapshot: {} as never, appliedAt: new Date(), funding: g.funding,
              });
            }
            await hold;
            return g.check.allowed;
          });
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const firstApply = apply(tenant.id, await fullPlan(m, db, tenant.id), held);
        // Give the first a moment to take the lock, then start the second while the first is still open.
        await new Promise((r) => setTimeout(r, 200));
        const secondApply = apply(second.tenant.id, await fullPlan(m, db, second.tenant.id), Promise.resolve());
        await new Promise((r) => setTimeout(r, 200));
        release();
        expect(await Promise.all([firstApply, secondApply])).toEqual([true, false]);
      } finally {
        await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, second.tenant.id));
        await db.delete(m.tenants).where(eq(m.tenants.id, second.tenant.id));
        await cleanup();
      }
    });
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
        withPostgresError(asEditor((tx) => tx.insert(m.researchRuns).values({ ...values, funding: 'organization_key' }))),
      ).rejects.toThrow(/decided by the research gate/);
      // The system context (the gate, in applyRun) records the decision…
      const thisRun = eq(m.researchRuns.id, planned!.id);
      await db.update(m.researchRuns).set({ funding: 'organization_key', appliedAt: new Date() }).where(thisRun);
      // …and a request in a person's context cannot touch an applied run at all (migration 0013): not its
      // funding, not its applied_at (which places it in a billing period), not its plan (the sessions the gate
      // counted), and it cannot delete it or give it another id or portrait to plan a run in its place.
      const denied = /permission denied for table research_runs/;
      for (const set of [{ funding: 'plan' as const }, { appliedAt: new Date(0) }, { plan: plan(9) }, { id: crypto.randomUUID() }]) {
        await expect(withPostgresError(asEditor((tx) => tx.update(m.researchRuns).set(set).where(thisRun)))).rejects.toThrow(denied);
      }
      await expect(withPostgresError(asEditor((tx) => tx.delete(m.researchRuns).where(thisRun)))).rejects.toThrow(denied);
      // The app only ever inserts a planned run, and that is all it may insert: not one already applied,
      // running, or completed (which would count, or look finished, without passing the gate).
      for (const extra of [
        { appliedAt: new Date() },
        { status: 'running' as const },
        { status: 'complete' as const, completedAt: new Date() },
      ]) {
        await expect(withPostgresError(asEditor((tx) => tx.insert(m.researchRuns).values({ ...values, ...extra })))).rejects.toThrow(
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
