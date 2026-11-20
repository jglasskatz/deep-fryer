import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import type { ResearchStrategy } from '@deep-fryer/core';
import {
  dimensions,
  gateResearchSpend,
  latestVersion,
  organizationForTenant,
  researchRuns,
  type DbExecutor,
  type ResearchFunding,
  type RunExecution,
} from '@deep-fryer/db';
import {
  enqueueResearchApply,
  renderPlan,
  type PlanDimensionSpec,
} from '@deep-fryer/research';
import { portraitConfigFromMap, tenantConfigMapIn } from './admin-data';
import { UserError } from './action-result';
import { assertFundingUsable, firstDoughnutSetting } from './billing';
import { systemDb, userDb } from './db';
import { alreadyAppliedMessage } from './run-progress';

/**
 * Plan (SPEC.md §8): render the full session list — prompts, tool
 * allowlists, config hash — without spending tokens, and store it on the
 * run row for inspection before apply.
 */
export interface PlannedRunInput {
  tenantId: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
  requestedBy?: string | null;
  /** The newest version of this strategy is recorded on the plan; omitted, operator-defaults. */
  strategy?: ResearchStrategy;
}

export async function createPlannedRun(input: PlannedRunInput) {
  return userDb((db) => createPlannedRunIn(db, input));
}

/** Plan atomically with a review decision on its already-authorized transaction. */
export async function createPlannedRunIn(db: DbExecutor, input: PlannedRunInput) {
    // On this transaction, not through tenantConfigMap's own: that would wait
    // for a second pooled connection while this one is held (lib/admin-data.ts).
    const configMap = await tenantConfigMapIn(db, input.tenantId);
    const config = portraitConfigFromMap(configMap);
    if (!config) {
      throw new UserError(
        'Portrait config is incomplete (region, source priority, recency, and scale policy are required) — fill it in under Settings.',
      );
    }

    const where = [eq(dimensions.tenantId, input.tenantId), isNull(dimensions.archivedAt)];
    if (input.dimensionIds?.length) {
      where.push(inArray(dimensions.id, input.dimensionIds));
    }
    const dims = await db
      .select()
      .from(dimensions)
      .where(and(...where))
      .orderBy(dimensions.displayOrder);
    if (dims.length === 0) throw new UserError('Select at least one dimension.');

    const specs: PlanDimensionSpec[] = [];
    for (const dim of dims) {
      const frameworkDim = frameworkDimension(dim.slug, dim.canonicalSlug);
      const latest = await latestVersion(db, dim.id);
      const name = latest?.data.name ?? frameworkDim?.name ?? dim.slug;
      // The editor's actual list is authoritative, including removal of all
      // indicators. A framework reference supplies thresholds, not a hidden
      // replacement list. Unversioned seeded dimensions alone use defaults.
      const indicators = latest
        ? latest.data.indicators.map(ind => ({
            slug: ind.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            name: ind.name,
            unit: ind.unit,
            threshold_ref: ind.scoring?.threshold_ref ??
              frameworkDim?.indicators.find(fi => fi.name === ind.name)?.threshold_ref ?? '',
          }))
        : frameworkDim?.indicators ?? [];

      specs.push({
        dimensionId: dim.id,
        slug: dim.slug,
        ring: dim.ring,
        name,
        indicators,
        reviewerNotes: input.reviewerNotes?.[dim.id],
      });
    }

    // With no strategy chosen, the plan records operator-defaults with this
    // server's model settings as they are now; a chosen strategy ignores them.
    const plan = renderPlan({ config, dimensions: specs, strategy: input.strategy, modelDefaults: {
      session_model: process.env.ANTHROPIC_MODEL,
      subagent_model: process.env.RESEARCH_SUBAGENT_MODEL || null,
      verifier_model: process.env.VERIFIER_MODEL,
      page_reader_model: process.env.ANTHROPIC_SMALL_FAST_MODEL,
    } });

    const [run] = await db
      .insert(researchRuns)
      .values({
        tenantId: input.tenantId,
        status: 'planned',
        plan,
        configSnapshot: config,
        requestedBy: input.requestedBy ?? null,
      })
      .returning();
    if (!run) throw new Error('run insert failed');

    return { run, sessionCount: plan.sessions.length };
}

/** The model API's own host: where sessions go when nothing reroutes them. */
const FIRST_PARTY_HOST = 'api.anthropic.com';

