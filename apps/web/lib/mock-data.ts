import type { Ring } from '@deep-fryer/core';

export interface MockDimension {
  ring: Ring;
  slug: string;
  name: string;
  icon: string;
  viz_level: number;
}

export interface MockTenant {
  slug: string;
  name: string;
  region: string;
  population: number;
  description: string;
  dimensions: MockDimension[];
}

export const mockTenant: MockTenant = {
  slug: 'santacruz',
  name: 'City of Santa Cruz',
  region: 'CA, USA',
  population: 65000,
  description:
    'Coastal city of ~65,000 on Monterey Bay, home to UC Santa Cruz and a global biodiversity hotspot.',
  dimensions: [
    { ring: 'social', slug: 'food', name: 'Food', icon: 'utensils', viz_level: 35 },
    { ring: 'social', slug: 'health', name: 'Health', icon: 'heart-pulse', viz_level: 20 },
    { ring: 'social', slug: 'education', name: 'Education', icon: 'graduation-cap', viz_level: -10 },
    { ring: 'social', slug: 'income-work', name: 'Income & Work', icon: 'briefcase', viz_level: 60 },
    { ring: 'social', slug: 'water-sanitation', name: 'Water & Sanitation', icon: 'droplets', viz_level: 5 },
    { ring: 'social', slug: 'energy', name: 'Energy', icon: 'zap', viz_level: 40 },
    { ring: 'social', slug: 'networks', name: 'Networks', icon: 'network', viz_level: 15 },
    { ring: 'social', slug: 'housing', name: 'Housing', icon: 'home', viz_level: 140 },
    { ring: 'social', slug: 'gender-equality', name: 'Gender Equality', icon: 'venus-mars', viz_level: 45 },
    { ring: 'social', slug: 'social-equity', name: 'Social Equity', icon: 'scale', viz_level: 70 },
    { ring: 'social', slug: 'political-voice', name: 'Political Voice', icon: 'megaphone', viz_level: -20 },
    { ring: 'social', slug: 'peace-justice', name: 'Peace & Justice', icon: 'shield', viz_level: 30 },

    { ring: 'ecological', slug: 'climate-change', name: 'Climate Change', icon: 'thermometer-sun', viz_level: 110 },
    { ring: 'ecological', slug: 'ocean-acidification', name: 'Ocean Acidification', icon: 'waves', viz_level: 65 },
    { ring: 'ecological', slug: 'chemical-pollution', name: 'Chemical Pollution', icon: 'flask-conical', viz_level: 80 },
    { ring: 'ecological', slug: 'nitrogen-phosphorus-loading', name: 'Nitrogen & Phosphorus Loading', icon: 'sprout', viz_level: 90 },
    { ring: 'ecological', slug: 'freshwater-withdrawals', name: 'Freshwater Withdrawals', icon: 'droplet', viz_level: 55 },
    { ring: 'ecological', slug: 'land-conversion', name: 'Land Conversion', icon: 'trees', viz_level: 40 },
    { ring: 'ecological', slug: 'biodiversity-loss', name: 'Biodiversity Loss', icon: 'bird', viz_level: 75 },
    { ring: 'ecological', slug: 'air-pollution', name: 'Air Pollution', icon: 'wind', viz_level: 25 },
    { ring: 'ecological', slug: 'ozone-depletion', name: 'Ozone Layer Depletion', icon: 'sun', viz_level: -30 },
  ],
};
