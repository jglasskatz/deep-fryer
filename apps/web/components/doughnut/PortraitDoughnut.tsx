'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo } from 'react';
import { Doughnut, statusLabel, type DoughnutDimension } from './Doughnut';
import { formatIndicatorValue } from '@deep-fryer/core';
import { fmt } from '@/lib/i18n/format';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import type { PublishedDimension } from '@/lib/portrait';

/**
 * The status dot beside a dimension in the visible list: the doughnut's own
 * reading of viz_level (green inside the safe space, amber just past a
 * boundary, red well past it, grey without data). Decoration only — the
 * status is always written out next to it, so colour never carries meaning
 * on its own (WCAG 1.4.1). Palette hues, so dark mode remaps them.
 */
function statusDotClass(level: number | null): string {
  if (level === null || Number.isNaN(level)) return 'bg-gray-400';
  if (level <= 0) return 'bg-green-600';
  if (level <= 50) return 'bg-amber-500';
  return 'bg-red-600';
}

/** The visible list's own words (SPEC-v6 §2.1), from the page's catalog. */
export interface ExploreLabels {
  /** "Explore the dimensions". */
  title: string;
  /** What a dimension page holds. */
  intro: string;
  /** How the chart works, shown between the chart and the list. */
  hint?: string;
}

/**
 * Client wrapper: renders the published portrait and navigates to the
 * dimension drilldown on segment click.
 *
 * Accessibility (SPEC-v3 §4.2, NYC Local Law 26 / WCAG 2.1 AA): the canvas is
 * a pointer-only control, so it carries a generated text summary and is
 * followed by a list of real links to every drilldown. The canvas is never
 * the only route to the data.
 *
 * Two forms of that list:
 * - Visible (SPEC-v6 §2.1), when the page passes `explore`: on a phone the
 *   canvas is ~300 px wide, its labels are unreadable and a tap lands on the
 *   neighbouring wedge, so the list is the way in — every dimension as a
 *   44 px row with its name, its status in words, and its headline value,
 *   grouped by ring. The portrait's front page uses this.
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
}) {
  const router = useRouter();
  const exploreId = useId();
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
  const rings = [
    { ring: 'social', label: labels.social, dims: social },
    { ring: 'ecological', label: labels.ecological, dims: ecological },
  ] as const;
  const summary = fmt(unknown ? labels.summaryWithGaps : labels.summary, {
    name: tenantName ?? labels.portrait,
    outside,
    total: all.length,
    gaps: unknown,
  });

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
          <nav aria-labelledby={exploreId} className="mt-10">
            <h2 id={exploreId} className="text-xl font-semibold">
              {explore.title}
            </h2>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">{explore.intro}</p>
            {rings.map(({ ring, label, dims }) => (
              <section key={ring} aria-labelledby={`${exploreId}-${ring}`} className="mt-6">
                <h3
                  id={`${exploreId}-${ring}`}
                  className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]"
                >
                  {label}
                </h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {dims.map((d) => (
                    <li key={d.slug}>
                      {/* No prefetch: 21 links in view at once would each
                          fetch a dimension page the reader may never open. */}
                      <Link
                        href={hrefFor(d.slug)}
                        prefetch={false}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-2 hover:bg-black/5"
                      >
                        <span
                          aria-hidden
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(d.viz_level)}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{d.name}</span>
                          <span className="block text-sm text-[color:var(--color-muted)]">
                            {statusLabel(d.viz_level, labels.level)}
                            {d.value ? (
                              <>
                                {' · '}
                                {/* Formatted the English way, with research-entered units. */}
                                <span lang="en">{d.value}</span>
                              </>
                            ) : null}
                          </span>
                        </span>
                        {/* "›" is a bidi-mirrored character: right-to-left
                            pages draw it as "‹" without help. */}
                        <span aria-hidden className="shrink-0 text-[color:var(--color-muted)]">
                          ›
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
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
