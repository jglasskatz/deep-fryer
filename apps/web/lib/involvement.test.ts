import { describe, expect, it } from 'vitest';
import type { InvolvementListing } from '@deep-fryer/db';
import { en } from './i18n/messages/en';
import { es } from './i18n/messages/es';
import { formDimensionOptions, groupListingsByDimension, isFrameworkDimension, listingView } from './involvement';
import type { PublishedDimension } from './portrait';

/**
 * The pure parts of the public involvement read path: how a stored listing
 * becomes what the pages show, how the Get involved page groups listings
 * (framework order, general listings apart, the ?dim= filter), and which
 * dimensions the submission form offers.
 */

const listing = (name: string, dimension_slugs: string[]) => ({ name, dimension_slugs });

describe('groupListingsByDimension', () => {
  const food = listing('Food bank', ['food']);
  const climate = listing('Climate week', ['climate-change']);
  const housingAndHealth = listing('Tenant clinic', ['housing', 'health']);
  const general = listing('Community board', []);
  const unknown = listing('Hand-edited row', ['vibes']);
  const all = [climate, general, housingAndHealth, food, unknown];

  it('groups in the framework order, a multi-dimension listing under each, general listings apart', () => {
    const grouped = groupListingsByDimension(all);
    expect(grouped.dimensions.map((g) => g.slug)).toEqual(['food', 'health', 'housing', 'climate-change']);
    expect(grouped.dimensions.find((g) => g.slug === 'health')!.listings).toEqual([housingAndHealth]);
    expect(grouped.dimensions.find((g) => g.slug === 'housing')!.listings).toEqual([housingAndHealth]);
    expect(grouped.general).toEqual([general]);
  });

  it('keeps the order listings came in within a group', () => {
    const second = listing('Pantry', ['food']);
    const grouped = groupListingsByDimension([second, food]);
    expect(grouped.dimensions[0]!.listings.map((l) => l.name)).toEqual(['Pantry', 'Food bank']);
  });

  it('narrows to one dimension, keeping the general listings', () => {
    const grouped = groupListingsByDimension(all, 'housing');
    expect(grouped.dimensions).toEqual([{ slug: 'housing', listings: [housingAndHealth] }]);
    expect(grouped.general).toEqual([general]);
    expect(groupListingsByDimension(all, 'energy').dimensions).toEqual([]);
  });
});

describe('listingView', () => {
  it('shows what the public pages need, with the check date as ISO', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-000000000002',
      name: 'NYC Service',
      description: 'Find volunteer opportunities across the five boroughs.',
      url: 'https://www.nycservice.org/',
      phone: '311',
      kind: 'volunteer',
      dimensionSlugs: [],
      sourceUrl: 'https://www.nyc.gov/',
      linkCheckedAt: new Date('2026-10-16T01:30:00Z'),
      submissionId: null,
      displayOrder: 2,
      published: true,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies InvolvementListing;
    expect(listingView(row)).toEqual({
      id: row.id,
      name: 'NYC Service',
      description: 'Find volunteer opportunities across the five boroughs.',
      url: 'https://www.nycservice.org/',
      phone: '311',
      kind: 'volunteer',
      dimension_slugs: [],
      link_checked_at: '2026-10-16T01:30:00.000Z',
      display_order: 2,
    });
  });
});

describe('formDimensionOptions', () => {
  const dim = (slug: string, name: string, display_order: number, canonical_slug: string | null = null) =>
    ({ slug, name, display_order, canonical_slug, data: { name } }) as unknown as PublishedDimension;

  it('offers the portrait’s framework dimensions in its order, named in the reader’s language', () => {
    const dims = [dim('housing', 'Housing', 2), dim('food', 'Food', 1)];
    expect(formDimensionOptions(en, dims)).toEqual([
      { slug: 'food', name: 'Food' },
      { slug: 'housing', name: 'Housing' },
    ]);
    expect(formDimensionOptions(es, dims).map((d) => d.name)).toEqual([es.dimensions.food, es.dimensions.housing]);
  });

  it('maps a renamed dimension to its framework slug, once, and leaves out one with no counterpart', () => {
    const dims = [
      dim('affordable-homes', 'Affordable homes', 1, 'housing'),
      dim('housing', 'Housing', 2),
      dim('nightlife', 'Nightlife', 3),
    ];
    expect(formDimensionOptions(en, dims)).toEqual([{ slug: 'housing', name: 'Affordable homes' }]);
  });
});

describe('isFrameworkDimension', () => {
  it('accepts the framework’s slugs only', () => {
    expect(isFrameworkDimension('housing')).toBe(true);
    expect(isFrameworkDimension('ozone-depletion')).toBe(true);
    expect(isFrameworkDimension('Housing')).toBe(false);
    expect(isFrameworkDimension('')).toBe(false);
    expect(isFrameworkDimension(null)).toBe(false);
  });
});
