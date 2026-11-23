import { isIP } from 'node:net';
import { fetchCivicJson } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

export const SOCRATA_MAX_LIMIT = 500;
const SOCRATA_DATASET_ID_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/i;
const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UNSAFE_SOQL_RE = /(?:;|--|\/\*|\*\/|\b(?:DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|EXEC)\b)/i;

/**
 * Curated allowlist of municipal, county, state, and federal Socrata SODA
 * portals. Any `.gov`, `.us`, or `.socrata.com` public hostname is also
 * admitted, and callers may extend this allowlist via `allowedDomains`.
 */
export const DEFAULT_SOCRATA_DOMAINS: readonly string[] = [
  'data.cityofnewyork.us',
  'data.sfgov.org',
  'data.ca.gov',
  'data.cdc.gov',
  'chronicdata.cdc.gov',
  'data.cityofchicago.org',
  'data.seattle.gov',
  'data.lacity.org',
  'data.lacounty.gov',
  'data.austintexas.gov',
  'data.boston.gov',
  'data.wa.gov',
  'data.ny.gov',
  'health.data.ny.gov',
  'data.texas.gov',
  'data.colorado.gov',
  'data.illinois.gov',
  'data.maryland.gov',
  'data.ct.gov',
  'data.pa.gov',
  'data.nj.gov',
  'data.oregon.gov',
  'data.hawaii.gov',
  'data.oaklandca.gov',
  'data.sanjoseca.gov',
  'data.cambridgema.gov',
  'data.providenceri.gov',
  'data.honolulu.gov',
  'data.kcmo.org',
  'data.cincinnati-oh.gov',
  'data.nola.gov',
  'data.somervillema.gov',
  'data.montgomerycountymd.gov',
  'data.kingcounty.gov',
  'data.acgov.org',
  'data.smcgov.org',
  'data.marincounty.org',
  'data.sccgov.org',
  'data.sonomacounty.ca.gov',
  'data.ramseycounty.us',
  'opendata.utah.gov',
  'data.medicaid.gov',
  'data.cms.gov',
  'data.transportation.gov',
  'data.nasa.gov',
  'www.dallasopendata.com',
];

const DEFAULT_DOMAIN_SET = new Set(DEFAULT_SOCRATA_DOMAINS);

export function normalizeSocrataDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.includes('://') || trimmed.includes('/') || trimmed.includes(':') || trimmed.includes('@')) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid Socrata domain "${raw}": pass a bare hostname like "data.cityofnewyork.us" without scheme, path, or port`,
    );
  }
  if (!HOSTNAME_RE.test(trimmed) || isIP(trimmed) !== 0) {
    throw new CivicDataError('INVALID_INPUT', `invalid Socrata domain "${raw}": expected a public DNS hostname`);
  }
  return trimmed;
}

export function isAllowedSocrataDomain(domain: string, extraAllowed: readonly string[] = []): boolean {
  const normalized = domain.trim().toLowerCase();
  if (!HOSTNAME_RE.test(normalized) || isIP(normalized) !== 0) return false;
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    return false;
  }
  if (DEFAULT_DOMAIN_SET.has(normalized)) return true;
  if (extraAllowed.some((d) => d.trim().toLowerCase() === normalized)) return true;
  return (
    normalized.endsWith('.gov') ||
    normalized.endsWith('.us') ||
    normalized.endsWith('.socrata.com')
  );
}

function assertSafeSoqlClause(name: string, value: string): string {
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || UNSAFE_SOQL_RE.test(trimmed)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `disallowed syntax in Socrata $${name} clause`,
    );
  }
  if (trimmed.length > 2000) {
    throw new CivicDataError('INVALID_INPUT', `Socrata $${name} clause exceeds 2000 characters`);
  }
  return trimmed;
}

export interface SocrataInput {
  /** Public civic Socrata hostname, e.g. `"data.cityofnewyork.us"`, `"data.sfgov.org"`, `"data.ca.gov"`. */
  domain: string;
  /** Socrata 4x4 dataset identifier, e.g. `"erm2-nwe9"`. */
  datasetId: string;
  select?: string;
  where?: string;
  group?: string;
  order?: string;
  /** Row limit (default: 100, strictly capped at <= 500). */
  limit?: number;
  offset?: number;
  /** Optional Socrata X-App-Token (sent via header, never in URL). */
  appToken?: string;
  /** Optional additional allowlisted Socrata domains for this call. */
  allowedDomains?: string[];
}

export type SocrataRow = Record<string, unknown>;

/**
 * Deterministic parameterized SoQL connector for municipal, state, and federal
 * Socrata SODA open-data portals (`https://<domain>/resource/<datasetId>.json`).
 * Enforces civic domain allowlisting, HTTPS-only egress, safe read-only SoQL
 * clauses, and a strict row cap (`<= 500`).
 */
