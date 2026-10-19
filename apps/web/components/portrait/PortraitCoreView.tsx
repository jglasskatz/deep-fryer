'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Doughnut, type DoughnutDimension } from '@/components/doughnut/Doughnut';
import type { DoughnutLabels } from '@/lib/i18n/doughnut';
import { fmt } from '@/lib/i18n/format';
import type { PanelLabels, PortraitPanelView } from '@/lib/portrait-panel';
import { DimensionList, type DimensionRing } from './DimensionList';
import { PortraitPanel } from './PortraitPanel';
import {
  DIM_PARAM,
  PANEL_ID,
  closedHref,
  dimensionHref,
  isPlainClick,
  selectedSlugFrom,
  urlWithSelection,
} from './selection';

/** What the portrait page passes to turn the detail panel on (all plain data, shaped on the server). */
export interface PortraitPanelConfig {
  /** One view per published dimension (lib/portrait-panel.ts). */
  views: PortraitPanelView[];
  /** The dimension `?dim=` selected when the server rendered the page, or null. */
  initial: string | null;
  labels: PanelLabels;
  /** The portrait page's own path in the reader's language (/{tenant} or /{locale}/{tenant}). */
  pageHref: string;
  /** The discussion feature is on: the full page's link mentions it. */
  discussion: boolean;
  /** The reader's language is not English: say that listings are published in English. */
  englishNote: boolean;
}

/** The list's own words (SPEC-v6 §2.1). */
export interface CoreListLabels {
  title: string;
  intro?: string;
}

/** Tailwind's `lg`: from here the panel sits beside the doughnut instead of under it. */
const BESIDE = '(min-width: 64rem)';

/**
 * Where the panel sticks beside the doughnut (lg and up), and how tall it may
 * be. The sticky site header is 56 px, plus the 40 px family bar on family
 * portraits, plus the language notice on translated pages (one or two lines
 * of small text at this width): about 145 px at most, so the panel sticks
 * 9rem (144 px) down — the same allowance as EmergencySections' ANCHOR at
 * this width. A wider language's third notice line would overlap only the
 * panel's own top padding, not its heading. The panel then takes the rest of
 * the window less a 1rem gap below, scrolling inside itself when taller.
 * On a page with no family bar or notice the gap above it is wider; that
 * costs nothing but space, where too small an offset hides the heading and
 * the Close link under the header.
 */
const STICKY = 'lg:sticky lg:top-36 lg:max-h-[calc(100vh_-_10rem)] lg:overflow-y-auto';

/**
 * The portrait's core view (SPEC-v7 §2), after the Santa Cruz repository's
 * main screen: the doughnut, the detail panel beside it (below it on a
 * phone), and the dimension list. Selecting a dimension — a click or tap on
 * the canvas, a row in the list, or `?dim=<slug>` in the URL — fills the
 * panel without leaving the page.
 *
 * The selection:
 * - starts as the server rendered it (the page reads `?dim=` into
 *   `initial`, and the router's search params on the server are the same
 *   request's), so the first paint, a shared link and a reader without
 *   JavaScript agree;
 * - changes in place on a canvas click or a plain click on a list row, and
 *   the URL follows through history.replaceState — every published
 *   dimension's view is already here, so there is no server round trip, and
 *   no history entry per click;
 * - follows the URL when it changes underneath (Back to a cached copy of the
 *   page, a link elsewhere on the site to `?dim=`): Next.js reports
 *   replaceState and history traversal through useSearchParams.
 *
 * Accessibility: the panel is a region labelled by its heading; each
 * selection is announced politely ("Showing Housing"); choosing from the
 * list (or closing) moves focus to the panel's heading, and on a phone,
 * where the panel is above the list, scrolls it into view. A canvas
 * selection does not move focus: the pointer is on the doughnut, and the
 * panel is beside or just below it.
 */
