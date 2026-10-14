'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Doughnut, statusLabel, type DoughnutDimension } from './Doughnut';
import { formatIndicatorValue } from '@deep-fryer/core';
import type { PublishedDimension } from '@/lib/portrait';

/**
 * Client wrapper: renders the published portrait and navigates to the
 * dimension drilldown on segment click.
 *
 * Accessibility (SPEC-v3 §4.2, NYC Local Law 26 / WCAG 2.1 AA): the canvas is
 * a pointer-only control, so it carries a generated text summary and is
 * followed by a list of real links to every drilldown — visually hidden
 * until keyboard focus enters it, always read by screen readers. The canvas
 * is never the only route to the data.
 */
export function PortraitDoughnut({
  tenantSlug,
  tenantName,
  dimensions,
  size = 720,
  linkBase,
}: {
  tenantSlug: string;
  /** Used in the accessible summary ("Manhattan: 9 of 21 dimensions outside…"). */
  tenantName?: string;
  dimensions: PublishedDimension[];
  size?: number;
  /** Defaults to /{tenant}/dim; embeds pass an absolute URL instead. */
  linkBase?: string;
}) {
  const router = useRouter();

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
  const summary = `${tenantName ? `${tenantName} doughnut portrait` : 'Doughnut portrait'}: ${outside} of ${all.length} dimensions outside the safe and just space${unknown ? `, ${unknown} without data` : ''}. A list of links to each dimension follows.`;

  return (
    <div className="w-full" style={{ maxWidth: size }}>
      <Doughnut
        social={social}
        ecological={ecological}
        size={size}
        onSelect={handleSelect}
        ariaLabel={summary}
      />
      <nav
        aria-label={`${tenantName ?? 'Portrait'} dimensions`}
        className="sr-only focus-within:not-sr-only focus-within:mt-3 focus-within:rounded focus-within:border focus-within:border-black/15 focus-within:p-3"
      >
        {(
          [
            ['Social foundation', social],
            ['Ecological ceiling', ecological],
          ] as const
        ).map(([label, dims]) => (
          <div key={label}>
            <h3 className="text-xs font-semibold uppercase tracking-wide">{label}</h3>
            <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
              {dims.map((d) => (
                <li key={d.slug}>
                  <a
                    className="underline"
                    href={hrefFor(d.slug)}
                    target={linkBase?.startsWith('http') ? '_blank' : undefined}
                    rel={linkBase?.startsWith('http') ? 'noopener noreferrer' : undefined}
                  >
                    {d.name}
                  </a>
                  {`: ${statusLabel(d.viz_level)}${d.value ? ` — ${d.value}` : ''}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
