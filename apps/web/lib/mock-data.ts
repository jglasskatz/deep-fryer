import type { PublishedPortrait } from './portrait';

/**
 * Demo portrait served when DATABASE_URL is unset, so the app runs with zero
 * infrastructure. Real deployments read published versions from Postgres.
 */
const dim = (
  ring: 'social' | 'ecological',
  slug: string,
  name: string,
  viz_level: number,
  display_order: number,
): PublishedPortrait['dimensions'][number] => ({
  slug,
  ring,
  canonical_slug: slug.replace(/-/g, '_'),
  display_order,
  viz_level,
  data: {
    name,
    icon: '',
    description: '',
    context: 'Demo data — run the Santa Cruz import or a research run for real content.',
    indicators: [],
    actions: [],
  },
  published_at: null,
  version_num: 1,
});

export const mockPortrait: PublishedPortrait = {
  tenant: {
    slug: 'santacruz',
    name: 'City of Santa Cruz',
    region: 'CA, USA',
    population: 65000,
    description:
      'Coastal city of ~65,000 on Monterey Bay, home to UC Santa Cruz and a global biodiversity hotspot.',
    branding: null,
  },
  dimensions: [
    dim('social', 'food', 'Food', 35, 0),
    dim('social', 'health', 'Health', 20, 1),
    dim('social', 'education', 'Education', -10, 2),
    dim('social', 'income-work', 'Income & Work', 60, 3),
    dim('social', 'water-sanitation', 'Water & Sanitation', 5, 4),
    dim('social', 'energy', 'Energy', 40, 5),
    dim('social', 'networks', 'Networks', 15, 6),
    dim('social', 'housing', 'Housing', 140, 7),
    dim('social', 'gender-equality', 'Gender Equality', 45, 8),
    dim('social', 'social-equity', 'Social Equity', 70, 9),
    dim('social', 'political-voice', 'Political Voice', -20, 10),
    dim('social', 'peace-justice', 'Peace & Justice', 30, 11),
    dim('ecological', 'climate-change', 'Climate Change', 110, 12),
    dim('ecological', 'ocean-acidification', 'Ocean Acidification', 65, 13),
    dim('ecological', 'chemical-pollution', 'Chemical Pollution', 80, 14),
    dim('ecological', 'nitrogen-phosphorus-loading', 'Nitrogen & Phosphorus Loading', 90, 15),
    dim('ecological', 'freshwater-withdrawals', 'Freshwater Withdrawals', 55, 16),
    dim('ecological', 'land-conversion', 'Land Conversion', 40, 17),
    dim('ecological', 'biodiversity-loss', 'Biodiversity Loss', 75, 18),
    dim('ecological', 'air-pollution', 'Air Pollution', 25, 19),
    dim('ecological', 'ozone-depletion', 'Ozone Layer Depletion', -30, 20),
  ],
};
