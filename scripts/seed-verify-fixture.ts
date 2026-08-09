#!/usr/bin/env tsx
/**
 * Seed two complete research runs so the /admin/verify surface and the
 * research-verify CLI are explorable without running real research:
 *
 *   1. a SUSPECT run — fail rate over the 5% bar plus a schema failure; the
 *      verifier stage blocks it permanently (by design: "prefer re-research
 *      over hand-fixing"), demonstrating the hard bar;
 *   2. an APPROVABLE run — passes, one uncertain, a tier-4 source, and an
 *      honest gap; dispositioning the flags and inspecting the sample walks
 *      the full lifecycle to a hash-bound approval.
 *
 * Evidence points at the committed santacruz fixtures.
 *
 *   pnpm seed-verify-fixture [--tenant santacruz]
 */
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { FindingPayload, FindingVerification, ResearchPlan } from '@deep-fryer/core';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenantBySlug,
} from '@deep-fryer/db';
import { eq } from 'drizzle-orm';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const EVIDENCE = {
  ghg: 'evidence/city_santa_cruz_ghg_emissions.png',
  pesticide: 'evidence/pesticide_use_report_2022.png',
};

function indicator(
  slug: string,
  name: string,
  overrides: Partial<Extract<FindingPayload, { kind: 'indicator' }>> = {},
): FindingPayload {
  return {
    kind: 'indicator',
    indicator_slug: slug,
    name,
    value: 12.4,
    unit: '%',
    year: 2024,
    target: 5,
    level_pct: 148,
    scoring: {
      threshold_ref: `fixture.${slug}`,
      function: 'lower_is_better',
      inputs: { value: 12.4, target: 5, scale: 5 },
      worked_math: 'level_pct = (12.4 − 5) ⁄ 5 × 100 = +148.0',
    },
    source: 'City of Santa Cruz Open Data',
    source_url: 'https://data.cityofsantacruz.com/fixture',
    source_tier: 1,
    evidence: { snapshot_path: EVIDENCE.ghg, captured_at: '2026-08-01T00:00:00Z' },
    confidence: 'high',
    geographic_scale: 'city',
    ...overrides,
  };
}

function verification(overrides: Partial<FindingVerification> = {}): FindingVerification {
  return {
    url_ok: true,
    schema_ok: true,
    recency_ok: true,
    scale_ok: true,
    content_supported: 'pass',
    ...overrides,
  };
}

type Dim = typeof dimensions.$inferSelect;

interface FixtureRow {
  dim: Dim;
  slug: string;
  payload: FindingPayload;
  verification: FindingVerification;
}