function hostOf(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    return new URL(url.trim()).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Where a run applied with this funding will execute, recorded on the run
 * beside `funding`. Every session runs on the shared worker and calls one
 * provider. On the organization's own key the worker withholds any base URL
 * the deployment set (apps/worker session.ts sessionEnv), so the calls go to
 * the first-party host. On the plan they go wherever the worker's own
 * environment points the model client, which this process cannot see: the
 * host is recorded only when the deployment names one to this process too,
 * and is null otherwise. The host region is likewise whatever the deployment
 * states, or null. The record is written once and never updated, so unknown
 * is recorded as unknown, never guessed.
 */
export function runExecution(
  funding: ResearchFunding,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RunExecution {
  return {
    provider: 'anthropic',
    endpoint_host: funding === 'organization_key' ? FIRST_PARTY_HOST : hostOf(env.ANTHROPIC_BASE_URL),
    executor: 'shared_worker',
    host_region: env.DF_HOST_REGION?.trim() || null,
  };
}

/**
 * Apply: the moment research spend starts, so the billing gate lives here
 * (SPEC-v4 §3). In one transaction: lock the run and the organization's
 * subscription row, compute the period's usage, check the plan's quota, and
 * stamp applied_at — so two concurrent applies cannot both fit into a quota
 * that only holds one of them. The queue insert happens after commit; if it
 * fails, applied_at is cleared again so the reservation does not leak — but
 * only while the run is still planned. An enqueue can fail after the job was
 * in fact written (the reply lost); the worker then either finds applied_at
 * cleared and skips the run (apps/worker research-apply.ts claims only
 * applied runs), or has already claimed it, and then the clear changes
 * nothing, so a run that executes always counts against the allowance.
 *
 * The gate is packages/db gateResearchSpend, shared with policy analyses:
 * when the organization has its own Anthropic API key on file (SPEC-v7 §4)
 * the session allowance is not checked — the run will execute on that key —
 * but good standing still is. Its decision is stamped on the run as
 * `funding` in the same update as applied_at, so it is recorded exactly when
 * the run starts to count: the allowance counts only plan-funded runs, and
 * the worker runs every session on the key `funding` names, whatever key is
 * on file by the time the run starts (apps/worker research-apply.ts). The
 * same update records where the run executes (`execution`, runExecution),
 * which review, the run page and the cost export show beside each session's
 * model.
 *
 * Every path in the app that starts a run — the research page, "Build my
 * doughnut", a request for more research — comes through here. The returned
 * run carries `funding` for the caller's audit entry. If the enqueue fails,
 * only applied_at is cleared: an unapplied run counts nowhere, whatever its
 * funding says, and the next apply decides funding afresh.
 */
export async function applyRun(tenantId: string, runId: string) {
  // System context: the quota is organization-wide (runs on portraits this
  // person cannot see still count) and the subscription row is locked for
  // the check. Callers have already required the editor role.
  const db = systemDb();
  const run = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(researchRuns)
      .where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)))
      .for('update');
    if (!row) throw new UserError('Unknown run.');
    // A page opened before the run was applied still offers "Apply": say
    // where the run is in words (queued, running, finished), never the
    // database status — run-progress.ts alreadyAppliedMessage.
    if (row.status !== 'planned' || row.appliedAt) {
      throw new UserError(alreadyAppliedMessage(row));
    }

    const org = await organizationForTenant(tx, tenantId);
    if (!org) throw new Error(`tenant ${tenantId} has no organization`);
    // The run itself goes to the gate, so a deployment whose groups' own keys pay for a first doughnut can tell one.
    const gate = await gateResearchSpend(tx, org.id, row.plan.sessions.length, new Date(), {
      firstDoughnut: firstDoughnutSetting(),
      run: { tenantId, plan: row.plan },
    });
    if (!gate.check.allowed) throw new UserError(gate.check.message ?? 'Research is not available on this plan.');
    // On a key this server cannot read, every session would fail in the worker: refuse now, applying nothing.
    assertFundingUsable(gate.funding);

    const [applied] = await tx
      .update(researchRuns)
      .set({ appliedAt: new Date(), funding: gate.funding, execution: runExecution(gate.funding) })
      .where(eq(researchRuns.id, row.id))
      .returning();
    return applied!;
  });

  try {
    await enqueueResearchApply(run.id);
  } catch (err) {
    await db
      .update(researchRuns)
      .set({ appliedAt: null })
      .where(and(eq(researchRuns.id, run.id), eq(researchRuns.status, 'planned')));
    throw err;
  }
  return run;
}
