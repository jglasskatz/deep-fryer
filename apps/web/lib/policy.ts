import 'server-only';
import { cache } from 'react';
import { and, desc, eq } from 'drizzle-orm';
import { framework, frameworkDimension } from '@deep-fryer/contract';
import type {
  DimensionProjection,
  ImpactDirection,
  PolicyAnalysisOutput,
  PolicyImpact,
  SessionTokenUsage,
} from '@deep-fryer/core';
import { policyAnalyses } from '@deep-fryer/db';
import type { ImpactDimension } from '@/components/doughnut/ImpactDoughnut';
import { getPortrait } from './data';
import { userDb } from './db';
import type { PublishedDimension } from './portrait';

/*
 * Policy analysis reads (SPEC-v5 §2) — staff plane only. Every query runs in
 * userDb(), so row-level security limits rows to the portrait's editors and
 * owners, and organization owners (policy_analyses_editor_read, migration
 * 0009) — the same people the pages admit. Columns are always listed
 * explicitly: the app role has no SELECT on `transcript` (migration 0008),
 * so a `select *` would be refused by Postgres, and the list never needs the
 * brief body.
 *
 * The rest of this module turns a stored analysis into what the result page
 * draws — the flashing doughnut's dimensions and the impacts table — as pure
 * functions, so the page stays declarative and the mapping is unit-tested.
 */

export type PolicyAnalysisStatus = 'queued' | 'running' | 'complete' | 'failed';

export interface PolicyAnalysisListItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  status: PolicyAnalysisStatus;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PolicyAnalysisDetail extends PolicyAnalysisListItem {
  tenantId: string;
  brief: string;
  result: PolicyAnalysisOutput | null;
  projections: DimensionProjection[] | null;
  /** What the worker changed to fit the answer to the output contract, one sentence each. */
  adjustments: string[] | null;
  error: string | null;
  startedAt: Date | null;
  tokenUsage: SessionTokenUsage | null;
}

/** A portrait's analyses, newest first, without the brief body. */
export async function listPolicyAnalyses(tenantId: string): Promise<PolicyAnalysisListItem[]> {
  return userDb((db) =>
    db
      .select({
        id: policyAnalyses.id,
        title: policyAnalyses.title,
        sourceUrl: policyAnalyses.sourceUrl,
        status: policyAnalyses.status,
        createdAt: policyAnalyses.createdAt,
        completedAt: policyAnalyses.completedAt,
      })
      .from(policyAnalyses)
      .where(eq(policyAnalyses.tenantId, tenantId))
      .orderBy(desc(policyAnalyses.createdAt)),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One analysis of this portrait, or null. A malformed id is "not found"
 * rather than a Postgres uuid syntax error (a 500); scoping by tenant keeps
 * an id from another portrait the same member can see off this page.
 * Memoized per request: the result page and its generateMetadata (the
 * analysis title is the page title) share one query.
 */
export const getPolicyAnalysis = cache(async function getPolicyAnalysis(
  tenantId: string,
  id: string,
): Promise<PolicyAnalysisDetail | null> {
  if (!UUID.test(id)) return null;
  return userDb(async (db) => {
    const [row] = await db
      .select({
        id: policyAnalyses.id,
        tenantId: policyAnalyses.tenantId,
        title: policyAnalyses.title,
        brief: policyAnalyses.brief,
        sourceUrl: policyAnalyses.sourceUrl,
        status: policyAnalyses.status,
        result: policyAnalyses.result,
        projections: policyAnalyses.projections,
        adjustments: policyAnalyses.adjustments,
        error: policyAnalyses.error,
        createdAt: policyAnalyses.createdAt,
        startedAt: policyAnalyses.startedAt,
        completedAt: policyAnalyses.completedAt,
        tokenUsage: policyAnalyses.tokenUsage,
      })
      .from(policyAnalyses)
      .where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.tenantId, tenantId)));
    return row ?? null;
  });
});

/**
 * Just the status of one analysis, for the result page's live poll
 * (app/[tenant]/admin/policy/[id]/status/route.ts): a few bytes every few
 * seconds instead of re-rendering the whole page, brief and all, and the
 * page re-renders only when this changes.
 */