async function seedRun(
  db: ReturnType<typeof getDb>,
  tenant: { id: string; name: string; region: string | null },
  dims: Dim[],
  rows: FixtureRow[],
): Promise<string> {
  const config = defaultPortraitConfig(tenant.name, tenant.region ?? tenant.name);
  const plan: ResearchPlan = {
    config_hash: 'fixture0',
    plugin_version: 'fixture',
    sessions: dims.map((d) => ({
      kind: 'dimension' as const,
      dimension_slug: d.slug,
      prompt: `[fixture] Research the ${d.slug} dimension for ${tenant.name}. This synthetic prompt stands in for the rendered research plan so the verify drawer has something real to show.`,
      tool_allowlist: ['WebSearch', 'WebFetch', 'mcp__evidence__capture_evidence'],
      output_schema_ref: 'finding.schema.json',
      config_hash: 'fixture0',
    })),
  };

  const [run] = await db
    .insert(researchRuns)
    .values({
      tenantId: tenant.id,
      status: 'complete',
      plan,
      configSnapshot: config,
      completedAt: new Date(),
      tokenUsage: {},
    })
    .returning();
  if (!run) throw new Error('run insert failed');

  const sessionByDim = new Map<string, string>();
  for (const d of dims) {
    const [s] = await db
      .insert(researchSessions)
      .values({
        runId: run.id,
        dimensionId: d.id,
        kind: 'dimension',
        status: 'complete',
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();
    sessionByDim.set(d.id, s!.id);
  }

  for (const row of rows) {
    await db.insert(findings).values({
      sessionId: sessionByDim.get(row.dim.id)!,
      dimensionId: row.dim.id,
      indicatorSlug: row.slug,
      payload: row.payload,
      verification: row.verification,
    });
  }
  return run.id;
}

async function main() {
  const db = getDb();
  const tenantSlug = arg('tenant') ?? 'santacruz';
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) throw new Error(`tenant ${tenantSlug} missing — run import-santa-cruz first`);

  const dims = await db
    .select()
    .from(dimensions)
    .where(eq(dimensions.tenantId, tenant.id))
    .orderBy(dimensions.displayOrder);
  if (dims.length < 3) throw new Error('tenant needs at least 3 dimensions');
  const [dimA, dimB, dimC] = dims as [Dim, Dim, Dim];

  const suspectRows: FixtureRow[] = [
    // dimA: a clean pass and a verifier-contradicted claim.
    {
      dim: dimA,
      slug: 'fixture-pass',
      payload: indicator('fixture-pass', 'Clean pass (tier 1, evidence archived)'),
      verification: verification(),
    },
    {
      dim: dimA,
      slug: 'fixture-fail',
      payload: indicator('fixture-fail', 'Contradicted by its own source', {
        value: 3.2,
        level_pct: -36,
        evidence: { snapshot_path: EVIDENCE.pesticide, captured_at: '2026-08-01T00:00:00Z' },
      }),
      verification: verification({
        content_supported: 'fail',
        verifier_note:
          '[fixture] The cited page reports 8.1%, not 3.2% — the claim contradicts its own source.',
      }),
    },
    // dimB: an uncertain verdict and a tier-4 source that passed.
    {
      dim: dimB,
      slug: 'fixture-uncertain',
      payload: indicator('fixture-uncertain', 'Paywalled source, verifier uncertain', {
        evidence: { snapshot_path: EVIDENCE.pesticide, captured_at: '2026-08-01T00:00:00Z' },
      }),
      verification: verification({
        content_supported: 'uncertain',
        verifier_note: '[fixture] Source sits behind a paywall; the archived snapshot is readable.',
      }),
    },
    {
      dim: dimB,
      slug: 'fixture-tier4',
      payload: indicator('fixture-tier4', 'Rests on secondary reporting (tier 4)', {
        source: 'Local newspaper data desk',
        source_tier: 4,
      }),
      verification: verification(),
    },
    // dimC: a schema failure (year came back as a string) and an honest gap.
    {
      dim: dimC,
      slug: 'fixture-schema',
      payload: {
        ...indicator('fixture-schema', 'Schema failure — year is a string'),
        year: '2024' as unknown as number,
      },
      verification: verification({
        schema_ok: false,
        content_supported: 'fail',
        verifier_note: '[fixture] output did not conform to the finding schema',
      }),
    },
    {
      dim: dimC,
      slug: 'fixture-gap',
      payload: {
        kind: 'gap',
        indicator_slug: 'fixture-gap',
        reason:
          '[fixture] No agency publishes this indicator at city or county scale; nearest is a statewide 2019 estimate.',
        scales_tried: ['city', 'county'],
        tiers_tried: [1, 2, 3],
        searched_at: '2026-08-01T00:00:00Z',
        nearest_data: 'statewide 2019 estimate (rejected: wrong scale, stale)',
      },
      verification: verification({
        content_supported: 'uncertain',
        verifier_note: 'data gap — nothing to fetch; review the search trail',
      }),
    },
  ];

  const suspectRunId = await seedRun(db, tenant, [dimA, dimB, dimC], suspectRows);

  // The approvable run: no verifier fails, so nothing trips the 5% bar. The
  // flags (one uncertain, the gap) plus the spot-check sample are the whole
  // review workload — disposition them and the run walks to approval.
  const approvableRows: FixtureRow[] = [
    {
      dim: dimA,
      slug: 'fixture-pass',
      payload: indicator('fixture-pass', 'Clean pass (tier 1, evidence archived)'),
      verification: verification(),
    },
    {
      dim: dimA,
      slug: 'fixture-pass-2',
      payload: indicator('fixture-pass-2', 'Second clean pass', {
        value: 41,
        unit: 'per 100k',
        level_pct: -18,
        evidence: { snapshot_path: EVIDENCE.pesticide, captured_at: '2026-08-01T00:00:00Z' },
      }),
      verification: verification(),
    },
    {
      dim: dimB,
      slug: 'fixture-uncertain',
      payload: indicator('fixture-uncertain', 'Paywalled source, verifier uncertain', {
        evidence: { snapshot_path: EVIDENCE.pesticide, captured_at: '2026-08-01T00:00:00Z' },
      }),
      verification: verification({
        content_supported: 'uncertain',
        verifier_note: '[fixture] Source sits behind a paywall; the archived snapshot is readable.',
      }),
    },
    {
      dim: dimB,
      slug: 'fixture-tier4',
      payload: indicator('fixture-tier4', 'Rests on secondary reporting (tier 4)', {
        source: 'Local newspaper data desk',
        source_tier: 4,
      }),
      verification: verification(),
    },
    {
      dim: dimC,
      slug: 'fixture-gap',
      payload: {
        kind: 'gap',
        indicator_slug: 'fixture-gap',
        reason:
          '[fixture] No agency publishes this indicator at city or county scale; nearest is a statewide 2019 estimate.',
        scales_tried: ['city', 'county'],
        tiers_tried: [1, 2, 3],
        searched_at: '2026-08-01T00:00:00Z',
        nearest_data: 'statewide 2019 estimate (rejected: wrong scale, stale)',
      },
      verification: verification({
        content_supported: 'uncertain',
        verifier_note: 'data gap — nothing to fetch; review the search trail',
      }),
    },
  ];
  const approvableRunId = await seedRun(db, tenant, [dimA, dimB, dimC], approvableRows);

  console.log(`Seeded two runs for ${tenantSlug} across ${dimA.slug}, ${dimB.slug}, ${dimC.slug}:`);
  console.log(
    `  suspect    ${suspectRunId} — fail rate over the 5% bar; blocked at the verifier stage by design`,
  );
  console.log(
    `  approvable ${approvableRunId} — disposition the flags + inspect the sample, then approve`,
  );
  console.log(`Explore: /${tenantSlug}/admin/verify`);
  console.log(`Gate:    pnpm research-verify --tenant ${tenantSlug} --run ${approvableRunId}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
