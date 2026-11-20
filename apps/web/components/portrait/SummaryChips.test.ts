import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { fmtPlural } from '@/lib/i18n/format';
import { LOCALES } from '@/lib/i18n/locales';
import { ALL_CATALOGS } from '@/lib/i18n/messages';
import { en } from '@/lib/i18n/messages/en';
import { panelLabels, portraitPanelViews } from '@/lib/portrait-panel';
import type { PublishedDimension } from '@/lib/portrait';
import { STATUS_DOT, statusCounts, statusDotClass, statusGroup } from './status';

/**
 * The chips above the doughnut ("9 thriving, 6 need attention"), rendered on
 * the portrait's core view as the server sends it, and checked against the
 * wedges the canvas is given: every wedge is a row with a status dot in the
 * list below the chart, so counting those dots counts the wedges.
 */

vi.stubGlobal('React', React);

const SLUGS = Object.keys(en.dimensions) as (keyof typeof en.dimensions)[];

/** All 21 dimensions with a spread of levels: 9 inside, 6 just past, 4 well past, 2 without data. */
const LEVELS: (number | null)[] = [
  -100, -60, -20, 0, -5, -80, -40, -10, -1, // 9 thriving (level <= 0)
  10, 25, 50, 1, 30, 45, // 6 need attention (0 < level <= 50)
  51, 90, 140, 150, // 4 critical (level > 50)
  null, null, // 2 without data
];

const DIMENSIONS: PublishedDimension[] = SLUGS.map((slug, i) => ({
  slug,
  ring: i < 12 ? 'social' : 'ecological',
  canonical_slug: null,
  display_order: i,
  viz_level: LEVELS[i]!,
  data: { name: en.dimensions[slug], icon: '', description: '', context: '', indicators: [], actions: [] },
  published_at: null,
  version_num: 1,
}));

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function frontPage(withChips: boolean, dims = DIMENSIONS): string {
  const views = portraitPanelViews(dims, { m: en, locale: 'en', evidenceUrl: (p) => `/evidence/${p}`, listings: null });
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        createElement(PortraitDoughnut, {
          tenantSlug: 'santacruz',
          tenantName: 'City of Santa Cruz',
          dimensions: dims,
          labels: doughnutLabels(en),
          panel: { views, initial: null, labels: panelLabels(en), pageHref: '/santacruz', discussion: false, englishNote: false },
          chips: withChips ? { labels: en.portrait.chips, locale: 'en' } : undefined,
        }),
      ),
    ),
  );
}

/** The chips as rendered: [status, text] in order. */
function chips(html: string): [string, string][] {
  const list = /<ul aria-label="At a glance"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...list.matchAll(/<li data-status="(\w+)"[^>]*>.*?<span>([^<]*)<\/span><\/li>/g)].map((m) => [m[1]!, m[2]!]);
}

describe('summary chips', () => {
  it('count exactly the wedges of each reading, above the doughnut', () => {
    const html = frontPage(true);
    expect(chips(html)).toEqual([
      ['thriving', '9 thriving'],
      ['attention', '6 need attention'],
      ['critical', '4 critical'],
      ['unknown', '2 without data'],
    ]);
    // Above the chart: the list comes before the canvas.
    expect(html.indexOf('aria-label="At a glance"')).toBeLessThan(html.indexOf('<canvas'));

    // One dot per wedge in the dimension list (the canvas draws exactly these
    // dimensions); each chip's count is the number of dots of its colour.
    const listHtml = html.slice(html.indexOf('<canvas'));
    for (const [group, dot] of Object.entries(STATUS_DOT)) {
      const dots = listHtml.split(`rounded-full ${dot}`).length - 1;
      expect(dots, group).toBe(statusCounts(DIMENSIONS)[group as keyof typeof STATUS_DOT]);
    }
    const counts = statusCounts(DIMENSIONS);
    expect(counts.thriving + counts.attention + counts.critical + counts.unknown).toBe(DIMENSIONS.length);
  });

  it('says "1 needs attention" in the singular, keeps "0 critical", and leaves out the no-data chip when all have data', () => {
    const dims = DIMENSIONS.slice(0, 10); // 9 thriving, 1 needs attention
    expect(chips(frontPage(true, dims))).toEqual([
      ['thriving', '9 thriving'],
      ['attention', '1 needs attention'],
      ['critical', '0 critical'],
    ]);
  });

  it('are not shown where the page does not ask for them (embeds, the family comparison)', () => {
    expect(frontPage(false)).not.toContain('At a glance');
  });

  it('use the status dots of the list: the same cut-offs, the same colours', () => {
    for (const level of [...LEVELS, Number.NaN]) {
      expect(statusDotClass(level)).toBe(STATUS_DOT[statusGroup(level)]);
    }
    expect(statusGroup(0)).toBe('thriving');
    expect(statusGroup(50)).toBe('attention');
    expect(statusGroup(50.5)).toBe('critical');
    expect(statusGroup(Number.NaN)).toBe('unknown');
  });

  it('exist in all twelve catalogs, with every plural form each language needs', () => {
    expect(Object.keys(ALL_CATALOGS)).toHaveLength(12);
    for (const { code } of LOCALES) {
      const c = ALL_CATALOGS[code].portrait.chips;
      expect(c.label.trim(), code).not.toBe('');
      for (const group of ['thriving', 'attention', 'critical', 'unknown'] as const) {
        for (const n of [0, 1, 2, 3, 5, 11, 21]) {
          const text = fmtPlural(code, c[group], n);
          expect(text, `${code} ${group} ${n}`).not.toMatch(/\{\w+\}/);
          // The count is written out as a number, except where a language spells one out.
          if (n > 2) expect(text, `${code} ${group} ${n}`).toContain(String(n));
        }
      }
    }
  });
});
