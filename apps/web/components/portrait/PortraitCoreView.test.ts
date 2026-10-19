import React, { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { DimensionData, InvolvementListingView } from '@deep-fryer/core';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { en } from '@/lib/i18n/messages/en';
import { panelLabels, portraitPanelViews, selectedPanelView } from '@/lib/portrait-panel';
import type { PublishedDimension } from '@/lib/portrait';
import type { PortraitPanelConfig } from './PortraitCoreView';

/**
 * The core view as the server renders it (SPEC-v7 §2) — which is also what a
 * reader without JavaScript gets: `?dim=` fills the panel, the rows are links
 * to `?dim=`, and features that are off leave nothing behind. Rendered with
 * the App Router's contexts provided, as Next provides them on the server.
 */

// Vitest compiles the components' JSX with the classic runtime (the web
// vitest config names no JSX runtime; Next uses its own), which expects
// React in scope — as in lib/emergency.test.ts.
vi.stubGlobal('React', React);

const dim = (
  slug: string,
  ring: 'social' | 'ecological',
  order: number,
  data: Partial<DimensionData> = {},
  viz_level: number | null = 40,
): PublishedDimension => ({
  slug,
  ring,
  canonical_slug: null,
  display_order: order,
  viz_level,
  data: {
    name: en.dimensions[slug as keyof typeof en.dimensions],
    icon: '',
    description: '',
    context: '',
    indicators: [],
    actions: [],
    ...data,
  },
  published_at: null,
  version_num: 1,
});

const DIMENSIONS: PublishedDimension[] = [
  dim('food', 'social', 0),
  dim('networks', 'social', 6, {}, null),
  dim(
    'housing',
    'social',
    7,
    {
      context: 'Most renters pay more than a third of their income in rent.',
      indicators: [
        {
          name: 'Rent-burdened renter households',
          value: 61.2,
          unit: '% of renter households',
          year: 2023,
          target: 30,
          source: 'American Community Survey',
          source_url: 'javascript:alert(1)',
          confidence: 'high',
          geographic_scale: 'city',
          evidence: { snapshot_path: 'housing/acs.png', captured_at: '2026-09-30T14:02:00Z' },
        },
      ],
      actions: ['Testify at the rent guidelines board hearing.'],
    },
    140,
  ),
  dim('climate-change', 'ecological', 12, {}, 110),
];

const LISTINGS: InvolvementListingView[] = [
  {
    id: 'l1',
    name: 'Tenants Union',
    description: 'Organizes tenants building by building.',
    url: 'https://tenants.example.org',
    phone: null,
    kind: 'organize',
    dimension_slugs: ['housing'],
    link_checked_at: null,
    display_order: 0,
  },
];

function panel(
  dimParam: string | null,
  over: { involvement?: boolean; discussion?: boolean; listings?: InvolvementListingView[] } = {},
): PortraitPanelConfig {
  const views = portraitPanelViews(DIMENSIONS, {
    m: en,
    locale: 'en',
    evidenceUrl: (path) => `/evidence/santacruz/${path}`,
    listings: over.involvement ? (over.listings ?? LISTINGS) : null,
  });
  return {
    views,
    initial: selectedPanelView(views, dimParam ?? undefined)?.slug ?? null,
    labels: panelLabels(en),
    pageHref: '/santacruz',
    discussion: over.discussion ?? false,
    englishNote: false,
  };
}

const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

/** Render the way the portrait page does, for a request with `search`. */
function render(element: ReactElement, search = ''): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, element),
    ),
  );
}

const portrait = (props: { panel?: PortraitPanelConfig; linkBase?: string }) =>
  createElement(PortraitDoughnut, {
    tenantSlug: 'santacruz',
    tenantName: 'City of Santa Cruz',
    dimensions: DIMENSIONS,
    labels: doughnutLabels(en),
    linkBase: props.linkBase ?? '/santacruz/dim',
    explore: { title: en.portrait.exploreTitle },
    panel: props.panel,
  });

/** The markup of the element with this id (the panel is one section). */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, `no section #${id}`).toBeGreaterThanOrEqual(0);
  return html.slice(start, html.indexOf('</section>', start));
}

