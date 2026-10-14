import { describe, expect, it } from 'vitest';
import type { DimensionProjection, PolicyAnalysisOutput, PolicyImpact } from '@deep-fryer/core';
import { impactDoughnut, impactGroups, impactsChartLabel, impactsSummary } from './policy';
import type { PublishedDimension } from './portrait';

function published(slug: string, ring: 'social' | 'ecological', viz: number | null, order: number): PublishedDimension {
  return {
    slug,
    ring,
    canonical_slug: slug.replace(/-/g, '_'),
    display_order: order,
    viz_level: viz,
    data: { name: `Published ${slug}`, icon: '', description: '', context: '', indicators: [], actions: [] },
    published_at: '2026-01-01T00:00:00Z',
    version_num: 2,
  };
}

function projection(over: Partial<DimensionProjection> & { dimension_slug: string }): DimensionProjection {
  return {
    direction: 'improves',
    current_viz: null,
    projected_viz: null,
    indicator_changes: [],
    unquantified_reasons: [],
    ...over,
  };
}

const impact = (over: Partial<PolicyImpact> & { dimension_slug: string }): PolicyImpact => ({
  direction: 'improves',
  magnitude: 'moderate',
  confidence: 'medium',
  rationale: 'Because.',
  sources: [],
  ...over,
});

const RENT = 'Renter households paying over 30% of income on housing';

describe('impactDoughnut', () => {
  const portrait = [
    published('housing', 'social', 123.3, 7),
    published('energy', 'social', 80, 5),
    published('air-pollution', 'ecological', 40, 19),
  ];

  it('draws every published dimension, projected size and direction colour where impacted', () => {
    const { dimensions, republished } = impactDoughnut(portrait, [
      projection({ dimension_slug: 'housing', current_viz: 123.3, projected_viz: 103.3 }),
      projection({ dimension_slug: 'energy', direction: 'worsens', current_viz: 80 }),
      // Not published on this portrait: no wedge to draw.
      projection({ dimension_slug: 'food', direction: 'mixed' }),
    ]);
    expect(dimensions).toEqual([
      { slug: 'housing', ring: 'social', name: 'Housing', current: 123.3, alternate: 103.3, highlight: 'improves' },
      { slug: 'energy', ring: 'social', name: 'Energy', current: 80, alternate: null, highlight: 'worsens' },
      { slug: 'air-pollution', ring: 'ecological', name: 'Air Pollution', current: 40, alternate: null, highlight: null },
    ]);
    expect(republished).toEqual([]);
  });

  it('notes dimensions republished since the analysis ran', () => {
    const { republished } = impactDoughnut(portrait, [
      projection({ dimension_slug: 'housing', current_viz: 110, projected_viz: 90 }),
      projection({ dimension_slug: 'energy', current_viz: 80.01 }),
    ]);
    expect(republished).toEqual(['Housing']);
  });

  it('names the chart without claiming it is moving, and captions every direction in words', () => {
    const { dimensions } = impactDoughnut(portrait, [
      projection({ dimension_slug: 'housing', current_viz: 123.3, projected_viz: 103.3 }),
      projection({ dimension_slug: 'energy', direction: 'worsens', current_viz: 80 }),
      projection({ dimension_slug: 'air-pollution', direction: 'improves', current_viz: 40 }),
    ]);
    // True when paused or static for reduced motion, not only while flashing.
    expect(impactsChartLabel('Manhattan')).toBe("Manhattan's doughnut, today and with this policy");
    expect(impactsChartLabel('Manhattan')).not.toMatch(/alternat/);

    const summary = impactsSummary(dimensions);
    expect(summary).toContain('Improves: Housing and Air Pollution.');
    expect(summary).toContain('Worsens: Energy.');
    expect(summary).toContain('Wedge size changes for Housing. Other impacts are direction only.');
    // A quantified dimension whose wedge keeps its size is not called resized.
    const unmoved = impactsSummary(
      impactDoughnut(portrait, [
        projection({ dimension_slug: 'housing', current_viz: 123.3, projected_viz: 123.3 }),
        projection({ dimension_slug: 'energy', current_viz: 80, projected_viz: 60 }),
      ]).dimensions,
    );
    expect(unmoved).toContain('Wedge size changes for Energy. Housing was quantified but keeps the same size');
    expect(unmoved).not.toContain('direction only');
    expect(impactsSummary(impactDoughnut(portrait, []).dimensions)).toContain(
      'No published dimension is projected to change.',
    );
  });
});

