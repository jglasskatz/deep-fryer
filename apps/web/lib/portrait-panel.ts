import type { ActionSourceView } from '@/components/portrait/ActionSourceLinks';
import 'server-only';
import {
  formatIndicatorValue,
  listingsForDimension,
  telHref,
  type Indicator,
  type InvolvementKind,
  type InvolvementListingView,
  type Ring,
} from '@deep-fryer/core';
import { selectedSlugFrom } from '@/components/portrait/selection';
import { dimensionLabel, scaleLabel } from './i18n/content';
import { fmtPlural } from './i18n/format';
import type { Messages } from './i18n/messages/en';
import { frameworkSlugOf } from './policy';
import type { PublishedDimension } from './portrait';
import { safeHref } from './safe-url';

/**
 * The detail panel beside the doughnut (SPEC-v7 §2) — the Santa Cruz core
 * view, where selecting a dimension shows its data, evidence and ways in
 * without leaving the page.
 *
 * The panel is a client component (it changes in place when a reader picks
 * another dimension), but everything it shows is shaped here, on the server,
 * into plain serializable data:
 *
 * - URLs are decided where the secrets and rules are: evidence snapshots
 *   resolve against the deployment's public evidence base (S3_PUBLIC_URL is
 *   server-only), and research-entered source links pass through safeHref so
 *   a `javascript:` link can never reach the page (SPEC-v3 §2.3).
 * - Values are formatted once, the one way the dimension page formats them
 *   (a number never without its unit).
 * - Feature content is decided here too: with the `involvement` feature off
 *   the view carries no listings at all (null), so the client cannot render
 *   what the portrait has turned off.
 *
 * The client receives one view per published dimension, so selecting another
 * one is instant; the page reads `?dim=` and renders that dimension's panel
 * on the server, so a shared link and a no-JS reader see the same thing.
 */

/** One indicator, as the panel shows it. Strings are research text (English) unless noted. */
export interface PanelIndicator {
  name: string;
  /** Formatted with its unit; null when there is no value ("No data" in the reader's language). */
  value: string | null;
  year: number | null;
  /** Formatted with its unit; null when no target is set. */
  target: string | null;
  /** The geographic scale in the reader's language, or null. */
  scale: string | null;
  /** The source's name; null when the research named none. */
  source: string | null;
  /** The source link, only when it is http(s); otherwise the name renders as plain text. */
  sourceHref: string | null;
  snapshot: PanelSnapshot | null;
}

/** The evidence snapshot captured with an indicator's value (SPEC.md §8). */
export interface PanelSnapshot {
  /** Public URL of the snapshot image. */
  src: string;
  /** Capture date, YYYY-MM-DD. */
  capturedOn: string;
  /** Public URL of the archived original document, when one was saved. */
  pdfHref: string | null;
}

/** A data gap, a first-class finding (SPEC.md §8). */
export interface PanelGap {
  reason: string;
  /** The geographic scales searched, in the reader's language. */
  scales: string[];
}

/** An involvement listing, reduced to what the compact panel list shows. */
export interface PanelListing {
  id: string;
  /** Staff-entered (English). */
  name: string;
  /** Staff-entered (English). */
  description: string;
  /** The listing's website, only when it is http(s). */
  href: string | null;
  phone: string | null;
  /** tel: link for the phone number, when it has one that can be dialled. */
  tel: string | null;
  kind: InvolvementKind;
  /** Serves every dimension (no dimensions named); marked so it is not taken for something specific. */
  general: boolean;
}

