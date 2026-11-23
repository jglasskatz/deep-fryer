import { resolveStateInput } from '../fips.js';
import { fetchCivicJson } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

export type EpaEnvirofactsDataset = 'sdwis' | 'tri' | 'aqs';

export interface EpaEnvirofactsInput {
  /**
   * - `sdwis`: Safe Drinking Water Information System (drinking water violations)
   * - `tri`: Toxics Release Inventory (industrial chemical releases)
   * - `aqs`: Air Quality System (annual monitor summaries, e.g. PM2.5 / Ozone)
   */
  dataset: EpaEnvirofactsDataset;
  /** 2-letter US state postal code (e.g. "CA"), state name, or 2-digit FIPS. */
  stateAbbr: string;
  /** Optional county name (without trailing "County", though trailing "County" is stripped). */
  countyName?: string;
  /** Optional reporting/compliance year (e.g. 2023). */
  year?: number;
  /** Maximum rows returned (default: 100, capped at 500). */
  limit?: number;
}

export type EpaEnvirofactsRow = Record<string, string | number | boolean | null>;

const MAX_LIMIT = 500;
const COUNTY_NAME_RE = /^[A-Za-z0-9 .'\-]{1,80}$/;

/** Columns whose values look numeric but must stay strings to preserve leading zeros / IDs. */
const STRING_ID_COLUMNS = new Set([
  'pwsid',
  'violation_id',
  'violation_code',
  'contaminant_code',
  'state_code',
  'county_code',
  'site_num',
  'parameter_code',
  'poc',
  'zip',
  'zip_code',
  'tri_facility_id',
  'frs_id',
  'cas_num',
  'chemical_id',
  'primacy_agency_code',
]);

function normalizeCountySegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+(?:county|parish|borough)$/i, '')
    .trim();
  if (!cleaned || !COUNTY_NAME_RE.test(cleaned)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid countyName "${raw}": contains disallowed characters`,
    );
  }
  return cleaned.toUpperCase();
}

function normalizeEpaRow(raw: unknown): EpaEnvirofactsRow {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: EpaEnvirofactsRow = {};
  for (const [key, val] of Object.entries(source)) {
    const k = key.toLowerCase();
    if (val === null || val === undefined || val === '') {
      out[k] = null;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      out[k] = val;
    } else {
      const str = String(val).trim();
      if (str === '' || str.toLowerCase() === 'null') {
        out[k] = null;
      } else if (!STRING_ID_COLUMNS.has(k) && /^-?\d+(?:\.\d+)?$/.test(str)) {
        const num = Number(str);
        out[k] = Number.isFinite(num) ? num : str;
      } else {
        out[k] = str;
      }
    }
  }
  return out;
}

function buildEnvirofactsPath(
  dataset: EpaEnvirofactsDataset,
  stateAbbr: string,
  stateFips: string,
  countySegment: string | undefined,
  year: number | undefined,
  limit: number,
): { path: string; datasetTitle: string; datasetLabel: string } {
  const rowWindow = `rows/0:${limit - 1}/JSON`;

  if (dataset === 'sdwis') {
    const segments = countySegment
      ? [
          'GEOGRAPHIC_AREA',
          'STATE_SERVED',
          encodeURIComponent(stateAbbr),
          'COUNTY_SERVED',
          encodeURIComponent(countySegment),
          'VIOLATION',
        ]
      : ['VIOLATION', 'PRIMACY_AGENCY_CODE', encodeURIComponent(stateAbbr)];

    if (year !== undefined) {
      segments.push('COMPL_PER_BEGIN_DATE', 'CONTAINING', String(year));
    }
    segments.push(rowWindow);
    return {
      path: segments.join('/'),
      datasetTitle: 'Safe Drinking Water Information System (SDWIS) Violations',
      datasetLabel: 'SDWIS Drinking Water Violations',
    };
  }

  if (dataset === 'tri') {
    const segments = ['V_TRI_FORM_R_EZ', 'ST', encodeURIComponent(stateAbbr)];
    if (countySegment) {
      segments.push('COUNTY', encodeURIComponent(countySegment));
    }
    if (year !== undefined) {
      segments.push('REPORTING_YEAR', String(year));
    }
    segments.push(rowWindow);
    return {
      path: segments.join('/'),
      datasetTitle: 'Toxics Release Inventory (TRI) Form R Releases',
      datasetLabel: 'Toxics Release Inventory (TRI)',
    };
  }

  // dataset === 'aqs'
  const segments = ['AQS_ANNUAL_SUMMARY', 'STATE_CODE', encodeURIComponent(stateFips)];
  if (countySegment) {
    segments.push('COUNTY_NAME', encodeURIComponent(countySegment));
  }
  if (year !== undefined) {
    segments.push('YEAR', String(year));
  }
  segments.push(rowWindow);
  return {
    path: segments.join('/'),
    datasetTitle: 'Air Quality System (AQS) Annual Summary',
    datasetLabel: 'Air Quality System (AQS)',
  };
}

/**
 * Deterministic connector for the U.S. EPA Envirofacts REST API (`data.epa.gov`)
 * covering Safe Drinking Water violations (`sdwis`), Toxics Release Inventory
 * (`tri`), and Air Quality System annual summaries (`aqs`).
 */
export async function queryEpaEnvirofacts(
  input: EpaEnvirofactsInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<EpaEnvirofactsRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  if (input.dataset !== 'sdwis' && input.dataset !== 'tri' && input.dataset !== 'aqs') {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid EPA Envirofacts dataset "${String(input.dataset)}": expected "sdwis", "tri", or "aqs"`,
    );
  }

  const stateEntry = resolveStateInput(input.stateAbbr);
  if (!stateEntry) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid stateAbbr "${input.stateAbbr}": expected a US state postal abbreviation, name, or FIPS`,
    );
  }

  if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 1987 || input.year > 2030)) {
    throw new CivicDataError('INVALID_INPUT', `invalid year ${input.year}: expected integer 1987..2030`);
  }

  const requestedLimit = input.limit ?? 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_LIMIT) {
    throw new CivicDataError('INVALID_INPUT', `invalid limit ${requestedLimit}: expected integer 1..${MAX_LIMIT}`);
  }

  const countySegment = input.countyName ? normalizeCountySegment(input.countyName) : undefined;
  const { path, datasetTitle, datasetLabel } = buildEnvirofactsPath(
    input.dataset,
    stateEntry.abbr,
    stateEntry.fips,
    countySegment,
    input.year,
    requestedLimit,
  );

  const url = `https://data.epa.gov/efservice/${path}`;
  const { data, canonicalUrl } = await fetchCivicJson<unknown>({ url }, opts);

  if (!Array.isArray(data)) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `EPA Envirofacts API returned non-array payload from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  const truncated = data.length > requestedLimit;
  const bounded = data.slice(0, requestedLimit);
  const rows = bounded.map(normalizeEpaRow);

  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) columnSet.add(k);
  }

  return {
    connector: 'epa_envirofacts',
    title: `EPA Envirofacts ${datasetLabel} — ${countySegment ? `${countySegment}, ` : ''}${stateEntry.abbr}${input.year ? ` (${input.year})` : ''}`,
    source_name: `U.S. Environmental Protection Agency, Envirofacts ${datasetTitle}`,
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      dataset: input.dataset,
      state_abbr: stateEntry.abbr,
      state_fips: stateEntry.fips,
      county_name: countySegment,
      year: input.year,
      limit: requestedLimit,
    },
    columns: [...columnSet],
    rows,
    row_count: rows.length,
    truncated,
    citation: {
      agency: 'U.S. Environmental Protection Agency (EPA)',
      dataset: datasetTitle,
      year: input.year,
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: bounded,
  };
}