export async function querySocrata(
  input: SocrataInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<SocrataRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  const domain = normalizeSocrataDomain(input.domain);
  if (!isAllowedSocrataDomain(domain, input.allowedDomains)) {
    throw new CivicDataError(
      'EGRESS_BLOCKED',
      `Socrata domain "${domain}" is not in the civic open-data allowlist`,
      { url: `https://${domain}` },
    );
  }

  const datasetId = input.datasetId.trim().toLowerCase();
  if (!SOCRATA_DATASET_ID_RE.test(datasetId)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid Socrata datasetId "${input.datasetId}": expected 4x4 identifier (e.g. "erm2-nwe9")`,
    );
  }

  const requestedLimit = input.limit ?? 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > SOCRATA_MAX_LIMIT) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid Socrata limit ${requestedLimit}: expected integer 1..${SOCRATA_MAX_LIMIT}`,
    );
  }

  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new CivicDataError('INVALID_INPUT', `invalid Socrata offset ${offset}: expected non-negative integer`);
  }

  const url = new URL(`https://${domain}/resource/${datasetId}.json`);
  if (input.select) url.searchParams.set('$select', assertSafeSoqlClause('select', input.select));
  if (input.where) url.searchParams.set('$where', assertSafeSoqlClause('where', input.where));
  if (input.group) url.searchParams.set('$group', assertSafeSoqlClause('group', input.group));
  if (input.order) url.searchParams.set('$order', assertSafeSoqlClause('order', input.order));
  url.searchParams.set('$limit', String(requestedLimit));
  if (offset > 0) url.searchParams.set('$offset', String(offset));

  const headers: Record<string, string> = {};
  if (input.appToken) {
    headers['X-App-Token'] = input.appToken;
  }

  const { data, canonicalUrl } = await fetchCivicJson<unknown>(
    { url: url.toString(), headers },
    opts,
  );

  if (!Array.isArray(data)) {
    const maybeErr = data as { message?: unknown; errorCode?: unknown } | null;
    if (maybeErr && typeof maybeErr === 'object' && maybeErr.message) {
      throw new CivicDataError(
        'API_ERROR',
        `Socrata SODA error on ${domain}/${datasetId}: ${String(maybeErr.message)}`,
        { url: canonicalUrl },
      );
    }
    throw new CivicDataError(
      'PARSE_ERROR',
      `Socrata SODA API returned non-array payload from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  const truncated = data.length > requestedLimit;
  const rows: SocrataRow[] = data
    .slice(0, requestedLimit)
    .map((item) => (item && typeof item === 'object' ? (item as SocrataRow) : { value: item }));

  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) columnSet.add(k);
  }

  return {
    connector: 'socrata',
    title: `Socrata Open Data (${domain} / ${datasetId})`,
    source_name: `${domain} Open Data Portal (dataset ${datasetId})`,
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      domain,
      dataset_id: datasetId,
      select: input.select,
      where: input.where,
      group: input.group,
      order: input.order,
      limit: requestedLimit,
      offset,
    },
    columns: [...columnSet],
    rows,
    row_count: rows.length,
    truncated,
    citation: {
      agency: domain,
      dataset: datasetId,
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: rows,
  };
}
