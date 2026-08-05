#!/usr/bin/env tsx
/**
 * Strategy measurement runner (docs/measurement.md): plan small fixed-slice
 * runs, then score completed runs with the measure.ts instruments so two
 * configurations (e.g. session models) can be compared on yield and cost
 * before committing to the full NYC campaign.
 *
 *   tsx scripts/measure-strategies.ts plan --tenant bronx --dims housing,air-pollution,food,ocean-acidification,ozone-depletion
 *   tsx scripts/measure-strategies.ts enqueue --run <runId>
 *   tsx scripts/measure-strategies.ts status
 *   tsx scripts/measure-strategies.ts score --label sonnet --runs <id>,<id> [--label2 opus --runs2 <id>,<id>]
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
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
import type { PortraitConfig, RunTokenUsage } from '@deep-fryer/core';
import {
  enqueueResearchApply,
  renderPlan,
  replicationAgreement,
  scoreNegativeControls,
  scoreStrategy,
  type PlanDimensionSpec,
  type ScoredFinding,
  type TokenUsage,
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

  const specs: PlanDimensionSpec[] = dims.map((dim) => {
    const fw = frameworkDimension(dim.slug, dim.canonicalSlug);
    if (!fw) throw new Error(`no framework dimension for ${dim.slug}`);
    return {
      dimensionId: dim.id,
      slug: dim.slug,
      ring: dim.ring,
      name: fw.name,
      indicators: [...fw.indicators, ...(CUSTOM_INDICATORS[dim.slug] ?? [])],
      reviewerNotes: notes[dim.slug],
    };
  });

  const rendered = renderPlan({ config, dimensions: specs });
  const [run] = await db
    .insert(researchRuns)
    .values({ tenantId: tenant.id, status: 'planned', plan: rendered, configSnapshot: config })
    .returning();
  if (!run) throw new Error('run insert failed');
  console.log(JSON.stringify({ runId: run.id, sessions: rendered.sessions.length }));
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
    console.log(`${r.id}  ${r.status}  sessions=${JSON.stringify(byStatus)}`);
  }
}

async function loadRun(runId: string): Promise<{ scored: ScoredFinding[]; tokens: TokenUsage }> {
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
  const rows = await db
    .select()
    .from(findings)
    .where(inArray(findings.sessionId, sessions.map((s) => s.id)));

  const scored: ScoredFinding[] = rows.map((f) => ({
    indicatorSlug: f.indicatorSlug,
    dimensionSlug: dimById.get(f.dimensionId)?.slug ?? 'unknown',
    tenantSlug: String(run.tenantId),
    payload: f.payload,
    verification: f.verification,
  }));

  const usage = (run.tokenUsage ?? {}) as RunTokenUsage;
  const tokens: TokenUsage = { input_tokens: 0, output_tokens: 0 };
  for (const u of Object.values(usage)) {
    tokens.input_tokens += u.input_tokens ?? 0;
    tokens.output_tokens += u.output_tokens ?? 0;
  }
  return { scored, tokens };
}

async function scoreLabel(label: string, runIds: string[]) {
  const perRun = await Promise.all(runIds.map(loadRun));
  const all = perRun.flatMap((r) => r.scored);
  const tokens = perRun.reduce(
    (acc, r) => ({
      input_tokens: acc.input_tokens + r.tokens.input_tokens,
      output_tokens: acc.output_tokens + r.tokens.output_tokens,
    }),
    { input_tokens: 0, output_tokens: 0 },
  );
  const card = scoreStrategy(all, tokens);
  const controls = scoreNegativeControls(all);
  const agreement = perRun.length > 1 ? replicationAgreement(perRun.map((r) => r.scored)) : [];
  return { label, runIds, scorecard: card, negativeControls: controls, replication: agreement };
}

async function score() {
  const label = arg('label') ?? 'A';
  const runs = (arg('runs') ?? '').split(',').filter(Boolean);
  if (!runs.length) throw new Error('--runs required');
  const out = [await scoreLabel(label, runs)];
  const label2 = arg('label2');
  const runs2 = (arg('runs2') ?? '').split(',').filter(Boolean);
  if (label2 && runs2.length) out.push(await scoreLabel(label2, runs2));
  console.log(JSON.stringify(out, null, 2));
}

async function enqueue() {
  const runId = arg('run');
  if (!runId) throw new Error('--run required');
  await enqueueResearchApply(runId);
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
