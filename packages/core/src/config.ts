import type { GeographicScale, PortraitConfig } from '@deep-fryer/contract';
import type { FindingVerification } from './types.js';

/**
 * Portrait-config semantics live here, not at callsites (SPEC.md §6): the
 * plan renderer, the verifier, and the admin staleness view must all answer
 * "what does the policy say for this dimension" identically.
 */

export function maxDataAgeYears(
  recency: PortraitConfig['recency'],
  dimensionSlug: string,
): number {
  return recency.per_dimension?.[dimensionSlug] ?? recency.default_max_age_years;
}

export function acceptedScales(
  scalePolicy: PortraitConfig['scale_policy'],
  dimensionSlug: string,
): GeographicScale[] {
  return scalePolicy.per_dimension?.[dimensionSlug] ?? scalePolicy.default_accepted;
}

/**
 * A finding is red-flagged for review when any check fails (never dropped),
 * or when it was salvaged from a session's malformed output (partial_output:
 * the session may have returned findings that could not be read).
 */
export function isFlagged(v: FindingVerification): boolean {
  return (
    !v.schema_ok ||
    !v.url_ok ||
    !v.recency_ok ||
    !v.scale_ok ||
    v.content_supported !== 'pass' ||
    v.partial_output === true
  );
}

/**
 * The tenant_config key that marks a portrait's published values as
 * synthetic. scripts/seed-demo-data.ts sets it on every portrait it seeds,
 * and the public plane then labels the portrait "Sample data — not research"
 * on its pages, its embed and its organization's pages, with the same flag
 * at the top of the open-data API — so a screenshot of a demo stack cannot
 * pass for a city's measurements.
 *
 * Deliberately not one of the owner-editable settings (TenantConfigMap and
 * the settings page's schemas): a portrait's staff cannot switch the notice
 * off, and nothing but the seeding script (or an operator in the database)
 * sets it. Migration 0015 makes the key publicly readable, like `features`.
 */
export const SAMPLE_DATA_CONFIG_KEY = 'sample_data';

/**
 * Whether a stored `sample_data` value marks the portrait. Only literal true
 * does — the value the seeding script writes — so an operator who replaces
 * the sample values with real research clears the notice by deleting the
 * row or setting it to false.
 */
export function isSampleDataValue(value: unknown): boolean {
  return value === true;
}

/** One storage bucket per tenant (SPEC.md §4) — the single home of the naming convention. */
export function tenantBucketName(tenantSlug: string): string {
  return `tenant-${tenantSlug}`;
}

/**
 * Public URL prefix for a tenant's evidence objects — shared by the worker
 * (which writes `evidence/<key>` under the tenant prefix) and the web app
 * (which renders them), so the two can never disagree on the layout.
 * With an S3-compatible store the tenant prefix sits under the public bucket
 * URL; locally the web app serves files from public/evidence/<tenant>/.
 */
export function evidencePublicBase(tenantSlug: string, s3PublicUrl?: string | null): string {
  if (s3PublicUrl) return `${s3PublicUrl.replace(/\/+$/, '')}/${tenantBucketName(tenantSlug)}`;
  return `/evidence/${tenantSlug}`;
}
