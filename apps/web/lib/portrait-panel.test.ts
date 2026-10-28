import { describe, expect, it } from 'vitest';
import type { DimensionData, Indicator, InvolvementListingView } from '@deep-fryer/core';
import { en } from './i18n/messages/en';
import { es } from './i18n/messages/es';
import {
  PANEL_LISTING_LIMIT,
  panelLabels,
  portraitPanelView,
  portraitPanelViews,
  selectedPanelView,
  type PanelOptions,
} from './portrait-panel';
import type { PublishedDimension } from './portrait';

const indicator = (over: Partial<Indicator> = {}): Indicator => ({
  name: 'Rent-burdened renter households',
  value: 61.2,
  unit: '% of renter households',
  year: 2023,
  target: 30,
  source: 'American Community Survey',
  source_url: 'https://data.census.gov/table/ACSDT5Y2023.B25070',
  confidence: 'high',
  geographic_scale: 'city',
  evidence: { snapshot_path: 'housing/acs.png', pdf_path: 'housing/acs.pdf', captured_at: '2026-09-30T14:02:00Z' },
  ...over,
});

const dimension = (
  slug: string,
  data: Partial<DimensionData> = {},
  over: Partial<PublishedDimension> = {},
): PublishedDimension => ({
  slug,
  ring: 'social',
  canonical_slug: null,
  display_order: 0,
  viz_level: 140,
  data: {
    name: 'Housing',
    icon: '',
    description: '',
    context: 'Most renters pay more than a third of their income in rent.',
    indicators: [indicator()],
    actions: ['Testify at the rent guidelines board hearing.'],
    ...data,
  },
  published_at: '2026-10-01T00:00:00Z',
  version_num: 3,
  ...over,
});

const listing = (over: Partial<InvolvementListingView>): InvolvementListingView => ({
  id: 'l1',
  name: 'Tenants Union',
  description: 'Organizes tenants building by building.',
  url: 'https://tenants.example.org',
  phone: '(831) 555-0100',
  kind: 'organize',
  dimension_slugs: ['housing'],
  link_checked_at: null,
  display_order: 0,
  ...over,
});

const options = (over: Partial<PanelOptions> = {}): PanelOptions => ({
  m: en,
  locale: 'en',
  evidenceUrl: (path) => `/evidence/santacruz/${path}`,
  listings: null,
  ...over,
});

