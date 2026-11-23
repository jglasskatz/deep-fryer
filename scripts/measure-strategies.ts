#!/usr/bin/env tsx
/**
 * Strategy measurement runner (docs/measurement.md): plan small fixed-slice
 * runs, then score completed runs with the measure.ts instruments so two
 * configurations (e.g. session models) can be compared on yield and cost
 * before committing to the full NYC campaign.
 *
 *   tsx scripts/measure-strategies.ts plan --tenant bronx --dims housing,air-pollution,food,ocean-acidification,ozone-depletion [--strategy deep@1]
 *   tsx scripts/measure-strategies.ts enqueue --run <runId>
 *   tsx scripts/measure-strategies.ts status
 *   tsx scripts/measure-strategies.ts score --label sonnet --runs <id>,<id> [--label2 opus --runs2 <id>,<id>]
 *   tsx scripts/measure-strategies.ts score --strategy standard@1 --strategy2 deep@1 [--tenant bronx]
 *
 * `--strategy name@version` (or a bare name, for its newest version) plans
 * with that registry entry (packages/research strategies.ts); without it the
 * plan records operator-defaults and this shell's model settings. On
 * `score`, `--strategy` selects every settled run whose plan recorded that
 * entry (one portrait with --tenant), or, with --runs, refuses any listed
 * run that recorded something else, so an arm is always the strategy it
 * claims to be.
 *
 * `score` folds each run's usage records whole (core mergeUsage) and prices
 * them per model (core priceSessionUsage), so arms are compared in dollars —
 * cache tokens, web searches and the CLI's page reader included — not in
 * tokens, which differ in price ~25× between models and in count between
 * tokenizers. Coverage divides by the indicators each plan asked for.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenantBySlug,
  tenantConfig,
} from '@deep-fryer/db';
import {
  emptyUsage,
  mergeUsage,
  modelsInUsage,
  priceSessionUsage,
  type PortraitConfig,
  type RunTokenUsage,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import {
  enqueueResearchApply,
  NEGATIVE_CONTROLS,
  plannedIndicators,
  renderPlan,
  replicationAgreement,
  resolveStrategy,
  scoreNegativeControls,
  scoreStrategy,
  strategyRef,
  type ControlResult,
  type PlanDimensionSpec,
  type ScoredFinding,
} from '@deep-fryer/research';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function portraitConfig(tenantId: string): Promise<PortraitConfig> {
  const db = getDb();
  const rows = await db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, tenantId));
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  const config = {
    region: map.region,
    source_priority: map.source_priority,
    recency: map.recency,
    scale_policy: map.scale_policy,
    threshold_overrides: map.threshold_overrides ?? {},
  } as PortraitConfig;
  if (!config.region || !config.source_priority || !config.recency || !config.scale_policy) {
    throw new Error('portrait config incomplete for tenant');
  }
  return config;
}

async function plan() {
  const db = getDb();
  const tenantSlug = arg('tenant') ?? 'bronx';
  const allDims = process.argv.includes('--all-dims');
  const dimSlugs = (arg('dims') ?? '').split(',').filter(Boolean);
  if (!dimSlugs.length && !allDims) throw new Error('--dims or --all-dims required');

  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) throw new Error(`tenant ${tenantSlug} not found`);
  const config = await portraitConfig(tenant.id);

  const where = [eq(dimensions.tenantId, tenant.id), isNull(dimensions.archivedAt)];
  if (!allDims) where.push(inArray(dimensions.slug, dimSlugs));
  const dims = await db
    .select()
    .from(dimensions)
    .where(and(...where))
    .orderBy(dimensions.displayOrder);
  if (!allDims && dims.length !== dimSlugs.length) {
    throw new Error(`found ${dims.length} of ${dimSlugs.length} dimensions`);
  }

  // Campaign plans carry the NYC custom indicators so the new threshold refs
  // are actually researched, not just configured. --no-custom for slices that
  // must match earlier calibration plans exactly.
  const { CUSTOM_INDICATORS } = process.argv.includes('--no-custom')
    ? { CUSTOM_INDICATORS: {} as Record<string, never[]> }
    : await import('./nyc-portrait-config.js');

  // --notes '{"dim-slug": "reviewer note", ...}' — injected verbatim into the
  // rerun session prompts (SPEC §8 Rerun).
  const notes = JSON.parse(arg('notes') ?? '{}') as Record<string, string>;

  const { CUSTOM_DIMENSIONS } = await import('./nyc-portrait-config.js');
  const specs: PlanDimensionSpec[] = dims.map((dim) => {
    const fw = frameworkDimension(dim.slug, dim.canonicalSlug);
    const custom = CUSTOM_DIMENSIONS[dim.slug];
    if (!fw && !custom) throw new Error(`no framework or custom dimension for ${dim.slug}`);
    return {
      dimensionId: dim.id,
      slug: dim.slug,
      ring: dim.ring,
      name: fw?.name ?? custom!.name,
      indicators: [...(fw?.indicators ?? []), ...(CUSTOM_INDICATORS[dim.slug] ?? [])],
      reviewerNotes: notes[dim.slug],
    };
  });

  const strategy = arg('strategy');
  const rendered = renderPlan({
    config,
    dimensions: specs,
    ...(strategy ? { strategy: strategyRef(resolveStrategy(strategy)) } : {}),
    modelDefaults: {
      session_model: process.env.ANTHROPIC_MODEL,
      subagent_model: process.env.RESEARCH_SUBAGENT_MODEL || null,
      verifier_model: process.env.VERIFIER_MODEL,
      page_reader_model: process.env.ANTHROPIC_SMALL_FAST_MODEL,
    },
  });
  const [run] = await db
    .insert(researchRuns)
    .values({ tenantId: tenant.id, status: 'planned', plan: rendered, configSnapshot: config })
    .returning();
  if (!run) throw new Error('run insert failed');
  console.log(JSON.stringify({ runId: run.id, sessions: rendered.sessions.length, strategy: recordedStrategy(rendered) }));
}

/** The registry entry a plan recorded, as `name@version`, or null for a plan from before strategies had versions. */
function recordedStrategy(plan: { strategy?: string; strategy_version?: number }): string | null {
  return plan.strategy && plan.strategy_version !== undefined ? `${plan.strategy}@${plan.strategy_version}` : null;
}