export function PortraitCoreView({
  social,
  ecological,
  rings,
  summary,
  labels,
  list,
  hint,
  panel,
  size,
  fullHref,
}: {
  social: DoughnutDimension[];
  ecological: DoughnutDimension[];
  rings: readonly DimensionRing[];
  /** The canvas's text alternative. */
  summary: string;
  labels: DoughnutLabels;
  list: CoreListLabels;
  /** A line under the chart (the demo's notice), or nothing. */
  hint?: string;
  panel: PortraitPanelConfig;
  size: number;
  /** The full dimension page of a slug. */
  fullHref: (slug: string) => string;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // The panel's wrapper, which from lg is its own scroll container.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { views, labels: panelLabels, pageHref } = panel;

  const bySlug = useMemo(() => new Map(views.map((v) => [v.slug, v])), [views]);
  const slugs = useMemo(() => views.map((v) => v.slug), [views]);

  // The selection in the URL as the router reports it. On the server it is
  // the request's ?dim=, validated by the same rule as `initial`, so the two
  // agree and hydration matches. It differs from `initial` only on a copy of
  // the page restored from Next's router cache (Back from a dimension page),
  // whose `initial` is from an earlier visit while the URL carries the
  // selection made since — the URL wins. Null-safe: outside the App Router (a
  // test render) there are no search params, and `initial` stands.
  const params = useSearchParams() as ReturnType<typeof useSearchParams> | null;
  const fromUrl = params ? selectedSlugFrom(slugs, params.get(DIM_PARAM)) : panel.initial;

  const [selected, setSelected] = useState<string | null>(fromUrl);
  const [announcement, setAnnouncement] = useState('');
  // Each request to move focus to the panel's heading; a counter rather than
  // a flag so choosing the already-selected row from the list moves focus too.
  const [focusRequest, setFocusRequest] = useState(0);
  // The selection as event handlers see it, without making them change (and
  // the canvas re-register) on every selection.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Follow the URL when it changes underneath: history traversal, a link to
  // ?dim= elsewhere on the site. The echo of this view's own replaceState
  // arrives with the value already selected, and changes nothing.
  useEffect(() => {
    setSelected(fromUrl);
  }, [fromUrl]);

  const choose = useCallback(
    (slug: string | null, moveFocus: boolean) => {
      setSelected(slug);
      selectedRef.current = slug;
      const view = slug === null ? undefined : bySlug.get(slug);
      setAnnouncement(view ? fmt(panelLabels.portrait.panelSelected, { name: view.name }) : '');
      if (moveFocus) setFocusRequest((n) => n + 1);
      try {
        window.history.replaceState(null, '', urlWithSelection(window.location.href, slug));
      } catch {
        // Browsers cap replaceState (Safari: 100 calls in 30 s) and throw past
        // it. The panel has already changed; only the shareable URL lags.
      }
    },
    [bySlug, panelLabels],
  );

  // A new selection (or Close, or choosing the selected row again) shows the
  // panel from its top. From lg the panel scrolls inside its sticky wrapper,
  // which stays mounted across selections: without this, a reader who had
  // scrolled down one dimension's snapshots and listings would get the next
  // one opened partway down, its name and status out of sight — and, picking
  // from the list, keyboard focus on a heading they cannot see (WCAG 2.4.7).
  // A layout effect, so the new panel never paints mid-scroll, and before the
  // focus effect below. Below lg the wrapper does not scroll and this does
  // nothing; the window is left alone either way.
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [selected, focusRequest]);

  // Move focus to the panel's heading after the panel has re-rendered.
  useEffect(() => {
    if (focusRequest === 0) return;
    const heading = headingRef.current;
    if (!heading) return;
    if (!window.matchMedia(BESIDE).matches) {
      // On a phone the panel sits between the doughnut and the list, above
      // the row that was tapped: bring it up. scroll-mt keeps it clear of the
      // sticky header.
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(PANEL_ID)?.scrollIntoView({
        block: 'start',
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
    heading.focus({ preventScroll: true });
  }, [focusRequest]);

  const onCanvasSelect = useCallback(
    (dim: DoughnutDimension | null) => {
      // A second tap on the selected wedge keeps it (on a phone the first tap
      // can read as a hover); the panel's Close empties it.
      if (!dim || dim.slug === selectedRef.current || !bySlug.has(dim.slug)) return;
      choose(dim.slug, false);
    },
    [bySlug, choose],
  );

  const onPick = useCallback(
    (slug: string, event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      choose(slug, true);
    },
    [choose],
  );

  const onClose = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isPlainClick(event)) return;
      event.preventDefault();
      // Focus to the empty panel's heading: the Close link itself is gone.
      choose(null, true);
    },
    [choose],
  );

  const rowHref = useCallback((slug: string) => dimensionHref(pageHref, slug), [pageHref]);
  const view = selected === null ? null : (bySlug.get(selected) ?? null);

  return (
    // Phone: one column in source order — doughnut, panel, list. From lg the
    // panel moves beside the doughnut and spans the list's row too, so it
    // stays in view (sticky, scrolling inside itself when taller than the
    // window) while the reader goes down the list.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="mx-auto w-full lg:col-start-1 lg:row-start-1" style={{ maxWidth: size }}>
        <Doughnut
          social={social}
          ecological={ecological}
          size={size}
          onSelect={onCanvasSelect}
          selectedSlug={selected}
          ariaLabel={summary}
          labels={labels}
        />
        {hint ? <p className="mt-4 text-center text-sm text-[color:var(--color-muted)]">{hint}</p> : null}
      </div>

      <div ref={scrollerRef} className={`${STICKY} lg:col-start-2 lg:row-span-2 lg:row-start-1`}>
        <PortraitPanel
          view={view}
          labels={panelLabels}
          doughnut={labels}
          headingId={headingId}
          headingRef={headingRef}
          fullHref={fullHref}
          closeHref={closedHref(pageHref)}
          onClose={onClose}
          discussion={panel.discussion}
          englishNote={panel.englishNote}
        />
      </div>

      <div className="lg:col-start-1 lg:row-start-2">
        <DimensionList
          title={list.title}
          intro={list.intro}
          rings={rings}
          level={labels.level}
          hrefFor={rowHref}
          selected={selected}
          onPick={onPick}
        />
      </div>

      {/* Polite, outside the panel so it is never re-created: assistive
          technology hears "Showing Housing" for a selection made anywhere,
          including on the canvas, which has no focus to move. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