describe('portraitPanelView', () => {
  it('shapes a dimension with data: formatted values, the source link, the snapshot, the actions', () => {
    const view = portraitPanelView(dimension('housing'), options());
    expect(view).toMatchObject({
      slug: 'housing',
      name: 'Housing',
      ring: 'social',
      level: 140,
      context: 'Most renters pay more than a third of their income in rent.',
      actions: ['Testify at the rent guidelines board hearing.'],
      gaps: [],
    });
    expect(view.indicators).toEqual([
      {
        name: 'Rent-burdened renter households',
        value: '61.2% of renter households',
        year: 2023,
        target: '30% of renter households',
        scale: 'city',
        source: 'American Community Survey',
        sourceHref: 'https://data.census.gov/table/ACSDT5Y2023.B25070',
        snapshot: {
          src: '/evidence/santacruz/housing/acs.png',
          capturedOn: '2026-09-30',
          pdfHref: '/evidence/santacruz/housing/acs.pdf',
        },
      },
    ]);
  });

  it('shapes a dimension with no data: no indicators, its gaps, no context, no actions, unknown status', () => {
    const view = portraitPanelView(
      dimension(
        'networks',
        {
          name: 'Networks',
          context: '   ',
          indicators: [],
          actions: [],
          gaps: [
            {
              indicator: 'Social isolation',
              reason: 'No survey measures isolation at city scale.',
              scales_tried: ['city', 'county'],
              searched_at: '2026-09-01',
            },
          ],
        },
        { viz_level: null },
      ),
      options(),
    );
    expect(view).toEqual({
      slug: 'networks',
      name: 'Networks',
      ring: 'social',
      level: null,
      context: null,
      indicators: [],
      gaps: [{ reason: 'No survey measures isolation at city scale.', scales: ['city', 'county'] }],
      actions: [],
      actionSources: [],
      listings: null,
      moreListings: null,
    });
  });

  it('leaves out a value, target and snapshot that are not there (never the English "Data needed")', () => {
    const [ind] = portraitPanelView(
      dimension('housing', {
        indicators: [indicator({ value: null, target: '', year: null, evidence: undefined, source: '' })],
      }),
      options(),
    ).indicators;
    expect(ind).toMatchObject({
      value: null,
      target: null,
      year: null,
      snapshot: null,
      source: null,
      sourceHref: null,
    });
  });

  it('drops unsafe source URLs but keeps the source name as text', () => {
    const view = portraitPanelView(
      dimension('housing', {
        indicators: [
          indicator({ source_url: 'javascript:alert(document.cookie)' }),
          indicator({ source_url: ' JaVaScRiPt:alert(1)' }),
          indicator({ source_url: 'data:text/html,<script>alert(1)</script>' }),
          indicator({ source_url: '' }),
          indicator({ source_url: 'http://example.org/report' }),
        ],
      }),
      options(),
    );
    expect(view.indicators.map((i) => [i.source, i.sourceHref])).toEqual([
      ['American Community Survey', null],
      ['American Community Survey', null],
      ['American Community Survey', null],
      ['American Community Survey', null],
      ['American Community Survey', 'http://example.org/report'],
    ]);
  });

  it('retains archived action evidence while filtering unsafe live links', () => {
    const evidence = { snapshot_path: 'actions/source.png', pdf_path: 'actions/source.pdf', captured_at: '2026-10-01T00:00:00Z' };
    const view = portraitPanelView(dimension('housing', {
      action_sources: [
        { text: 'Attend a public meeting.', source_url: 'https://example.gov/meetings', evidence },
        { text: 'Unsafe link.', source_url: 'javascript:alert(1)', evidence },
      ],
    }), options());
    expect(view.actionSources).toEqual([
      { text: 'Attend a public meeting.', sourceHref: 'https://example.gov/meetings', snapshotHref: '/evidence/santacruz/actions/source.png', pdfHref: '/evidence/santacruz/actions/source.pdf' },
      { text: 'Unsafe link.', sourceHref: null, snapshotHref: '/evidence/santacruz/actions/source.png', pdfHref: '/evidence/santacruz/actions/source.pdf' },
    ]);
  });

  it('carries no listings at all when the involvement feature is off', () => {
    expect(portraitPanelView(dimension('housing'), options({ listings: null })).listings).toBeNull();
  });

  it('with involvement on: the dimension’s listings first, then those for every dimension, links made safe', () => {
    const listings = [
      listing({ id: 'general', name: 'Volunteer Center', kind: 'volunteer', dimension_slugs: [], phone: null }),
      listing({ id: 'other', name: 'Food Bank', dimension_slugs: ['food'] }),
      listing({ id: 'specific', url: 'javascript:alert(1)' }),
    ];
    const view = portraitPanelView(dimension('housing'), options({ listings }));
    expect(view.listings).toEqual([
      {
        id: 'specific',
        name: 'Tenants Union',
        description: 'Organizes tenants building by building.',
        href: null,
        phone: '(831) 555-0100',
        tel: 'tel:8315550100',
        kind: 'organize',
        general: false,
      },
      {
        id: 'general',
        name: 'Volunteer Center',
        description: 'Organizes tenants building by building.',
        href: 'https://tenants.example.org',
        phone: null,
        tel: null,
        kind: 'volunteer',
        general: true,
      },
    ]);
    // On, with nothing published: an empty list, not null.
    expect(portraitPanelView(dimension('housing'), options({ listings: [] })).listings).toEqual([]);
  });

  it('shows the first few listings and says how many more the full page has', () => {
    const many = Array.from({ length: PANEL_LISTING_LIMIT + 4 }, (_, i) => listing({ id: `l${i}`, name: `Group ${i}` }));
    const view = portraitPanelView(dimension('housing'), options({ listings: many }));
    expect(view.listings!.map((l) => l.id)).toEqual(['l0', 'l1', 'l2']);
    expect(view.moreListings).toEqual({ count: 4, label: '4 more ways to get involved on the full page' });

    const one = portraitPanelView(dimension('housing'), options({ listings: many.slice(0, PANEL_LISTING_LIMIT + 1) }));
    expect(one.moreListings).toEqual({ count: 1, label: 'One more way to get involved on the full page' });
    const exactly = portraitPanelView(dimension('housing'), options({ listings: many.slice(0, PANEL_LISTING_LIMIT) }));
    expect(exactly.listings).toHaveLength(PANEL_LISTING_LIMIT);
    expect(exactly.moreListings).toBeNull();
    // Off: no listings and nothing to say about more.
    expect(portraitPanelView(dimension('housing'), options()).moreListings).toBeNull();
  });

  it('keys listings by the actual local slug without borrowing another dimension’s listings', () => {
    const view = portraitPanelView(
      dimension('homes-for-all', { name: 'Homes for All' }, { canonical_slug: 'housing' }),
      options({ listings: [listing({ id: 'canonical' }), listing({ id: 'local', dimension_slugs: ['homes-for-all'] })] }),
    );
    expect(view.listings?.map((l) => l.id)).toEqual(['local']);
    // The renamed dimension keeps its own (published) name.
    expect(view.name).toBe('Homes for All');
  });

  it('names framework dimensions and scales in the reader’s language; research text stays as published', () => {
    const view = portraitPanelView(dimension('housing'), options({ m: es }));
    expect(view.name).toBe('Vivienda');
    expect(view.indicators[0]?.scale).toBe('municipal');
    expect(view.indicators[0]?.name).toBe('Rent-burdened renter households');
  });
});

describe('selecting from ?dim=', () => {
  const views = portraitPanelViews(
    [
      dimension('housing', {}, { display_order: 7 }),
      dimension('food', { name: 'Food' }, { display_order: 0 }),
      dimension('climate-change', { name: 'Climate Change' }, { ring: 'ecological', display_order: 12 }),
    ],
    options(),
  );

  it('lists every view in the doughnut’s order', () => {
    expect(views.map((v) => v.slug)).toEqual(['food', 'housing', 'climate-change']);
  });

  it('selects a dimension the portrait has', () => {
    expect(selectedPanelView(views, 'housing')?.name).toBe('Housing');
  });

  it('ignores an unknown, empty or missing ?dim (the empty panel)', () => {
    expect(selectedPanelView(views, 'networks')).toBeNull();
    expect(selectedPanelView(views, '')).toBeNull();
    expect(selectedPanelView(views, undefined)).toBeNull();
    expect(selectedPanelView(views, ['../admin'])).toBeNull();
  });
});

describe('panelLabels', () => {
  it('passes the reader’s catalog strings through', () => {
    const labels = panelLabels(es);
    expect(labels.portrait.panelClose).toBe(es.portrait.panelClose);
    expect(labels.dimension.whatYouCanDo).toBe(es.dimension.whatYouCanDo);
    expect(labels.involvement.kind.volunteer).toBe(es.involvement.kind.volunteer);
    expect(labels.noData).toBe(es.common.noData);
  });
});
