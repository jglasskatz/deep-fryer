import frameworkJson from '../framework/framework.json';
import thresholdsJson from '../framework/thresholds.json';

export type Ring = 'social' | 'ecological';
export type MappingFunctionName = 'higher_is_better' | 'lower_is_better' | 'band';
export type GeographicScale = 'city' | 'county' | 'regional' | 'state' | 'national' | 'global';

export interface FrameworkLens {
  slug: string;
  name: string;
  question: string;
}

export interface FrameworkIndicator {
  slug: string;
  name: string;
  unit: string;
  threshold_ref: string;
}

export interface FrameworkDimension {
  slug: string;
  ring: Ring;
  canonical_slug: string;
  name: string;
  icon: string;
  description: string;
  indicators: FrameworkIndicator[];
}

export interface Framework {
  version: string;
  rings: Ring[];
  lenses: FrameworkLens[];
  dimensions: FrameworkDimension[];
}

export interface Threshold {
  target: number;
  function: MappingFunctionName;
  scale?: number;
  low?: number;
  high?: number;
  rationale: string;
  /**
   * Year an adopted goal is due (e.g. LL148's 30% canopy by 2040). Framework
   * defaults are boundaries, not deadlines, so only overrides set it; progress
   * monitoring draws its glidepath to this year.
   */
  target_year?: number;
}

export interface Thresholds {
  version: string;
  functions: Record<string, string>;
  thresholds: Record<string, Threshold>;
}

export interface SourceTier {
  tier: number;
  name: string;
  description: string;
  examples?: string[];
}

export interface PortraitConfig {
  region: {
    name: string;
    definition: string;
    context_notes?: string;
  };
  source_priority: { tiers: SourceTier[] };
  recency: {
    default_max_age_years: number;
    per_dimension?: Record<string, number>;
  };
  scale_policy: {
    default_accepted: GeographicScale[];
    per_dimension?: Record<string, GeographicScale[]>;
  };
  threshold_overrides?: Record<string, Partial<Threshold> & { target: number; rationale: string }>;
}

export const framework: Framework = frameworkJson as Framework;
export const thresholds: Thresholds = thresholdsJson as Thresholds;

export function getThreshold(ref: string): Threshold | undefined {
  return thresholds.thresholds[ref];
}

/**
 * Resolve a tenant dimension to its framework dimension. Custom dimensions
 * map back via canonical_slug (SPEC.md §2), so the canonical slug wins when
 * present; both planning and rescoring use this one resolver.
 */
export function frameworkDimension(
  slug: string,
  canonicalSlug?: string | null,
): FrameworkDimension | undefined {
  return (
    framework.dimensions.find((d) => d.slug === (canonicalSlug ?? slug)) ??
    framework.dimensions.find((d) => d.slug === slug)
  );
}

/**
 * The onboarding starting point for the portrait layer. Tenant owners edit
 * this in settings; nothing about it is baked into prompts or code.
 */
export function defaultPortraitConfig(regionName: string, regionDefinition: string): PortraitConfig {
  return {
    region: { name: regionName, definition: regionDefinition },
    source_priority: {
      tiers: [
        {
          tier: 1,
          name: 'Official local government',
          description:
            'The jurisdiction itself: city/county departments, adopted plans, open-data portals, utility reports.',
          examples: ['cityofX.gov', 'county open data portal', 'municipal utility annual report'],
        },
        {
          tier: 2,
          name: 'State and federal statistical agencies',
          description:
            'Census/ACS, CDC, EPA, HUD, BLS, state departments — official series with the jurisdiction as a reporting unit.',
          examples: ['data.census.gov', 'EPA SDWIS/TRI', 'HUD PIT counts', 'state health department'],
        },
        {
          tier: 3,
          name: 'Established research institutions',
          description:
            'Universities, national labs, and long-running nonprofit research series with published methodology.',
          examples: ['County Health Rankings', 'Feeding America Map the Meal Gap', 'university institutes'],
        },
        {
          tier: 4,
          name: 'Reputable secondary reporting',
          description:
            'Journalism and advocacy reports that cite primary data — acceptable only when tiers 1–3 are exhausted, and flagged for review.',
          examples: ['local newspaper data desk', 'issue-advocacy reports with cited sources'],
        },
      ],
    },
    recency: { default_max_age_years: 5 },
    scale_policy: {
      default_accepted: ['city', 'county'],
      per_dimension: {
        'climate-change': ['city', 'county', 'regional'],
        'ocean-acidification': ['city', 'county', 'regional', 'global'],
        'ozone-depletion': ['city', 'county', 'regional', 'state', 'national', 'global'],
      },
    },
  };
}
