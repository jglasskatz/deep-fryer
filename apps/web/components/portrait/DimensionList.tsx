'use client';

import Link from 'next/link';
import { useId, type MouseEvent } from 'react';
import type { Ring } from '@deep-fryer/core';
import { statusLabel, type DoughnutDimension } from '@/components/doughnut/Doughnut';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import { statusDotClass } from './status';

/** One ring's group in the list, social foundation first (the inner ring). */
export interface DimensionRing {
  ring: Ring;
  /** The ring's name in the reader's language. */
  label: string;
  dims: DoughnutDimension[];
}

/**
 * The visible list of dimensions (SPEC-v6 §2.1): every dimension as a row of
 * at least 44 px with its name, its status in words and its headline value,
 * grouped by ring. On a phone the canvas is ~300 px wide — its labels are
 * unreadable and a wedge is about 29 px across — so this list, not the
 * canvas, is the way in.
 *
 * Two behaviours, chosen by the caller:
 * - Selecting in place (the portrait's core view, SPEC-v7 §2), with
 *   `onPick`: each row is a real link to `?dim=<slug>` (so it works without
 *   JavaScript, opens in a new tab, and can be copied), and a plain click
 *   selects the dimension in the panel instead of loading the page. The
 *   selected row carries aria-current="true" and a visible frame.
 * - Navigating, without `onPick`: each row links to the dimension's page.
 */
export function DimensionList({
  title,
  intro,
  rings,
  level,
  hrefFor,
  selected = null,
  onPick,
}: {
  /** The list's heading ("Explore the dimensions"). */
  title: string;
  /** A line under the heading, or nothing. */
  intro?: string;
  rings: readonly DimensionRing[];
  /** The doughnut's status words. */
  level: DoughnutLabels['level'];
  /** Where a row links: the page with `?dim=` when selecting in place, the dimension's page otherwise. */
  hrefFor: (slug: string) => string;
  /** The selected dimension's slug, when selecting in place. */
  selected?: string | null;
  /** Select in place: called for every click on a row; the caller decides whether to keep the link's own behaviour. */
  onPick?: (slug: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const id = useId();
  const row = 'flex min-h-11 items-center gap-3 rounded-lg border bg-white px-3 py-2 hover:bg-black/5';

  return (
    <nav aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {intro ? <p className="mt-1 text-sm text-[color:var(--color-muted)]">{intro}</p> : null}
      {rings.map(({ ring, label, dims }) => (
        <section key={ring} aria-labelledby={`${id}-${ring}`} className="mt-6">
          <h3
            id={`${id}-${ring}`}
            className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]"
          >
            {label}
          </h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {dims.map((d) => {
              const isSelected = onPick !== undefined && d.slug === selected;
              const content = (
                <>
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(d.viz_level)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d.name}</span>
                    <span className="block text-sm text-[color:var(--color-muted)]">
                      {statusLabel(d.viz_level, level)}
                      {d.value ? (
                        <>
                          {' · '}
                          {/* Formatted the English way, with research-entered units. */}
                          <span lang="en">{d.value}</span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {/* "›" is a bidi-mirrored character: right-to-left pages
                      draw it as "‹" without help. */}
                  <span aria-hidden className="shrink-0 text-[color:var(--color-muted)]">
                    ›
                  </span>
                </>
              );
              return (
                <li key={d.slug}>
                  {onPick ? (
                    // A plain <a>, not next/link: a plain click is handled in
                    // place (no route change at all), and anything else —
                    // a new tab, no JavaScript — is an ordinary page load of
                    // ?dim=, which the server renders with the panel filled.
                    <a
                      href={hrefFor(d.slug)}
                      onClick={(event) => onPick(d.slug, event)}
                      aria-current={isSelected ? 'true' : undefined}
                      // The selected row's frame is twice as heavy and in the
                      // canvas's selection blue; aria-current says the same
                      // to assistive technology.
                      className={`${row} ${isSelected ? 'border-blue-700 ring-1 ring-blue-700' : 'border-black/10'}`}
                    >
                      {content}
                    </a>
                  ) : (
                    // No prefetch: 21 links in view at once would each fetch
                    // a dimension page the reader may never open.
                    <Link href={hrefFor(d.slug)} prefetch={false} className={`${row} border-black/10`}>
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