describe('the portrait core view, server-rendered', () => {
  it('?dim= fills the panel: name, ring, status, value, target, scale, source, snapshot, actions', () => {
    const html = render(portrait({ panel: panel('housing') }), 'dim=housing');
    const p = section(html, 'panel');
    expect(p).toMatch(/<h2 id="[^"]+" tabindex="-1"[^>]*>Housing<\/h2>/);
    expect(p).toMatch(new RegExp(`aria-labelledby="([^"]+)"`));
    expect(p).toContain('Social foundation');
    expect(p).toContain('Severe');
    expect(p).toContain('<bdi lang="en">61.2% of renter households</bdi>');
    expect(p).toContain('target: <bdi lang="en">30% of renter households</bdi>');
    expect(p).toContain('city data');
    expect(p).toContain('src="/evidence/santacruz/housing/acs.png"');
    expect(p).toContain('Snapshot of the source for Rent-burdened renter households, captured 2026-09-30');
    expect(p).toContain('Testify at the rent guidelines board hearing.');
    expect(p).toContain('lang="en" class="mt-4 text-sm leading-relaxed">Most renters');
    // The close control is a link to the page without ?dim=.
    expect(p).toContain('href="/santacruz#panel"');
    expect(p).toContain('href="/santacruz/dim/housing"');
    expect(p).toContain(en.portrait.openFull);
  });

  it('renders an unsafe source as text, never as a link', () => {
    const p = section(render(portrait({ panel: panel('housing') }), 'dim=housing'), 'panel');
    expect(p).toContain('<span lang="en">American Community Survey</span>');
    expect(p).not.toContain('javascript:');
  });

  it('the panel is labelled by its heading, and the list marks the selected row', () => {
    const html = render(portrait({ panel: panel('housing') }), 'dim=housing');
    const labelledBy = /<section id="panel" aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h2 id="${labelledBy}"`);
    // Rows are real links to ?dim= that land on the panel; only Housing is current.
    expect(html).toContain('href="/santacruz?dim=food#panel"');
    expect(html).toMatch(/href="\/santacruz\?dim=housing#panel" aria-current="true"/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    // The panel comes between the doughnut and the list (the phone order).
    expect(html.indexOf('<canvas')).toBeLessThan(html.indexOf('id="panel"'));
    expect(html.indexOf('id="panel"')).toBeLessThan(html.indexOf(en.portrait.exploreTitle));
  });

  it('the panel clears the tallest sticky header, as a #panel target and stuck beside the doughnut', () => {
    const html = render(portrait({ panel: panel('housing') }), 'dim=housing');
    // Header + family bar + a translated page's language notice (up to four
    // lines on a phone): EmergencySections' ANCHOR, which measured it.
    expect(html).toMatch(/<section id="panel"[^>]*class="[^"]*scroll-mt-48[^"]*sm:scroll-mt-36/);
    // From lg the wrapper sticks 9rem down and fits the rest of the window.
    const wrapper = /<div class="([^"]*)"><section id="panel"/.exec(html)?.[1] ?? '';
    for (const c of ['lg:sticky', 'lg:top-36', 'lg:max-h-[calc(100vh_-_10rem)]', 'lg:overflow-y-auto']) {
      expect(wrapper.split(' ')).toContain(c);
    }
  });

  it('nothing selected, or an unknown ?dim=: the empty panel explains the doughnut with its legend', () => {
    for (const search of ['', 'dim=not-a-dimension']) {
      const params = new URLSearchParams(search);
      const html = render(portrait({ panel: panel(params.get('dim')) }), search);
      const p = section(html, 'panel');
      expect(p).toContain(en.portrait.legendTitle);
      expect(p).toContain(en.portrait.panelEmpty);
      const { legendSafe, legendShortfall, legendOvershoot, legendNoData } = en.portrait;
      for (const line of [legendSafe, legendShortfall, legendOvershoot, legendNoData]) expect(p).toContain(line);
      expect(html).not.toContain('aria-current');
    }
  });

  it('a dimension with no data says so', () => {
    const p = section(render(portrait({ panel: panel('networks') }), 'dim=networks'), 'panel');
    expect(p).toContain('>Networks</h2>');
    expect(p).toContain('Unknown');
    expect(p).not.toContain('<img');
  });

  it('shows involvement listings only when the feature is on', () => {
    const off = section(render(portrait({ panel: panel('housing') }), 'dim=housing'), 'panel');
    expect(off).not.toContain(en.involvement.title);
    expect(off).not.toContain('Tenants Union');
    const on = section(render(portrait({ panel: panel('housing', { involvement: true }) }), 'dim=housing'), 'panel');
    expect(on).toContain(en.involvement.title);
    expect(on).toContain('href="https://tenants.example.org"');
    expect(on).toContain(en.involvement.kind.organize);
  });

  it('makes a listing’s tap-to-call link a 44 px target, like every other control in the panel', () => {
    const listings = [{ ...LISTINGS[0]!, phone: '(831) 555-0100' }];
    const html = section(render(portrait({ panel: panel('housing', { involvement: true, listings }) }), 'dim=housing'), 'panel');
    expect(html).toMatch(/<a class="inline-flex min-h-11 items-center font-medium underline" href="tel:[^"]+">/);
  });

  it('names the discussion in the full page link only when the feature is on', () => {
    const off = section(render(portrait({ panel: panel('housing') }), 'dim=housing'), 'panel');
    expect(off).not.toContain(en.portrait.openFullDiscussion);
    const on = section(render(portrait({ panel: panel('housing', { discussion: true }) }), 'dim=housing'), 'panel');
    expect(on).toContain(en.portrait.openFullDiscussion);
  });
});

describe('without the panel', () => {
  it('an embed keeps its behaviour even when given a panel: no panel, the hidden list opening new tabs', () => {
    const html = render(
      portrait({ panel: panel('housing'), linkBase: 'https://df.example/santacruz/dim' }),
      'dim=housing',
    );
    expect(html).not.toContain('id="panel"');
    expect(html).toContain('class="sr-only');
    expect(html).toContain('href="https://df.example/santacruz/dim/housing" target="_blank" rel="noopener noreferrer"');
  });

  it('the family comparison (no panel prop) is unchanged: links go to the dimension pages', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppRouterContext.Provider,
        { value: router },
        createElement(PortraitDoughnut, {
          tenantSlug: 'santacruz',
          tenantName: 'City of Santa Cruz',
          dimensions: DIMENSIONS,
          labels: doughnutLabels(en),
          linkBase: '/santacruz/dim',
          size: 320,
        }),
      ),
    );
    expect(html).not.toContain('id="panel"');
    expect(html).not.toContain('?dim=');
    expect(html).toContain('href="/santacruz/dim/housing"');
  });
});