async function status() {
  const db = getDb();
  const runs = await db.select().from(researchRuns);
  for (const r of runs) {
    const sessions = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.runId, r.id));
    const byStatus: Record<string, number> = {};
    for (const s of sessions) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    console.log(`${r.id}  ${r.status}  ${recordedStrategy(r.plan) ?? 'strategy-not-recorded'}  sessions=${JSON.stringify(byStatus)}`);
  }
}

/** What one run contributes to a scorecard, plus the per-run facts an arm comparison needs. */
interface LoadedRun {
  runId: string;
  /** The registry entry the plan recorded (`name@version`), or null when it recorded none. */
  strategy: string | null;
  scalePolicy: PortraitConfig['scale_policy'];
  scored: ScoredFinding[];
  /** Every usage record of the run (region, research, verifiers) folded into one. */
  spend: SessionTokenUsage;
  indicatorsPlanned: number;
  /**
   * Every model the run's records say ran, main loops and side calls alike.
   * A run row does not record its arm's models, so this is how a ledger
   * entry is checked against the arm it claims to be.
   */
  models: string[];
  sessions: { complete: number; failed: number; other: number };
  refusals: number;
  /** Refusals the CLI answered on another model: findings or verdicts from an unintended model. */
  refusalFallbacks: number;
  /** Records whose attempt threw before its result: their side-call spend is missing. */
  partialRecords: number;
  dollars: number;
  unpriced: string[];
}

async function loadRun(runId: string): Promise<LoadedRun> {
  const db = getDb();
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
  if (!run) throw new Error(`run ${runId} not found`);
  const sessions = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.runId, runId));
  const dimById = new Map(
    (await db.select().from(dimensions).where(eq(dimensions.tenantId, run.tenantId))).map((d) => [
      d.id,
      d,
    ]),
  );
  const rows = sessions.length
    ? await db
        .select()
        .from(findings)
        .where(inArray(findings.sessionId, sessions.map((s) => s.id)))
    : [];

  const scored: ScoredFinding[] = rows.map((f) => ({
    indicatorSlug: f.indicatorSlug,
    dimensionSlug: dimById.get(f.dimensionId)?.slug ?? 'unknown',
    tenantSlug: String(run.tenantId),
    payload: f.payload,
    verification: f.verification,
  }));

  // Whole records, folded: rows from before per-model metering hold only
  // input and output tokens and fold the same way (they price as unpriced).
  const records = Object.values((run.tokenUsage ?? {}) as RunTokenUsage);
  const spend = records.reduce(mergeUsage, emptyUsage());
  const priced = priceSessionUsage(spend);
  const models = [...new Set(records.flatMap(modelsInUsage))].sort();
  return {
    runId,
    strategy: recordedStrategy(run.plan),
    scalePolicy: run.configSnapshot.scale_policy,
    scored,
    spend,
    indicatorsPlanned: plannedIndicators(run.plan).length,
    models,
    sessions: {
      complete: sessions.filter((s) => s.status === 'complete').length,
      failed: sessions.filter((s) => s.status === 'failed').length,
      other: sessions.filter((s) => s.status !== 'complete' && s.status !== 'failed').length,
    },
    refusals: records.reduce((n, u) => n + (u.refusals ?? 0), 0),
    refusalFallbacks: records.reduce((n, u) => n + (u.refusal_fallbacks?.length ?? 0), 0),
    partialRecords: records.filter((u) => u.partial).length,
    dollars: priced.dollars,
    unpriced: priced.unpriced,
  };
}