export async function getPolicyAnalysisStatus(
  tenantId: string,
  id: string,
): Promise<{ status: PolicyAnalysisStatus } | null> {
  if (!UUID.test(id)) return null;
  return userDb(async (db) => {
    const [row] = await db
      .select({ status: policyAnalyses.status })
      .from(policyAnalyses)
      .where(and(eq(policyAnalyses.id, id), eq(policyAnalyses.tenantId, tenantId)));
    return row ?? null;
  });
}

// ---- Dimension naming and order ---------------------------------------------

/**
 * Impacts and projections are keyed by framework slug (the analysis schema's
 * 21). A portrait dimension maps to one through canonical_slug — the same
 * resolver the worker uses when it builds the prompt — so a custom dimension
 * lines up with the projection drawn for it.
 */
export function frameworkSlugOf(d: Pick<PublishedDimension, 'slug' | 'canonical_slug'>): string {
  return frameworkDimension(d.slug, d.canonical_slug)?.slug ?? d.slug;
}

/** The framework's English name (staff pages are English), or the slug for anything unknown. */
export function dimensionName(slug: string): string {
  return framework.dimensions.find((d) => d.slug === slug)?.name ?? slug;
}

const FRAMEWORK_ORDER = new Map(framework.dimensions.map((d, i) => [d.slug, i]));
const frameworkOrder = (slug: string) => FRAMEWORK_ORDER.get(slug) ?? Number.MAX_SAFE_INTEGER;

const DIRECTION_HIGHLIGHT: Record<ImpactDirection, ImpactDimension['highlight']> = {
  improves: 'improves',
  worsens: 'worsens',
  mixed: 'mixed',
  none: null,
};

// ---- The flashing doughnut ----------------------------------------------------

export interface PolicyDoughnut {
  /** Every published dimension, in portrait order, with its projected state. */
  dimensions: ImpactDimension[];
  /**
   * Names of projected dimensions whose published level has changed since
   * the analysis ran: "today" is drawn from the portrait as published now,
   * while projected sizes were re-scored against the data published then.
   */
  republished: string[];
}

/**
 * The doughnut for an analysis: every published dimension appears, sized by
 * its published viz_level today; in the "with this policy" state it takes
 * the projected viz_level when an impact was quantified and the direction's
 * highlight colour whenever it has an impact — so direction-only impacts
 * still flash.
 */
export function impactDoughnut(
  published: PublishedDimension[],
  projections: DimensionProjection[],
): PolicyDoughnut {
  const bySlug = new Map(projections.map((p) => [p.dimension_slug, p]));
  const republished: string[] = [];
  const dimensions = published.map((d): ImpactDimension => {
    const slug = frameworkSlugOf(d);
    const p = bySlug.get(slug);
    const name = frameworkDimension(d.slug, d.canonical_slug)?.name ?? d.data.name;
    if (p && !sameLevel(p.current_viz, d.viz_level)) republished.push(name);
    return {
      slug,
      ring: d.ring,
      name,
      current: d.viz_level,
      alternate: p?.projected_viz ?? null,
      highlight: p ? DIRECTION_HIGHLIGHT[p.direction] : null,
    };
  });
  return { dimensions, republished };
}

/** viz_level round-trips through a `real` column; compare to display precision. */
function sameLevel(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}