export interface PortraitPanelView {
  slug: string;
  /** The dimension's name in the reader's language (the published name when the portrait renamed it). */
  name: string;
  ring: Ring;
  /** viz_level (-100…150), for the status in words; null without data. */
  level: number | null;
  /** The context paragraph (research text), or null. */
  context: string | null;
  indicators: PanelIndicator[];
  gaps: PanelGap[];
  /** The dimension's curated short actions ("What you can do", research text). Core: always present. */
  actions: string[];
  actionSources?: ActionSourceView[];
  /**
   * The first PANEL_LISTING_LIMIT published involvement listings for this
   * dimension (its own, then those for every dimension), or null when the
   * `involvement` feature is off.
   */
  listings: PanelListing[] | null;
  /**
   * The listings the panel leaves to the full dimension page, with the line
   * that links there in the reader's language ("12 more ways to get involved
   * on the full page"); null when the panel shows them all.
   */
  moreListings: { count: number; label: string } | null;
}

/**
 * How many listings the panel shows. The panel is a summary beside the
 * doughnut (on a phone, between it and the dimension list): a dozen listings
 * would push the list off the screen, and the full page has every one, with
 * its checked date. Like the Santa Cruz panel's short "ways to get involved".
 */
export const PANEL_LISTING_LIMIT = 3;

export interface PanelOptions {
  /** The reader's catalog: framework dimension names and geographic scales. */
  m: Messages;
  /** The reader's locale, for plural forms (the "more listings" line). */
  locale: string;
  /** Public URL of an evidence object (lib/data.ts evidenceUrl, bound to the portrait). */
  evidenceUrl: (storagePath: string) => string;
  /**
   * Every published listing of the portrait when the `involvement` feature is
   * on (an empty array when it has none); null when the feature is off.
   */
  listings: InvolvementListingView[] | null;
}

const hasText = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim() !== '';

function panelIndicator(ind: Indicator, m: Messages, evidenceUrl: (path: string) => string): PanelIndicator {
  // The same tests the dimension page applies: an empty string is no value,
  // and so no target (formatting '' would print the English "Data needed").
  const hasValue = ind.value !== null && ind.value !== '';
  const hasTarget = ind.target !== null && ind.target !== '';
  const source = hasText(ind.source) ? ind.source : null;
  const evidence = ind.evidence;
  return {
    name: ind.name,
    value: hasValue ? formatIndicatorValue(ind.value, ind.unit) : null,
    year: ind.year ?? null,
    target: hasTarget ? formatIndicatorValue(ind.target, ind.unit) : null,
    scale: ind.geographic_scale ? scaleLabel(m, ind.geographic_scale) : null,
    source,
    // A link needs a name to carry it; a URL without one stays unshown, as on
    // the dimension page.
    sourceHref: source ? (safeHref(ind.source_url) ?? null) : null,
    // Evidence paths are written by the worker under the portrait's evidence
    // base (never research text), and the base may be relative (/evidence/…
    // in local dev), so they are resolved, not filtered through safeHref.
    snapshot: evidence?.snapshot_path
      ? {
          src: evidenceUrl(evidence.snapshot_path),
          capturedOn: evidence.captured_at.slice(0, 10),
          pdfHref: evidence.pdf_path ? evidenceUrl(evidence.pdf_path) : null,
        }
      : null,
  };
}

function panelListing(l: InvolvementListingView): PanelListing {
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    href: safeHref(l.url) ?? null,
    phone: l.phone,
    tel: telHref(l.phone),
    kind: l.kind,
    general: l.dimension_slugs.length === 0,
  };
}

