import { z } from 'zod';

export const ringSchema = z.enum(['social', 'ecological']);
export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export const roleSchema = z.enum(['owner', 'editor', 'viewer']);
export const versionStatusSchema = z.enum(['draft', 'published', 'archived']);
export const geographicScaleSchema = z.enum(['city', 'county', 'state', 'national']);

export const indicatorSchema = z.object({
  name: z.string(),
  value: z.union([z.number(), z.string(), z.null()]),
  unit: z.string(),
  year: z.number().int().nullable(),
  target: z.union([z.number(), z.string(), z.null()]),
  shortfall_pct: z.number().optional(),
  overshoot_pct: z.number().optional(),
  source: z.string(),
  source_url: z.string(),
  source_doc_path: z.string().optional(),
  confidence: confidenceSchema,
  geographic_scale: geographicScaleSchema,
});

export const dimensionDataSchema = z.object({
  name: z.string(),
  icon: z.string(),
  description: z.string(),
  context: z.string(),
  indicators: z.array(indicatorSchema),
  actions: z.array(z.string()),
  policy_spotlight: z.string().optional(),
  justice_spotlight: z.string().optional(),
});

export const outreachContactDataSchema = z.object({
  org: z.string(),
  person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  tags: z.array(z.string()),
  data_needs: z.array(z.string()),
  why: z.string().optional(),
  draft_message: z.string().optional(),
});

export const tenantBrandingSchema = z.object({
  logo_url: z.string().optional(),
  primary_color: z.string().optional(),
  font: z.string().optional(),
  footer_html: z.string().optional(),
});