/** Loads the published portrait and builds the analysis doughnut from it. */
export async function policyDoughnut(
  tenantSlug: string,
  projections: DimensionProjection[],
): Promise<PolicyDoughnut> {
  const portrait = await getPortrait(tenantSlug);
  return impactDoughnut(portrait?.dimensions ?? [], projections);
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The canvas's accessible name: what the chart is, true whether it is
 * flashing, paused on one state, or static for a reader who prefers reduced
 * motion. What changes is described by impactsSummary, shown as the chart's
 * visible caption.
 */
export function impactsChartLabel(tenantName: string): string {
  return `${tenantName}'s doughnut, today and with this policy`;
}

/**
 * The chart's caption, visible next to it: which wedges improve, worsen, or
 * are mixed, and which change size. On the canvas direction is colour —
 * green and red that many colour-blind readers cannot tell apart — so the
 * same information is given here in words for everyone, sighted or not.
 * The impacts table below carries the detail.
 */
export function impactsSummary(dims: ImpactDimension[]): string {
  const named = (h: ImpactDimension['highlight']) => dims.filter((d) => d.highlight === h).map((d) => d.name);
  const improves = named('improves');
  const worsens = named('worsens');
  const mixed = named('mixed');
  if (improves.length + worsens.length + mixed.length === 0) {
    return 'No published dimension is projected to change. The impacts table lists every impact.';
  }
  const parts: string[] = [];
  if (improves.length) parts.push(`Improves: ${list(improves)}.`);
  if (worsens.length) parts.push(`Worsens: ${list(worsens)}.`);
  if (mixed.length) parts.push(`Mixed: ${list(mixed)}.`);
  const resized = dims.filter((d) => d.alternate !== null).map((d) => d.name);
  parts.push(
    resized.length
      ? `Wedge size changes for ${list(resized)}; other impacts are direction only.`
      : 'No impact was quantified, so wedges change colour but not size.',
  );
  parts.push('The impacts table lists every impact.');
  return parts.join(' ');
}

// ---- The impacts table ----------------------------------------------------------

export type IndicatorChange = DimensionProjection['indicator_changes'][number];

export interface ImpactRow {
  impact: PolicyImpact;
  /** The re-scored indicator change behind this impact, when it was quantified. */
  change: IndicatorChange | null;
  /**
   * Why an attempted quantification stayed direction-only. Empty when the
   * impact was quantified, or never named an indicator in the first place.
   */
  unquantified: string[];
}

export interface ImpactGroup {
  /** Framework slug; the row anchor is `impact-{slug}`, the doughnut's wedge target. */
  slug: string;
  name: string;
  /** The dimension's overall direction ("mixed" when its impacts disagree; "none" when no effect). */
  direction: ImpactDirection;
  currentViz: number | null;
  projectedViz: number | null;
  rows: ImpactRow[];
}

/**
 * Every impact in the analysis, grouped by dimension in framework order (the
 * doughnut's order), each matched to its re-scored indicator change or to the
 * reason it could not be quantified. Impacts with direction "none" stay in
 * the table — "no expected effect" is part of the analysis — but never on
 * the doughnut.
 */
export function impactGroups(
  result: PolicyAnalysisOutput,
  projections: DimensionProjection[],
): ImpactGroup[] {
  const bySlug = new Map(projections.map((p) => [p.dimension_slug, p]));
  const grouped = new Map<string, PolicyImpact[]>();
  for (const impact of result.impacts) {
    grouped.set(impact.dimension_slug, [...(grouped.get(impact.dimension_slug) ?? []), impact]);
  }
  return [...grouped]
    .sort(([a], [b]) => frameworkOrder(a) - frameworkOrder(b))
    .map(([slug, impacts]) => {
      const p = bySlug.get(slug);
      return {
        slug,
        name: dimensionName(slug),
        direction: p?.direction ?? 'none',
        currentViz: p?.current_viz ?? null,
        projectedViz: p?.projected_viz ?? null,
        rows: impacts.map((impact) => impactRow(impact, p)),
      };
    });
}

function impactRow(impact: PolicyImpact, p: DimensionProjection | undefined): ImpactRow {
  const attempted = impact.indicator !== undefined || impact.projected_value !== undefined;
  // projectDimensions ignores "none" impacts entirely, so there is nothing to match.
  if (!attempted || impact.direction === 'none') return { impact, change: null, unquantified: [] };
  if (impact.indicator === undefined) {
    return { impact, change: null, unquantified: ['a projected value was given without naming an indicator'] };
  }
  if (impact.projected_value === undefined) {
    return { impact, change: null, unquantified: [`no projected value was given for “${impact.indicator}”`] };
  }
  const change =
    p?.indicator_changes.find(
      (c) => c.indicator === impact.indicator && c.projected_value === impact.projected_value,
    ) ?? null;
  if (change) return { impact, change, unquantified: [] };
  // Reasons are stored per dimension; keep the ones about this indicator
  // (they quote its name) plus the dimension-wide ones (which quote nothing).
  const reasons = p?.unquantified_reasons ?? [];
  const relevant = reasons.filter((r) => r.includes(`“${impact.indicator}”`) || !r.includes('“'));
  return { impact, change: null, unquantified: relevant.length ? relevant : reasons };
}