/** The panel's view of one published dimension. */
export function portraitPanelView(
  dim: PublishedDimension,
  { m, locale, evidenceUrl, listings }: PanelOptions,
): PortraitPanelView {
  const data = dim.data;
  // Listings and submissions are keyed by framework slug; a renamed or
  // custom dimension maps onto one the same way the dimension page does.
  const all = listings === null ? null : listingsForDimension(listings, frameworkSlugOf(dim)).map(panelListing);
  const more = all ? all.length - PANEL_LISTING_LIMIT : 0;
  return {
    slug: dim.slug,
    name: dimensionLabel(m, dim.slug, data.name),
    ring: dim.ring,
    level: dim.viz_level,
    context: hasText(data.context) ? data.context : null,
    indicators: data.indicators.map((ind) => panelIndicator(ind, m, evidenceUrl)),
    gaps: (data.gaps ?? []).map((g) => ({ reason: g.reason, scales: g.scales_tried.map((s) => scaleLabel(m, s)) })),
    actions: data.actions.filter(hasText),
    actionSources: (data.action_sources ?? []).map(action => ({ text: action.text, sourceHref: safeHref(action.source_url) ?? null, snapshotHref: evidenceUrl(action.evidence.snapshot_path), pdfHref: action.evidence.pdf_path ? evidenceUrl(action.evidence.pdf_path) : null })),
    listings: all && all.slice(0, PANEL_LISTING_LIMIT),
    moreListings: more > 0 ? { count: more, label: fmtPlural(locale, m.portrait.moreListings, more) } : null,
  };
}

/** Every published dimension's view, in the doughnut's order. */
export function portraitPanelViews(dimensions: PublishedDimension[], options: PanelOptions): PortraitPanelView[] {
  return [...dimensions].sort((a, b) => a.display_order - b.display_order).map((d) => portraitPanelView(d, options));
}

/**
 * The view `?dim=` selects, or null for an unknown value (the panel's empty
 * state), using the same rule as the client (components/portrait/selection.ts).
 */
export function selectedPanelView(
  views: PortraitPanelView[],
  param: string | readonly string[] | null | undefined,
): PortraitPanelView | null {
  const slug = selectedSlugFrom(
    views.map((v) => v.slug),
    param,
  );
  return slug === null ? null : (views.find((v) => v.slug === slug) ?? null);
}

/**
 * The panel's own words, as a plain serializable object (the panel is a
 * client component; the server picks the reader's catalog and passes only
 * these strings down, as lib/i18n/doughnut.ts does for the chart).
 */
export interface PanelLabels {
  portrait: Pick<
    Messages['portrait'],
    | 'panelEmpty'
    | 'panelClose'
    | 'panelSelected'
    | 'openFull'
    | 'openFullDiscussion'
    | 'legendTitle'
    | 'legendSafe'
    | 'legendShortfall'
    | 'legendOvershoot'
    | 'legendNoData'
  >;
  dimension: Pick<
    Messages['dimension'],
    | 'target'
    | 'noTarget'
    | 'scaleData'
    | 'source'
    | 'snapshotAlt'
    | 'snapshotCaptured'
    | 'originalDocument'
    | 'dataGap'
    | 'searchedAt'
    | 'whatYouCanDo'
  >;
  involvement: Pick<
    Messages['involvement'],
    'title' | 'kind' | 'call' | 'forEveryDimension' | 'contentInEnglish' | 'none'
  >;
  noData: string;
}

export function panelLabels(m: Messages): PanelLabels {
  const p = m.portrait;
  const d = m.dimension;
  const i = m.involvement;
  return {
    portrait: {
      panelEmpty: p.panelEmpty,
      panelClose: p.panelClose,
      panelSelected: p.panelSelected,
      openFull: p.openFull,
      openFullDiscussion: p.openFullDiscussion,
      legendTitle: p.legendTitle,
      legendSafe: p.legendSafe,
      legendShortfall: p.legendShortfall,
      legendOvershoot: p.legendOvershoot,
      legendNoData: p.legendNoData,
    },
    dimension: {
      target: d.target,
      noTarget: d.noTarget,
      scaleData: d.scaleData,
      source: d.source,
      snapshotAlt: d.snapshotAlt,
      snapshotCaptured: d.snapshotCaptured,
      originalDocument: d.originalDocument,
      dataGap: d.dataGap,
      searchedAt: d.searchedAt,
      whatYouCanDo: d.whatYouCanDo,
    },
    involvement: {
      title: i.title,
      kind: i.kind,
      call: i.call,
      forEveryDimension: i.forEveryDimension,
      contentInEnglish: i.contentInEnglish,
      none: i.none,
    },
    noData: m.common.noData,
  };
}
