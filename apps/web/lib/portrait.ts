import type { DimensionData, Ring, TenantBranding } from '@deep-fryer/core';

/** Shape returned by the published_doughnut(slug) SQL function. */
export interface PublishedPortrait {
  tenant: {
    slug: string;
    name: string;
    region: string | null;
    population: number | null;
    description: string | null;
    branding: TenantBranding | null;
  };
  dimensions: PublishedDimension[];
}

export interface PublishedDimension {
  slug: string;
  ring: Ring;
  canonical_slug: string | null;
  display_order: number;
  viz_level: number | null;
  data: DimensionData;
  published_at: string | null;
  version_num: number;
}
