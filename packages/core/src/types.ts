export type Ring = 'social' | 'ecological';
export type Confidence = 'high' | 'medium' | 'low';
export type Role = 'owner' | 'editor' | 'viewer';
export type VersionStatus = 'draft' | 'published' | 'archived';
export type GeographicScale = 'city' | 'county' | 'state' | 'national';

export interface Indicator {
  name: string;
  value: number | string | null;
  unit: string;
  year: number | null;
  target: number | string | null;
  shortfall_pct?: number;
  overshoot_pct?: number;
  source: string;
  source_url: string;
  source_doc_path?: string;
  confidence: Confidence;
  geographic_scale: GeographicScale;
}

export interface DimensionData {
  name: string;
  icon: string;
  description: string;
  context: string;
  indicators: Indicator[];
  actions: string[];
  policy_spotlight?: string;
  justice_spotlight?: string;
}

export interface OutreachContactData {
  org: string;
  person?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  tags: string[];
  data_needs: string[];
  why?: string;
  draft_message?: string;
}

export interface TenantBranding {
  logo_url?: string;
  primary_color?: string;
  font?: string;
  footer_html?: string;
}

export interface FrameworkDimension {
  slug: string;
  canonical_slug: string;
  name: string;
  icon: string;
  description: string;
}
