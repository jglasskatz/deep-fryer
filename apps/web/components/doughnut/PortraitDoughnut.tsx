'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import {
  Doughnut,
  MAX_PORTRAIT_KEYS,
  statusLabel,
  type DoughnutDimension,
  type DoughnutShortcut,
  type DoughnutShortcuts,
} from './Doughnut';
import { formatIndicatorValue } from '@deep-fryer/core';
import { DimensionList, type DimensionRing } from '@/components/portrait/DimensionList';
import { PortraitCoreView, type PortraitPanelConfig } from '@/components/portrait/PortraitCoreView';
import { SummaryChips, type SummaryChipLabels } from '@/components/portrait/SummaryChips';
import { flipTheme } from '@/components/theme/theme-dom';
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

/** The summary chips above the chart, in the reader's language. */
export interface PortraitChips {
  labels: SummaryChipLabels;
  locale: string;
}

/**
 * The doughnut's shortcut keys on the portrait's front page: number keys
 * open the portraits of its family, in the family bar's order, and "d"
 * switches light and dark.
 */
export interface PortraitShortcuts {
  /** The family's portraits in the family bar's order (empty when the portrait stands alone). */
  portraits: { slug: string; name: string; href: string }[];
  /** This portrait's slug: its own number key does nothing. */
  current: string;
  /** The reader's language, for joining the list of portraits. */
  locale: string;
  labels: {
    /** doughnut.shortcutsTheme, shortcutsPortraits and shortcutsPortrait. */
    theme: string;
    portraits: string;
    portrait: string;
    /** theme.toggle ("Theme: {mode}") and the two modes' names, announced after "d". */
    toggle: string;
    light: string;
    dark: string;
  };
}

/**
 * Where the current portrait sits in its family list, or -1 when it is not
 * there (none should be): then only the theme key is offered, so the keys
 * that act and the keys described always agree.
 */
export function currentPortraitIndex(shortcuts: PortraitShortcuts): number {
  return shortcuts.portraits.findIndex((p) => p.slug === shortcuts.current);
}

/**
 * Join the portraits for the description in the reader's language ("A, B
 * and C"). A language the browser has no list data for (Haitian Creole)
 * would otherwise get the English "and", so it gets commas alone.
 */
function joinList(items: string[], locale: string): string {
  let supported = false;
  try {
    supported = Intl.ListFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    // An ill-formed language tag: commas alone.
  }
  return supported ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(items) : items.join(', ');
}

/**
 * The keys in words, for the chart's description: the theme key, then each
 * other portrait with its number ("2 for Santa Cruz County"). Only the first
 * nine portraits have a key; the current one is left out, as its key does
 * nothing.
 */
export function shortcutsDescription(shortcuts: PortraitShortcuts): string {
  const { labels } = shortcuts;
  if (currentPortraitIndex(shortcuts) < 0) return labels.theme;
  const others = shortcuts.portraits
    .slice(0, MAX_PORTRAIT_KEYS)
    .map((p, i) => ({ ...p, key: i + 1 }))
    .filter((p) => p.slug !== shortcuts.current)
    .map((p) => fmt(labels.portrait, { key: p.key, name: p.name }));
  if (others.length === 0) return labels.theme;
  const list = joinList(others, shortcuts.locale);
  return `${labels.theme} ${fmt(labels.portraits, { list })}`;
}

/**
 * Carry out a shortcut: "d" flips the theme and says which is now on
 * ("Theme: Dark"); a number opens that portrait, unless it is this one.
 * Returns what to announce.
 */
export function runShortcut(
  shortcut: DoughnutShortcut,
  shortcuts: PortraitShortcuts,
  act: { flipTheme: () => 'light' | 'dark'; open: (href: string) => void },
): string | undefined {
  if (shortcut.kind === 'theme') {
    const now = act.flipTheme();
    return fmt(shortcuts.labels.toggle, { mode: shortcuts.labels[now] });
  }
  const target = shortcuts.portraits[shortcut.index];
  if (target && target.slug !== shortcuts.current) act.open(target.href);
  return undefined;
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
  chips,
  shortcuts,
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
  /** Summary chips above the chart (the portrait's own page; never in an embed). */
  chips?: PortraitChips;
  /** Shortcut keys on the focused chart (the portrait's own page; never in an embed). */
  shortcuts?: PortraitShortcuts;
}) {
  const router = useRouter();
  const embedded = Boolean(linkBase?.startsWith('http'));

  const onShortcut = useCallback(
    (shortcut: DoughnutShortcut): string | void =>
      shortcuts ? runShortcut(shortcut, shortcuts, { flipTheme, open: (href) => router.push(href) }) : undefined,
    [router, shortcuts],
  );
  const currentIndex = shortcuts ? currentPortraitIndex(shortcuts) : -1;
  const keys: DoughnutShortcuts | undefined =
    shortcuts && !embedded
      ? {
          // A portrait outside its own family list (none should be) gets the theme key only.
          portraitCount: currentIndex >= 0 ? shortcuts.portraits.length : 0,
          currentIndex: currentIndex >= 0 ? currentIndex : undefined,
          description: shortcutsDescription(shortcuts),
          onShortcut,
        }
      : undefined;

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

  const chipLine =
    chips && !embedded ? <SummaryChips dims={all} labels={chips.labels} locale={chips.locale} className="mb-6" /> : null;

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
        above={chipLine}
        shortcuts={keys}
      />
    );
  }

  return (
    <div className="w-full" style={{ maxWidth: size }}>
      {chipLine}
      <Doughnut
        social={social}
        ecological={ecological}
        size={size}
        onSelect={handleSelect}
        ariaLabel={summary}
        labels={labels}
        shortcuts={keys}
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
