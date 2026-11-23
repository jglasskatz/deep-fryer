export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type CivicDataConnectorId =
  | 'census_acs'
  | 'bls_laus'
  | 'cdc_places'
  | 'epa_envirofacts'
  | 'socrata'
  | 'arcgis_features';

export type CivicDataErrorCode =
  | 'INVALID_INPUT'
  | 'EGRESS_BLOCKED'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'API_ERROR'
  | 'RESPONSE_TOO_LARGE';

export class CivicDataError extends Error {
  readonly code: CivicDataErrorCode;
  readonly status?: number;
  readonly url?: string;

  constructor(
    code: CivicDataErrorCode,
    message: string,
    details?: { status?: number; url?: string; cause?: unknown },
  ) {
    super(message, details?.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'CivicDataError';
    this.code = code;
    this.status = details?.status;
    this.url = details?.url;
  }
}

export interface CivicDataHttpOptions {
  /**
   * Injectable HTTP transport. When omitted, requests go through
   * `@deep-fryer/research`'s `guardedFetch` (HTTPS-only, public IPs only,
   * manual redirect re-validation).
   */
  fetch?: FetchFn;
  /** Per-request timeout in milliseconds (default: 20_000). */
  timeoutMs?: number;
  /** Maximum response body size in bytes (default: 8 MiB). */
  maxResponseBytes?: number;
  /** Optional DNS resolver passed to `guardedFetch` / `assertPublicHttpsUrl`. */
  resolve?: (host: string) => Promise<string[]>;
  /** Optional clock override for deterministic tests. */
  now?: () => Date;
  /** Custom User-Agent header for public civic API etiquette. */
  userAgent?: string;
}

export interface CivicDataCitation {
  agency: string;
  dataset: string;
  year?: number | string;
  source_tier_hint: 1;
  canonical_url: string;
}

export interface CivicDataResult<TRow = Record<string, unknown>> {
  connector: CivicDataConnectorId;
  title: string;
  source_name: string;
  /** Canonical API query URL with any API keys or tokens redacted. */
  source_url: string;
  /** ISO-8601 UTC retrieval timestamp. */
  retrieved_at: string;
  /** Sanitized query parameters (no API keys/tokens). */
  query_params: Record<string, unknown>;
  columns: string[];
  rows: TRow[];
  row_count: number;
  truncated?: boolean;
  notes?: string[];
  citation: CivicDataCitation;
  /** Raw parsed JSON payload from the upstream API (optional, bounded). */
  raw_payload?: unknown;
}
