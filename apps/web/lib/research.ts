import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  PROVIDER_META,
  parseResearchProvider,
  providerForModel,
  type PortraitConfig,
  type RegionBriefCache,
  type ResearchPlan,
  type ResearchStrategy,
} from '@deep-fryer/core';
import {
  dimensions,
  gateResearchSpend,
  latestVersion,
  loadTenantReviewLabels,
  organizationForTenant,
  researchRuns,
  tenants,
  type DbExecutor,
  type ResearchFunding,
  type RunExecution,
} from '@deep-fryer/db';
import {
  buildHistoricalGuidance,
  computeConfigHash,
  enqueueResearchApply,
  isValidRegionBriefCache,
  renderPlan,
  type PlanDimensionSpec,
  type ReviewLabelEvalRow,
} from '@deep-fryer/research';
import { portraitConfigFromMap, tenantConfigMapIn } from './admin-data';
import { UserError } from './action-result';
import { assertFundingUsable, firstDoughnutSetting } from './billing';
import { systemDb, userDb } from './db';
import { plannedIndicatorsForDimension } from './planned-indicators';
import { alreadyAppliedMessage } from './run-progress';

export { plannedIndicatorsForDimension };

/**
 * Pure: return a portrait's cached Phase-0 region brief when planning a
 * targeted re-run (`dimensionIds?.length > 0`) and the cache entry matches the
 * current config hash and is <30 days old; otherwise return undefined so a
 * fresh Phase-0 session is planned.
 */
export function resolveCachedRegionBrief(
  cache: RegionBriefCache | null | undefined,
  config: PortraitConfig,
  isTargetedRerun: boolean,
  now: Date = new Date(),
): string | undefined {
  if (!isTargetedRerun) return undefined;
  const configHash = computeConfigHash(config);
  return isValidRegionBriefCache(cache, configHash, now) ? cache.brief : undefined;
}

/**
 * Pure: combine any explicit reviewer note for a dimension with sanitized,
 * bounded historical guidance built from prior human defect `review_labels`
 * so future runs learn from past rejections without dropping explicit notes.
 */
export function mergeReviewerNotesWithHistoricalGuidance(
  explicitNote: string | undefined,
  labels: readonly ReviewLabelEvalRow[],
  dimensionSlug: string,
): string | undefined {
  const trimmed = explicitNote?.trim() ?? '';
  const guidance = buildHistoricalGuidance(labels, dimensionSlug);
  if (!guidance) return trimmed || undefined;
  return trimmed ? `${trimmed}\n\n${guidance}` : guidance;
}

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

    // Load recent tenant review_labels on the same executor (single connection,
    // RLS-scoped) so each planned dimension benefits from sanitized historical
    // rejection guidance without opening a nested pooled connection.
    const recentLabels = await loadTenantReviewLabels(db, input.tenantId);

    const specs: PlanDimensionSpec[] = [];
    for (const dim of dims) {
      const frameworkDim = frameworkDimension(dim.slug, dim.canonicalSlug);
      const latest = await latestVersion(db, dim.id);
      const name = latest?.data.name ?? frameworkDim?.name ?? dim.slug;
      // Shared helper preserves ind.key (never mangling framework slugs from
      // display names) and re-includes indicators recorded in latest.data.gaps
      // so approved gaps are never erased on subsequent runs.
      const indicators = plannedIndicatorsForDimension(latest, frameworkDim);

      specs.push({
        dimensionId: dim.id,
        slug: dim.slug,
        ring: dim.ring,
        name,
        indicators,
        reviewerNotes: mergeReviewerNotesWithHistoricalGuidance(
          input.reviewerNotes?.[dim.id],
          recentLabels,
          dim.slug,
        ),
      });
    }

    // On targeted re-runs, reuse the portrait's cached Phase-0 region brief
    // when config_hash matches and cached_at is <30 days old, omitting the
    // redundant Phase-0 session.
    const isTargetedRerun = Boolean(input.dimensionIds?.length);
    let cachedRegionBrief: string | undefined;
    if (isTargetedRerun) {
      const [tenantRow] = await db
        .select({ regionBriefCache: tenants.regionBriefCache })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId));
      cachedRegionBrief = resolveCachedRegionBrief(tenantRow?.regionBriefCache, config, true);
    }

    // With no strategy chosen, the plan records operator-defaults with this
    // server's model settings as they are now; a chosen strategy ignores them.
    const plan = renderPlan({
      config,
      dimensions: specs,
      strategy: input.strategy,
      ...(cachedRegionBrief ? { cachedRegionBrief } : {}),
      modelDefaults: {
        session_model: process.env.ANTHROPIC_MODEL,
        subagent_model: process.env.RESEARCH_SUBAGENT_MODEL || null,
        verifier_model: process.env.VERIFIER_MODEL,
        page_reader_model: process.env.ANTHROPIC_SMALL_FAST_MODEL,
      },
    });

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
 * beside `funding`. Resolves the active provider from `RESEARCH_PROVIDER` or
 * the plan's session model (`providerForModel`), defaulting to `'anthropic'`.
 * On the organization's own key, calls go straight to the provider's first-party
 * host; on the plan, the host is recorded only when a custom base URL is named.
 */
export function runExecution(
  funding: ResearchFunding,
  env: Readonly<Record<string, string | undefined>> = process.env,
  plan?: Pick<ResearchPlan, 'models'>,
): RunExecution {
  const explicit = parseResearchProvider(env.RESEARCH_PROVIDER);
  const model = plan?.models?.session_model ?? env.ANTHROPIC_MODEL;
  const provider = explicit ?? providerForModel(model, 'anthropic');
  const baseUrlEnv =
    provider === 'openai'
      ? env.OPENAI_BASE_URL
      : provider === 'google'
        ? env.GEMINI_BASE_URL
        : env.ANTHROPIC_BASE_URL;
  return {
    provider,
    endpoint_host:
      funding === 'organization_key' ? PROVIDER_META[provider].firstPartyHost : hostOf(baseUrlEnv),
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
      .set({
        appliedAt: new Date(),
        funding: gate.funding,
        execution: runExecution(gate.funding, process.env, row.plan),
      })
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