describe('impactGroups', () => {
  const result: PolicyAnalysisOutput = {
    summary: 's',
    assumptions: [],
    risks: [],
    impacts: [
      impact({ dimension_slug: 'air-pollution', direction: 'improves' }),
      impact({ dimension_slug: 'housing', indicator: RENT, projected_value: 46, projected_year: 2030 }),
      impact({ dimension_slug: 'housing', direction: 'worsens', indicator: 'Rent index', projected_value: 3 }),
      impact({ dimension_slug: 'health', direction: 'none' }),
      impact({ dimension_slug: 'energy', indicator: 'Energy burden' }),
    ],
  };
  const projections = [
    projection({
      dimension_slug: 'housing',
      direction: 'mixed',
      current_viz: 123.3,
      projected_viz: 103.3,
      indicator_changes: [{ indicator: RENT, unit: '%', current_value: 52, projected_value: 46, projected_year: 2030 }],
      unquantified_reasons: ['no published indicator named “Rent index”'],
    }),
    projection({ dimension_slug: 'air-pollution', current_viz: 40 }),
    projection({ dimension_slug: 'energy', current_viz: 80 }),
  ];

  it('flags a quantified change that leaves the wedge at its worst indicator', () => {
    const groups = impactGroups(result, [
      ...projections.filter((p) => p.dimension_slug !== 'housing'),
      projection({
        dimension_slug: 'housing',
        current_viz: 74,
        projected_viz: 74.01,
        indicator_changes: [{ indicator: RENT, unit: '%', current_value: 52, projected_value: 46, projected_year: 2030 }],
      }),
    ]);
    expect(groups.find((g) => g.slug === 'housing')!.wedgeUnchanged).toBe(true);
    // Moved wedges, and dimensions with nothing re-scored, are not flagged.
    expect(impactGroups(result, projections).map((g) => g.wedgeUnchanged)).toEqual([false, false, false, false]);
  });

  it('groups impacts by dimension in framework order, keeping "no effect" impacts', () => {
    const groups = impactGroups(result, projections);
    expect(groups.map((g) => [g.slug, g.name, g.direction])).toEqual([
      ['health', 'Health', 'none'],
      ['energy', 'Energy', 'improves'],
      ['housing', 'Housing', 'mixed'],
      ['air-pollution', 'Air Pollution', 'improves'],
    ]);
  });

  it('matches each impact to its re-scored change, or explains why it stayed direction-only', () => {
    const groups = impactGroups(result, projections);
    const housing = groups.find((g) => g.slug === 'housing')!;
    expect(housing.projectedViz).toBeCloseTo(103.3);
    expect(housing.rows[0]!.change).toEqual({ indicator: RENT, unit: '%', current_value: 52, projected_value: 46, projected_year: 2030 });
    expect(housing.rows[1]!.change).toBeNull();
    expect(housing.rows[1]!.unquantified).toEqual(['no published indicator named “Rent index”']);

    const energy = groups.find((g) => g.slug === 'energy')!;
    expect(energy.rows[0]!.unquantified).toEqual(['no projected value was given for “Energy burden”']);
    // Never quantified at all: direction only, nothing to explain.
    expect(groups.find((g) => g.slug === 'air-pollution')!.rows[0]).toMatchObject({ change: null, unquantified: [] });
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('policy analysis reads', () => {
  it('lists a portrait’s analyses newest first and reads one, scoped to the portrait', async () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    const { listPolicyAnalyses, getPolicyAnalysis } = await import('./policy');
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Reads Town' });
    const { tenant: other } = await m.provisionTenant(db, { slug: uniq(), name: 'Other Town' });
    try {
      const [older] = await db
        .insert(m.policyAnalyses)
        .values({ tenantId: tenant.id, title: 'Older', brief: 'b'.repeat(60), createdAt: new Date(Date.now() - 60_000), transcript: Buffer.from('x') })
        .returning();
      const [newer] = await db
        .insert(m.policyAnalyses)
        .values({ tenantId: tenant.id, title: 'Newer', brief: 'b'.repeat(60), status: 'complete' })
        .returning();

      const listed = await listPolicyAnalyses(tenant.id);
      expect(listed.map((a) => a.title)).toEqual(['Newer', 'Older']);
      expect(listed[0]).not.toHaveProperty('brief');

      const detail = await getPolicyAnalysis(tenant.id, older!.id);
      expect(detail).toMatchObject({ id: older!.id, title: 'Older', status: 'queued' });
      expect(detail).not.toHaveProperty('transcript');
      expect(await getPolicyAnalysis(other.id, newer!.id)).toBeNull();
      expect(await getPolicyAnalysis(tenant.id, 'not-a-uuid')).toBeNull();
    } finally {
      for (const t of [tenant, other]) {
        await db.delete(m.tenants).where(eq(m.tenants.id, t.id));
        await db.delete(m.organizations).where(eq(m.organizations.id, t.organizationId));
      }
      if (saved !== undefined) process.env.AUTH_SECRET = saved;
    }
  });
});
