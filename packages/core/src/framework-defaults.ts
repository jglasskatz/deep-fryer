import type { FrameworkDimension, Ring } from './types.js';

export const socialFrameworkDimensions: FrameworkDimension[] = [
  {
    slug: 'food',
    canonical_slug: 'food',
    name: 'Food',
    icon: 'utensils',
    description: 'Food security and nutrition access.',
  },
  {
    slug: 'health',
    canonical_slug: 'health',
    name: 'Health',
    icon: 'heart-pulse',
    description: 'Healthcare access and health outcomes.',
  },
  {
    slug: 'education',
    canonical_slug: 'education',
    name: 'Education',
    icon: 'graduation-cap',
    description: 'Educational attainment, quality, and equity.',
  },
  {
    slug: 'income-work',
    canonical_slug: 'income_work',
    name: 'Income & Work',
    icon: 'briefcase',
    description: 'Poverty, employment, and living wage.',
  },
  {
    slug: 'water-sanitation',
    canonical_slug: 'water_sanitation',
    name: 'Water & Sanitation',
    icon: 'droplets',
    description: 'Access to clean water and sanitation.',
  },
  {
    slug: 'energy',
    canonical_slug: 'energy',
    name: 'Energy',
    icon: 'zap',
    description: 'Affordable, reliable, clean energy access.',
  },
  {
    slug: 'networks',
    canonical_slug: 'networks',
    name: 'Networks',
    icon: 'network',
    description: 'Social capital, internet access, community connections.',
  },
  {
    slug: 'housing',
    canonical_slug: 'housing',
    name: 'Housing',
    icon: 'home',
    description: 'Affordable, adequate housing and freedom from homelessness.',
  },
  {
    slug: 'gender-equality',
    canonical_slug: 'gender_equality',
    name: 'Gender Equality',
    icon: 'venus-mars',
    description: 'Pay equity, representation, and safety.',
  },
  {
    slug: 'social-equity',
    canonical_slug: 'social_equity',
    name: 'Social Equity',
    icon: 'scale',
    description: 'Income inequality and racial equity.',
  },
  {
    slug: 'political-voice',
    canonical_slug: 'political_voice',
    name: 'Political Voice',
    icon: 'megaphone',
    description: 'Voter turnout and civic engagement.',
  },
  {
    slug: 'peace-justice',
    canonical_slug: 'peace_justice',
    name: 'Peace & Justice',
    icon: 'shield',
    description: 'Safety, incarceration, and institutional trust.',
  },
];

export const ecologicalFrameworkDimensions: FrameworkDimension[] = [
  {
    slug: 'climate-change',
    canonical_slug: 'climate_change',
    name: 'Climate Change',
    icon: 'thermometer-sun',
    description: 'Greenhouse gas emissions per capita.',
  },
  {
    slug: 'ocean-acidification',
    canonical_slug: 'ocean_acidification',
    name: 'Ocean Acidification',
    icon: 'waves',
    description: 'Marine pH and CO2 absorption impacts.',
  },
  {
    slug: 'chemical-pollution',
    canonical_slug: 'chemical_pollution',
    name: 'Chemical Pollution',
    icon: 'flask-conical',
    description: 'Pesticide use and toxic releases.',
  },
  {
    slug: 'nitrogen-phosphorus-loading',
    canonical_slug: 'nitrogen_phosphorus_loading',
    name: 'Nitrogen & Phosphorus Loading',
    icon: 'sprout',
    description: 'Fertilizer runoff and groundwater contamination.',
  },
  {
    slug: 'freshwater-withdrawals',
    canonical_slug: 'freshwater_withdrawals',
    name: 'Freshwater Withdrawals',
    icon: 'droplet',
    description: 'Water use vs sustainable yield.',
  },
  {
    slug: 'land-conversion',
    canonical_slug: 'land_conversion',
    name: 'Land Conversion',
    icon: 'trees',
    description: 'Development of natural land.',
  },
  {
    slug: 'biodiversity-loss',
    canonical_slug: 'biodiversity_loss',
    name: 'Biodiversity Loss',
    icon: 'bird',
    description: 'Species decline and habitat loss.',
  },
  {
    slug: 'air-pollution',
    canonical_slug: 'air_pollution',
    name: 'Air Pollution',
    icon: 'wind',
    description: 'PM2.5 and ozone levels.',
  },
  {
    slug: 'ozone-depletion',
    canonical_slug: 'ozone_depletion',
    name: 'Ozone Layer Depletion',
    icon: 'sun',
    description: 'Stratospheric ozone (largely global, not local).',
  },
];

export function frameworkDefaults(ring: Ring): FrameworkDimension[] {
  return ring === 'social' ? socialFrameworkDimensions : ecologicalFrameworkDimensions;
}
