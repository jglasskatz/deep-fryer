import 'server-only';
import { cache } from 'react';
import { and, desc, eq } from 'drizzle-orm';
import { framework, frameworkDimension } from '@deep-fryer/contract';
import {
  unmovedWedgeReason,
  type DimensionProjection,
  type ImpactDirection,
  type PolicyAnalysisOutput,
  type PolicyImpact,
  type PolicyPortraitBaseline,
  type SessionTokenUsage,
  type UnmovedWedgeReason,
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

/** Older analyses lack sufficient unit/source/baseline provenance for a wedge.
 * Keep their text and reasons readable, but do not imply a verified scenario.
 */
export function safePolicyProjection(p: DimensionProjection): DimensionProjection {
  if (p.epistemic_type === 'modeled-estimate' && p.baseline) return p;
  return { ...p, projected_viz: null, indicator_changes: [],
    unquantified_reasons: [...p.unquantified_reasons, 'Legacy estimate: units, sources and analysis baseline were not verified; shown as direction only.'] };
}

// ---- The flashing doughnut ----------------------------------------------------

export interface PolicyDoughnut {
  /** False for legacy rows that never captured complete original geometry. */
  baselineComplete: boolean;
  /** Every published dimension, in portrait order, with its projected state. */
  dimensions: ImpactDimension[];
  /**
   * Original dimensions now removed or republished. New analyses draw both
   * states entirely from the complete captured portrait, regardless.
   */
  republished: string[];
}

/**
 * New analyses retain every original published dimension, name, ring, order
 * and measured level in both states. Only a sourced modeled impact changes
 * the alternate size. Legacy rows explicitly report incomplete geometry.
 */
export function impactDoughnut(
  published: PublishedDimension[],
  projections: DimensionProjection[],
  baseline?: PolicyPortraitBaseline,
): PolicyDoughnut {
  const bySlug = new Map(projections.map(p => [p.dimension_slug, safePolicyProjection(p)]));
  const republished: string[] = [];
  const current = new Map(published.map(d=>[d.slug,d]));
  const original = baseline?.dimensions;
  const geometry = original ?? published.map(d=>({slug:d.slug,name:frameworkDimension(d.slug,d.canonical_slug)?.name ?? d.data.name,
    ring:d.ring,display_order:d.display_order,viz_level:d.viz_level,version_num:d.version_num,indicators:d.data.indicators}));
  const dimensions = geometry.map((d): ImpactDimension => {
    const p = bySlug.get(d.slug);
    const now = current.get(d.slug);
    if (original) {
      if (!now || (d.version_num !== null && d.version_num !== now.version_num) || JSON.stringify(d.indicators) !== JSON.stringify(now.data.indicators)) republished.push(d.name);
    } else if (p && (!sameLevel(p.current_viz,d.viz_level) || (p.baseline && (
      (p.baseline.version_num !== null && p.baseline.version_num !== d.version_num) ||
      JSON.stringify(p.baseline.indicators) !== JSON.stringify(d.indicators)
    )))) republished.push(d.name);
    return {slug:d.slug,ring:d.ring,name:d.name,
      current:d.viz_level,
      alternate:p?.projected_viz ?? null,highlight:p ? DIRECTION_HIGHLIGHT[p.direction] : null};
  });
  return { dimensions, republished, baselineComplete: original !== undefined };
}

/** viz_level round-trips through a `real` column; compare to display precision. */
function sameLevel(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.05;
}

/**
 * What a quantified projection does to its wedge as drawn: `resized`, or the
 * reason it stays put (core unmovedWedgeReason), or `unmoved` for analyses
 * stored before the reason could be computed. Null when nothing was
 * quantified. Both sides are the analysis's own — the level published when
 * it ran and the projected one — so a republish since cannot turn a moved
 * wedge into an unmoved one or the reverse. The renderer draws whole levels
 * (it parses them with parseInt), so a change inside one level is unmoved.
 */
export type WedgeOutcome = 'resized' | UnmovedWedgeReason | 'unmoved';

export function wedgeOutcome(p: DimensionProjection | undefined): WedgeOutcome | null {
  if (!p || p.projected_viz === null) return null;
  if (p.current_viz === null || Math.trunc(p.current_viz) !== Math.trunc(p.projected_viz)) return 'resized';
  return unmovedWedgeReason(p) ?? 'unmoved';
}

/** Loads the published portrait and builds the analysis doughnut from it. */
export async function policyDoughnut(
  tenantSlug: string,
  projections: DimensionProjection[],
  baseline?: PolicyPortraitBaseline,
): Promise<PolicyDoughnut> {
  const portrait = await getPortrait(tenantSlug);
  return impactDoughnut(portrait?.dimensions ?? [], projections, baseline);
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
  return `${tenantName}'s doughnut, analysis baseline and modeled policy scenario`;
}

/**
 * The chart's caption, visible next to it: which wedges improve, worsen, or
 * are mixed, which change size, and why a quantified one does not. On the
 * canvas direction is colour — green and red that many colour-blind readers
 * cannot tell apart — so the same information is given here in words for
 * everyone, sighted or not. Sizes are judged per wedgeOutcome, the same rule
 * as the impacts table; dimensions republished since the analysis ran are
 * named instead, as today's size and the projection then are not one
 * comparison. The impacts table below carries the detail.
 */
export function impactsSummary(
  dims: ImpactDimension[],
  projections: DimensionProjection[],
  republished: string[] = [],
): string {
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

  const bySlug = new Map(projections.map(p => [p.dimension_slug, safePolicyProjection(p)]));
  const quantified = dims.filter((d) => d.alternate !== null);
  const byOutcome = new Map<WedgeOutcome | 'republished', string[]>();
  for (const d of quantified) {
    const key = republished.includes(d.name) ? 'republished' : (wedgeOutcome(bySlug.get(d.slug)) ?? 'unmoved');
    byOutcome.set(key, [...(byOutcome.get(key) ?? []), d.name]);
  }
  const say = (key: WedgeOutcome | 'republished', one: string, many: string, rest: string) => {
    const names = byOutcome.get(key);
    if (names?.length) parts.push(`${list(names)} ${names.length === 1 ? one : many}${rest}`);
  };
  const resized = byOutcome.get('resized');
  if (resized?.length) parts.push(`Wedge size changes for ${list(resized)}.`);
  say('worse_indicator', 'keeps', 'keep', ' the same size: a dimension is drawn at its worst indicator, which this policy does not change.');
  say('display_range', 'stays', 'stay', ' at the edge of the chart: beyond its range now and with this policy.');
  say('too_small', 'changes', 'change', ' by less than one step on the chart.');
  say('unmoved', 'keeps', 'keep', ' the same size.');
  say('republished', 'was', 'were', ' republished since: the chart retains the analysis baseline rather than mixing it with newer measurements.');

  const directionOnly = improves.length + worsens.length + mixed.length - quantified.length;
  if (!quantified.length) parts.push('No impact was quantified, so wedges change colour but not size.');
  else if (directionOnly > 0) parts.push('Other impacts are direction only.');
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
  /** Consistency warnings that still matter when a numerical change was retained. */
  warnings?: string[];
}

export interface ImpactGroup {
  /** Framework slug; the row anchor is `impact-{slug}`, the doughnut's wedge target. */
  slug: string;
  name: string;
  /** The dimension's overall direction ("mixed" when its impacts disagree; "none" when no effect). */
  direction: ImpactDirection;
  currentViz: number | null;
  projectedViz: number | null;
  /**
   * What the quantified impacts do to the wedge (wedgeOutcome): the page
   * explains an unmoved wedge rather than leave a quantified impact looking
   * like it did nothing. Null when nothing was quantified.
   */
  wedge: WedgeOutcome | null;
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
  const bySlug = new Map(projections.map(p => [p.dimension_slug, safePolicyProjection(p)]));
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
        name: result.portrait_baseline?.dimensions.find(d=>d.slug===slug)?.name ?? dimensionName(slug),
        direction: p?.direction ?? 'none',
        currentViz: p?.current_viz ?? null,
        projectedViz: p?.projected_viz ?? null,
        wedge: wedgeOutcome(p),
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
  // Reasons are stored per dimension; keep the ones about this indicator
  // (they quote its name) plus the dimension-wide ones (which quote nothing).
  const reasons = p?.unquantified_reasons ?? [];
  const relevant = reasons.filter((r) => r.includes(`“${impact.indicator}”`) || !r.includes('“'));
  if (change) return { impact, change, unquantified: [], warnings: relevant };
  return { impact, change: null, unquantified: relevant.length ? relevant : reasons };
}
