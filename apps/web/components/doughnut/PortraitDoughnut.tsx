'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Doughnut, statusLabel, type DoughnutDimension } from './Doughnut';
import { formatIndicatorValue } from '@deep-fryer/core';
import { DimensionList, type DimensionRing } from '@/components/portrait/DimensionList';
import { PortraitCoreView, type PortraitPanelConfig } from '@/components/portrait/PortraitCoreView';
import { fmt } from '@/lib/i18n/format';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import type { PublishedDimension } from '@/lib/portrait';

/** The visible list's own words (SPEC-v6 §2.1), from the page's catalog. */
export interface ExploreLabels {
  /** "Explore the dimensions". */
  title: string;
  /** What a dimension page holds; left out where it would promise a feature the portrait has off. */
  intro?: string;
  /** A line under the chart (how it works, or the demo's notice). */
  hint?: string;
}

/**
 * Client wrapper: renders the published portrait. A segment click either
 * fills the detail panel (the portrait's core view) or navigates to the
 * dimension drilldown (everywhere else).
 *
 * The core view (SPEC-v7 §2), when the page passes `panel`: the doughnut,
 * the detail panel beside it, and the visible list, all selecting in place —
 * components/portrait/PortraitCoreView.tsx. Only the portrait's own page
 * uses it; an embed (absolute linkBase) never does, even when given a panel,
 * because the host page fixes the iframe's height and a click there opens
 * the full portrait in a new tab.
 *
 * Accessibility (SPEC-v3 §4.2, NYC Local Law 26 / WCAG 2.1 AA): the canvas is
 * a pointer-only control, so it carries a generated text summary and is
 * followed by a list of real links to every dimension. The canvas is never
 * the only route to the data.
 *
 * Forms of that list:
 * - Visible (SPEC-v6 §2.1), when the page passes `explore`: on a phone the
 *   canvas is ~300 px wide, its labels are unreadable and a wedge is about
 *   29 px across, so a tap easily lands on the neighbouring one; the list is
 *   the way in — every dimension as a 44 px row with its name, its status in
 *   words, and its headline value, grouped by ring
 *   (components/portrait/DimensionList.tsx). With the panel its rows select
 *   in place (links to `?dim=`); without it they link to the dimension pages.
 * - Visually hidden until keyboard focus enters it (always read by screen
 *   readers), everywhere else: the iframe embed, whose height the host page
 *   fixes, and small multiples such as the family comparison, where each
 *   chart's card links to the full portrait. An embed (absolute linkBase)
 *   always gets this form.
 */
export function PortraitDoughnut({
  tenantSlug,
  tenantName,
  dimensions,
  size = 720,
  linkBase,
  labels,
  explore,
  panel,
}: {
  tenantSlug: string;
  /** Used in the accessible summary ("Manhattan: 9 of 21 dimensions outside…"). */
  tenantName?: string;
  dimensions: PublishedDimension[];
  size?: number;
  /** Defaults to /{tenant}/dim; localized pages pass /{locale}/{tenant}/dim, embeds an absolute URL. */
  linkBase?: string;
  /** Dimension names arrive already translated; these are the chart's own words. */
  labels: DoughnutLabels;
  /** Show the list of dimensions under the chart, with this heading (see above). */
  explore?: ExploreLabels;
  /**
   * The detail panel (SPEC-v7 §2), opt-in: the portrait's front page passes
   * it; the family comparison's small multiples and embeds do not.
   */
  panel?: PortraitPanelConfig;
}) {
  const router = useRouter();
  const embedded = Boolean(linkBase?.startsWith('http'));

  const { social, ecological } = useMemo(() => {
    const social: DoughnutDimension[] = [];
    const ecological: DoughnutDimension[] = [];
    for (const d of [...dimensions].sort((a, b) => a.display_order - b.display_order)) {
      const first = d.data.indicators[0];
      const entry: DoughnutDimension = {
        ring: d.ring,
        slug: d.slug,
        name: d.data.name,
        viz_level: d.viz_level,
        indicator: first?.name,
        value:
          first?.value === null || first?.value === undefined
            ? undefined
            : formatIndicatorValue(first.value, first.unit),
        year: first?.year ?? undefined,
        source: first?.source || undefined,
      };
      (d.ring === 'social' ? social : ecological).push(entry);
    }
    return { social, ecological };
  }, [dimensions]);

  const handleSelect = useCallback(
    (dim: DoughnutDimension | null) => {
      if (!dim) return;
      const href = linkBase ? `${linkBase}/${dim.slug}` : `/${tenantSlug}/dim/${dim.slug}`;
      if (linkBase?.startsWith('http')) {
        window.open(href, '_blank', 'noopener');
      } else {
        router.push(href);
      }
    },
    [router, tenantSlug, linkBase],
  );

  const hrefFor = (slug: string) =>
    linkBase ? `${linkBase}/${slug}` : `/${tenantSlug}/dim/${slug}`;
  const all = [...social, ...ecological];
  const outside = all.filter((d) => d.viz_level !== null && d.viz_level > 0).length;
  const unknown = all.filter((d) => d.viz_level === null).length;
  /** Both lists' groups, social foundation first (the inner ring). */
  const rings: readonly DimensionRing[] = [
    { ring: 'social', label: labels.social, dims: social },
    { ring: 'ecological', label: labels.ecological, dims: ecological },
  ];
  const summary = fmt(unknown ? labels.summaryWithGaps : labels.summary, {
    name: tenantName ?? labels.portrait,
    outside,
    total: all.length,
    gaps: unknown,
  });

  if (panel && !embedded) {
    return (
      <PortraitCoreView
        social={social}
        ecological={ecological}
        rings={rings}
        summary={summary}
        labels={labels}
        list={{
          title: explore?.title ?? fmt(labels.dimensionsOf, { name: tenantName ?? labels.portrait }),
          intro: explore?.intro,
        }}
        hint={explore?.hint}
        panel={panel}
        size={size}
        fullHref={hrefFor}
      />
    );
  }

  return (
    <div className="w-full" style={{ maxWidth: size }}>
      <Doughnut
        social={social}
        ecological={ecological}
        size={size}
        onSelect={handleSelect}
        ariaLabel={summary}
        labels={labels}
      />
      {explore && !embedded ? (
        <>
          {explore.hint ? (
            <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">{explore.hint}</p>
          ) : null}
          <div className="mt-10">
            <DimensionList
              title={explore.title}
              intro={explore.intro}
              rings={rings}
              level={labels.level}
              hrefFor={hrefFor}
            />
          </div>
        </>
      ) : (
        <nav
          aria-label={fmt(labels.dimensionsOf, { name: tenantName ?? labels.portrait })}
          className="sr-only focus-within:not-sr-only focus-within:mt-3 focus-within:rounded focus-within:border focus-within:border-black/15 focus-within:p-3"
        >
          {rings.map(({ ring, label, dims }) => (
            <div key={ring}>
              <h3 className="text-xs font-semibold uppercase tracking-wide">{label}</h3>
              <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                {dims.map((d) => (
                  <li key={d.slug}>
                    <a
                      className="underline"
                      href={hrefFor(d.slug)}
                      target={embedded ? '_blank' : undefined}
                      rel={embedded ? 'noopener noreferrer' : undefined}
                    >
                      {d.name}
                    </a>
                    {`: ${statusLabel(d.viz_level, labels.level)}${d.value ? ` — ${d.value}` : ''}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
