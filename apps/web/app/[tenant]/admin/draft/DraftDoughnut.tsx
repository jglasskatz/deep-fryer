'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Doughnut, statusLabel, type DoughnutDimension } from '@/components/doughnut/Doughnut';
import { statusDotClass } from '@/components/portrait/status';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';

/**
 * The watermark's colour, fixed in both themes: it lies on the canvas, which
 * is a picture painted on its own white background whatever the page's theme
 * (components/portrait/status.ts DOUGHNUT_COLOURS), so a palette class — which
 * dark mode turns light — would all but vanish there. Red 700, translucent
 * enough for the wedges to read through it.
 */
const WATERMARK_COLOUR = 'rgba(185, 28, 28, 0.28)';

/** One wedge of the draft, shaped on the server (page.tsx). */
export interface DraftWedge extends DoughnutDimension {
  /** Where the wedge and its row lead: the dimension's review card, the run page, or its editor. */
  href: string;
  /** Where the wedge's data comes from, in words ("From this run, not yet approved · 2 flagged"). */
  note: string;
}

/**
 * The draft doughnut's chart and list (staff only): the public doughnut's own
 * canvas and status words, with a DRAFT watermark across the chart, and every
 * wedge and row leading to where its data is reviewed instead of to a public
 * page. The figure is described by the page's draft notice (`describedBy`),
 * and the canvas's text alternative starts by saying it is a draft.
 *
 * The page refreshes itself while a run is in progress
 * (components/admin/AutoRefresh.tsx), handing this component new arrays every
 * few seconds. The wedges are keyed by their content, so the canvas is
 * redrawn only when a wedge actually changed — not on every refresh.
 */
export function DraftDoughnut({
  social,
  ecological,
  labels,
  summary,
  describedBy,
}: {
  social: DraftWedge[];
  ecological: DraftWedge[];
  labels: DoughnutLabels;
  /** The canvas's text alternative. */
  summary: string;
  /** The id of the page's draft notice. */
  describedBy: string;
}) {
  const router = useRouter();
  const key = JSON.stringify([social, ecological]);
  const wedges = useMemo(() => {
    const [s, e] = JSON.parse(key) as [DraftWedge[], DraftWedge[]];
    return { social: s, ecological: e, hrefs: new Map([...s, ...e].map((w) => [`${w.ring}:${w.slug}`, w.href])) };
  }, [key]);

  const onSelect = useCallback(
    (dim: DoughnutDimension | null) => {
      const href = dim ? wedges.hrefs.get(`${dim.ring}:${dim.slug}`) : undefined;
      if (href) router.push(href);
    },
    [router, wedges],
  );

  const rings = [
    { ring: 'social' as const, label: labels.social, dims: wedges.social },
    { ring: 'ecological' as const, label: labels.ecological, dims: wedges.ecological },
  ];

  return (
    <>
      <figure aria-describedby={describedBy} className="relative mx-auto w-full max-w-[640px]">
        <Doughnut
          social={wedges.social}
          ecological={wedges.ecological}
          size={640}
          onSelect={onSelect}
          ariaLabel={summary}
          labels={labels}
        />
        {/* The watermark: decoration over the canvas (clicks pass through to the wedges);
            the heading, the notice and the canvas's own name say "draft" in words. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span
            className="-rotate-[24deg] select-none text-[min(20vw,8rem)] font-black tracking-[0.2em]"
            style={{ color: WATERMARK_COLOUR }}
          >
            DRAFT
          </span>
        </div>
      </figure>

      <nav aria-labelledby="draft-list-heading" className="mt-10">
        <h2 id="draft-list-heading" className="text-xl font-semibold">
          Dimensions in this draft
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Each opens where its data is reviewed: the dimension&apos;s review card for this run&apos;s findings, or
          its page for what is published.
        </p>
        {rings.map(({ ring, label, dims }) => (
          <section key={ring} aria-labelledby={`draft-${ring}`} className="mt-6">
            <h3
              id={`draft-${ring}`}
              className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-muted)]"
            >
              {label}
            </h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {dims.map((d) => (
                <li key={d.slug}>
                  {/* No prefetch: two dozen links in view would each fetch a staff page. */}
                  <Link
                    href={d.href}
                    prefetch={false}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-black/10 bg-white px-3 py-2 hover:bg-black/5"
                  >
                    <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(d.viz_level)}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{d.name}</span>
                      <span className="block text-sm text-[color:var(--color-muted)]">
                        {statusLabel(d.viz_level, labels.level)}
                        {d.value ? ` · ${d.value}` : ''}
                      </span>
                      <span className="block text-xs text-[color:var(--color-muted)]">{d.note}</span>
                    </span>
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
  );
}
