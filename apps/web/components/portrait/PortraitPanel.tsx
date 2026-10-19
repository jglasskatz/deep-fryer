'use client';

import Link from 'next/link';
import type { MouseEvent, Ref } from 'react';
import { statusLabel } from '@/components/doughnut/Doughnut';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import { fmt, rich } from '@/lib/i18n/format';
import type { PanelLabels, PortraitPanelView } from '@/lib/portrait-panel';
import { PANEL_ID } from './selection';
import { DOUGHNUT_COLOURS, statusDotClass } from './status';

/**
 * The detail panel beside the doughnut (SPEC-v7 §2), after the Santa Cruz
 * view's: select a dimension and the panel shows its status, each
 * indicator's value with year, target and scale, the context, the primary
 * source with its evidence snapshot inline, and the ways to get involved —
 * then a link to the full dimension page. With nothing selected it explains
 * how to read the doughnut, with the status legend.
 *
 * Presentational: the selection, the URL and focus are PortraitCoreView's.
 * Everything shown arrives shaped by lib/portrait-panel.ts (safe links,
 * formatted values, listings only when the involvement feature is on).
 *
 * Conventions, as on the dimension page:
 * - Chrome comes from the reader's catalog; research and staff text
 *   (indicator names, values with their units, context, sources, actions,
 *   listings) is marked lang="en" so screen readers pronounce it correctly
 *   and right-to-left pages isolate it.
 * - Logical properties only (ms/me/ps/pe, text-start), so Arabic and Urdu
 *   mirror correctly.
 * - Every control is at least 44 px tall; links inside a sentence are exempt
 *   as inline text (WCAG 2.5.8).
 */