async function scoreLabel(label: string, runIds: string[], strategy?: string) {
  const perRun = await Promise.all(runIds.map(loadRun));
  const mismatched = strategy ? perRun.filter((r) => r.strategy !== strategy) : [];
  if (mismatched.length) {
    throw new Error(
      `arm ${label} is ${strategy}, but ${mismatched.map((r) => `${r.runId} recorded ${r.strategy ?? 'no strategy'}`).join('; ')}`,
    );
  }
  const all = perRun.flatMap((r) => r.scored);
  const spend = perRun.map((r) => r.spend).reduce(mergeUsage, emptyUsage());
  const card = scoreStrategy(all, {
    indicatorsPlanned: perRun.reduce((n, r) => n + r.indicatorsPlanned, 0),
    tokens: spend,
  });
  const controlResults: ControlResult[] = perRun.flatMap(
    (r) => scoreNegativeControls(r.scored, NEGATIVE_CONTROLS, { scalePolicy: r.scalePolicy }).results,
  );
  const controls = {
    results: controlResults,
    fabricationRate:
      controlResults.length === 0
        ? 0
        : controlResults.filter((r) => !r.correct).length / controlResults.length,
  };
  const agreement = perRun.length > 1 ? replicationAgreement(perRun.map((r) => r.scored)) : [];
  return {
    label,
    strategy: strategy ?? null,
    runIds,
    // Dollars, per-model tokens and the unpriced models are on the scorecard
    // (dollars, tokens.by_model, unpriced); the rest is per run.
    scorecard: card,
    perModelTokens: spend.by_model ?? {},
    runs: perRun.map(({ scored: _scored, spend: _spend, scalePolicy: _scalePolicy, ...facts }) => facts),
    sessions: {
      complete: perRun.reduce((n, r) => n + r.sessions.complete, 0),
      failed: perRun.reduce((n, r) => n + r.sessions.failed, 0),
    },
    refusals: perRun.reduce((n, r) => n + r.refusals, 0),
    refusalFallbacks: perRun.reduce((n, r) => n + r.refusalFallbacks, 0),
    negativeControls: controls,
    replication: agreement,
  };
}

/** Every settled run whose plan recorded `ref` (optionally on one portrait), oldest first. */
async function runsWithStrategy(ref: string, tenantSlug?: string): Promise<string[]> {
  const db = getDb();
  const entry = resolveStrategy(ref);
  const where = [
    inArray(researchRuns.status, ['complete', 'failed']),
    sql`${researchRuns.plan}->>'strategy' = ${entry.name}`,
    sql`(${researchRuns.plan}->>'strategy_version')::int = ${entry.version}`,
  ];
  if (tenantSlug) {
    const tenant = await tenantBySlug(db, tenantSlug);
    if (!tenant) throw new Error(`tenant ${tenantSlug} not found`);
    where.push(eq(researchRuns.tenantId, tenant.id));
  }
  const rows = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(and(...where))
    .orderBy(researchRuns.createdAt);
  if (!rows.length) throw new Error(`no settled run recorded ${strategyRef(entry)}`);
  return rows.map((r) => r.id);
}

/** One arm: its runs from --runs<suffix>, or every run of --strategy<suffix>; null when neither was given. */
async function arm(suffix: '' | '2', fallbackLabel: string) {
  const ref = arg(`strategy${suffix}`);
  const strategy = ref ? strategyRef(resolveStrategy(ref)) : undefined;
  const listed = (arg(`runs${suffix}`) ?? '').split(',').filter(Boolean);
  if (!listed.length && !strategy) return null;
  const runs = listed.length ? listed : await runsWithStrategy(strategy!, arg('tenant'));
  return scoreLabel(arg(`label${suffix}`) ?? strategy ?? fallbackLabel, runs, strategy);
}

async function score() {
  const first = await arm('', 'A');
  if (!first) throw new Error('--runs or --strategy required');
  const second = await arm('2', 'B');
  console.log(JSON.stringify(second ? [first, second] : [first], null, 2));
}

/**
 * An operator's measurement run bypasses the billing gate on purpose: it is
 * never applied (applied_at stays null), so no organization's allowance
 * counts it, and it keeps research_runs.funding at its default 'plan', so the
 * worker runs it on the deployment's key — never on the organization's own
 * key, even if one is on file (migration 0012). The job says so (`unmetered`):
 * the worker runs no other unapplied run.
 */
async function enqueue() {
  const runId = arg('run');
  if (!runId) throw new Error('--run required');
  await enqueueResearchApply(runId, { unmetered: true });
  console.log(`enqueued ${runId}`);
}

const cmd = process.argv[2];
const commands: Record<string, () => Promise<void>> = { plan, enqueue, status, score };
const fn = commands[cmd ?? ''];
if (!fn) {
  console.error('usage: measure-strategies.ts <plan|enqueue|status|score> [flags]');
  process.exit(2);
}
fn().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