export function PortraitPanel({
  view,
  labels,
  doughnut,
  headingId,
  headingRef,
  fullHref,
  closeHref,
  onClose,
  discussion,
  englishNote,
}: {
  /** The selected dimension, or null for the empty state. */
  view: PortraitPanelView | null;
  labels: PanelLabels;
  /** The chart's words: ring names and status words. */
  doughnut: DoughnutLabels;
  /** The heading's id: the region is labelled by it. */
  headingId: string;
  /** The heading, focusable (tabIndex -1) so selecting from the list can move focus to it. */
  headingRef: Ref<HTMLHeadingElement>;
  /** The full dimension page of a slug. */
  fullHref: (slug: string) => string;
  /** The page with nothing selected (the close control's no-JS link). */
  closeHref: string;
  onClose: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** The discussion feature is on: the full page's link says it has the discussion. */
  discussion: boolean;
  /** Say that listings are published in English (a reader of another language). */
  englishNote: boolean;
}) {
  const p = labels.portrait;
  const d = labels.dimension;
  const t = labels.involvement;

  return (
    <section
      id={PANEL_ID}
      aria-labelledby={headingId}
      // Clear of the sticky site header when a no-JS #panel link or a phone's
      // scrollIntoView lands here: 56 px, plus the family bar on family
      // portraits, plus the language notice on translated pages (up to four
      // lines of small text on a phone) — EmergencySections' ANCHOR, which
      // measured the same header. Generous on purpose: a heading a little low
      // is harmless, one under the header hides where focus went.
      className="scroll-mt-48 rounded-lg border border-black/10 bg-white p-4 sm:scroll-mt-36 sm:p-5"
    >
      {view ? (
        <>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
                {view.name}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-[color:var(--color-muted)]">
                <span>{view.ring === 'social' ? doughnut.social : doughnut.ecological}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass(view.level)}`} />
                  {statusLabel(view.level, doughnut.level)}
                </span>
              </p>
            </div>
            {/* A link to the page without ?dim= (so it works without
                JavaScript), handled in place when it can be. */}
            <a
              href={closeHref}
              onClick={onClose}
              className="-me-2 -mt-1 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded px-3 text-sm underline hover:bg-black/5"
            >
              {p.panelClose}
            </a>
          </div>

          {view.context ? (
            <p lang="en" className="mt-4 text-sm leading-relaxed">
              {view.context}
            </p>
          ) : null}

          {view.indicators.length > 0 || view.gaps.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {view.indicators.map((ind, i) => (
                <li key={i} className="rounded border border-black/10 p-3">
                  <h3 lang="en" className="text-sm font-semibold">
                    {ind.name}
                  </h3>
                  <p className="mt-1 text-xl font-bold">
                    {ind.value ? (
                      <bdi lang="en">{ind.value}</bdi>
                    ) : (
                      <span className="text-sm font-normal">{labels.noData}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                    {ind.year ? `${ind.year} · ` : ''}
                    {ind.target ? rich(d.target, { value: <bdi lang="en">{ind.target}</bdi> }) : d.noTarget}
                    {ind.scale ? ` · ${fmt(d.scaleData, { scale: ind.scale })}` : ''}
                  </p>
                  {ind.source ? (
                    <p className="mt-2 text-xs">
                      {rich(d.source, {
                        source: ind.sourceHref ? (
                          // A new tab: the reader keeps the doughnut and the
                          // panel where they were.
                          <a
                            lang="en"
                            className="underline"
                            href={ind.sourceHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {ind.source}
                          </a>
                        ) : (
                          <span lang="en">{ind.source}</span>
                        ),
                      })}
                    </p>
                  ) : null}
                  {ind.snapshot ? (
                    // The evidence promise (SPEC.md §8): what the source said
                    // when the value was taken, beside the value.
                    <figure className="mt-2">
                      <a href={ind.snapshot.src} target="_blank" rel="noopener noreferrer" className="inline-block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ind.snapshot.src}
                          alt={fmt(d.snapshotAlt, { name: ind.name, date: ind.snapshot.capturedOn })}
                          loading="lazy"
                          decoding="async"
                          className="max-h-40 max-w-full rounded border border-black/15"
                        />
                      </a>
                      <figcaption className="mt-1 text-xs text-[color:var(--color-muted)]">
                        {fmt(d.snapshotCaptured, { date: ind.snapshot.capturedOn })}
                        {ind.snapshot.pdfHref ? (
                          <>
                            {' · '}
                            <a
                              className="underline"
                              href={ind.snapshot.pdfHref}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {d.originalDocument}
                            </a>
                          </>
                        ) : null}
                      </figcaption>
                    </figure>
                  ) : null}
                </li>
              ))}
              {view.gaps.map((gap, i) => (
                <li key={`gap-${i}`} className="rounded border border-dashed border-black/25 bg-black/[0.02] p-3">
                  <h3 className="text-sm font-semibold">{d.dataGap}</h3>
                  <p lang="en" className="mt-1 text-xs">
                    {gap.reason}
                  </p>
                  {gap.scales.length > 0 ? (
                    <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                      {fmt(d.searchedAt, { scales: gap.scales.join(', ') })}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* The dimension's curated actions are core (the Santa Cruz panel's
              "ways to get involved"), shown whatever the features. */}
          {view.actions.length > 0 ? (
            <div className="mt-5">
              <h3 className="font-semibold">{d.whatYouCanDo}</h3>
              <ul lang="en" className="mt-2 list-disc space-y-1 ps-5 text-sm">
                {view.actions.map((action, i) => (
                  <li key={i}>{action}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Listings exist on the view only when the involvement feature is
              on. As on the dimension page, "no listings yet" is said only
              for a dimension with no actions either. */}
          {view.listings && (view.listings.length > 0 || view.actions.length === 0) ? (
            <div className="mt-5">
              <h3 className="font-semibold">{t.title}</h3>
              {view.listings.length === 0 ? (
                <p className="mt-1 text-sm text-[color:var(--color-muted)]">{t.none}</p>
              ) : (
                <>
                  {englishNote ? (
                    <p className="mt-1 text-xs text-[color:var(--color-muted)]">{t.contentInEnglish}</p>
                  ) : null}
                  {/* Compact: kind, name (linking to the listing's site),
                      a short description and the phone; the full page has
                      the cards with their checked dates. */}
                  <ul className="mt-2">
                    {view.listings.map((l) => (
                      <li key={l.id} className="border-t border-black/10 py-2.5 first:border-t-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded border border-black/15 px-1.5 py-0.5 font-medium">
                            {t.kind[l.kind]}
                          </span>
                          {l.general ? (
                            <span className="rounded border border-black/15 px-1.5 py-0.5">{t.forEveryDimension}</span>
                          ) : null}
                        </p>
                        <h4 lang="en" className="mt-1 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                          {l.href ? (
                            <a className="underline" href={l.href} target="_blank" rel="noopener noreferrer">
                              {l.name}
                            </a>
                          ) : (
                            l.name
                          )}
                        </h4>
                        <p lang="en" className="mt-0.5 line-clamp-3 break-words text-sm [overflow-wrap:anywhere]">
                          {l.description}
                        </p>
                        {l.tel && l.phone ? (
                          <p className="mt-1 text-sm">
                            {/* A control on its own line, not a link in a sentence: 44 px tall. */}
                            <a className="inline-flex min-h-11 items-center font-medium underline" href={l.tel}>
                              {/* One flex item: as separate items, "Call " and the number would each
                                  lose their edge whitespace (CSS flex layout), reading "Call311".
                                  Digits laid out left-to-right in every language. */}
                              <span>{rich(t.call, { phone: <span dir="ltr">{l.phone}</span> })}</span>
                            </a>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {view.moreListings ? (
                    <p className="mt-1 text-sm">
                      {/* The rest are on the full page's "How to get involved" section. */}
                      <Link href={`${fullHref(view.slug)}#get-involved`} prefetch={false} className="inline-flex min-h-11 items-center underline">
                        {view.moreListings.label}
                      </Link>
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <p className="mt-5 border-t border-black/10 pt-3">
            {/* No prefetch: most readers stay in the panel. */}
            <Link
              href={fullHref(view.slug)}
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-1 font-medium underline"
            >
              {discussion ? p.openFullDiscussion : p.openFull}
              <span aria-hidden>›</span>
            </Link>
          </p>
        </>
      ) : (
        <>
          <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold">
            {p.legendTitle}
          </h2>
          <p className="mt-2 text-sm">{p.panelEmpty}</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {(
              [
                // The ring itself: green between its dark-green borders.
                [
                  p.legendSafe,
                  { background: DOUGHNUT_COLOURS.ring, boxShadow: `inset 0 0 0 3px ${DOUGHNUT_COLOURS.ringEdge}` },
                ],
                [p.legendShortfall, { background: DOUGHNUT_COLOURS.beyond }],
                [p.legendOvershoot, { background: DOUGHNUT_COLOURS.beyond }],
                [p.legendNoData, { background: DOUGHNUT_COLOURS.noData }],
              ] as const
            ).map(([text, swatch]) => (
              <li key={text} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border border-black/15"
                  style={swatch}
                />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
