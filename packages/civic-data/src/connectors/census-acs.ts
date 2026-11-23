import { assertCountyFips, assertPlaceFips, assertPumaId, resolveStateInput } from '../fips.js';
import { fetchCivicJson } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

/**
 * Official US Census Bureau ACS sentinel missing/annotation values.
 * Every sentinel MUST be converted to `null` (never treated as a numeric measurement).
 */
export const CENSUS_SENTINEL_CODES: Readonly<Record<number, string>> = {
  [-666666666]: 'estimate not computed (too few sample observations or controlled)',
  [-999999999]: 'data suppressed (insufficient sample cases)',
  [-888888888]: 'not applicable (or median in open-ended interval)',
  [-555555555]: 'controlled estimate (margin of error not applicable)',
  [-333333333]: 'median falls in lowest interval of open-ended distribution',
  [-222222222]: 'insufficient sample observations to compute margin of error',
};

export type CensusTableGroup = 'detail' | 'subject' | 'profile' | 'cprofile';

export interface CensusAcsGeography {
  /** 2-digit state FIPS (e.g. "06"), 2-letter abbr ("CA"), or full state name. */
  state: string;
  /** 3-digit county FIPS (e.g. "087") or "*" for all counties in state. */
  county?: string;
  /** 5-digit place FIPS (e.g. "69084") or "*" for all places in state. */
  place?: string;
  /** 5-digit PUMA code or "*" for all PUMAs in state. */
  puma?: string;
  /** 6-digit tract code or "*" (requires `county`). */
  tract?: string;
}

export interface CensusAcsInput {
  dataset: 'acs5' | 'acs1';
  year: number;
  variables: string[];
  /** When true, automatically fetches paired `_M` margin-of-error variables for each `_E` variable. */
  includeMoe?: boolean;
  geography: CensusAcsGeography;
  /** Explicit table group override; auto-detected from variable prefix when omitted. */
  tableGroup?: CensusTableGroup;
  /** Optional Census API key (omitted from archived canonical URL). */
  apiKey?: string;
}

export interface CensusSentinelNote {
  code: number;
  reason: string;
}

export interface CensusAcsRow {
  name: string;
  geography: Record<string, string>;
  values: Record<string, number | null>;
  margins_of_error: Record<string, number | null>;
  missing_sentinels: Record<string, CensusSentinelNote>;
}

const CENSUS_VAR_RE = /^[A-Z][A-Z0-9_]{2,31}$/;
const TRACT_RE = /^\d{6}$/;
const MAX_CENSUS_VARIABLES = 49; // Reserve 1 slot for NAME (Census cap is 50 vars per request)

function detectTableGroup(variable: string): CensusTableGroup {
  if (variable.startsWith('DP')) return 'profile';
  if (variable.startsWith('CP')) return 'cprofile';
  if (variable.startsWith('S')) return 'subject';
  return 'detail';
}

function tableGroupPathSuffix(group: CensusTableGroup): string {
  switch (group) {
    case 'detail':
      return '';
    case 'subject':
      return '/subject';
    case 'profile':
      return '/profile';
    case 'cprofile':
      return '/cprofile';
  }
}

function parseCensusNumericValue(
  raw: unknown,
): { value: number | null; sentinel?: CensusSentinelNote } {
  if (raw === null || raw === undefined) return { value: null };
  const text = String(raw).trim();
  if (text === '' || text.toLowerCase() === 'null' || text === 'N' || text === '-' || text === '(X)') {
    return { value: null };
  }
  const num = Number(text);
  if (!Number.isFinite(num)) {
    return { value: null };
  }
  const sentinelReason = CENSUS_SENTINEL_CODES[num];
  if (sentinelReason !== undefined) {
    return {
      value: null,
      sentinel: { code: num, reason: sentinelReason },
    };
  }
  return { value: num };
}

function buildGeographyParams(geo: CensusAcsGeography): {
  forClause: string;
  inClause?: string;
  normalizedGeo: Record<string, string>;
} {
  const stateEntry = resolveStateInput(geo.state);
  if (!stateEntry) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid geography.state "${geo.state}": expected a valid US state FIPS, postal abbreviation, or name`,
    );
  }
  const stateFips = stateEntry.fips;

  const hasCounty = geo.county !== undefined && geo.county.trim() !== '';
  const hasPlace = geo.place !== undefined && geo.place.trim() !== '';
  const hasPuma = geo.puma !== undefined && geo.puma.trim() !== '';
  const hasTract = geo.tract !== undefined && geo.tract.trim() !== '';

  if (hasTract && !hasCounty) {
    throw new CivicDataError('INVALID_INPUT', 'geography.tract requires geography.county');
  }
  if (hasPlace && (hasCounty || hasPuma || hasTract)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      'geography.place cannot be combined with county, puma, or tract in Census ACS queries',
    );
  }
  if (hasPuma && (hasCounty || hasTract)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      'geography.puma cannot be combined with county or tract in Census ACS queries',
    );
  }

  if (hasTract) {
    const county = geo.county!.trim() === '*' ? '*' : assertCountyFips(geo.county!);
    const tract = geo.tract!.trim();
    if (tract !== '*' && !TRACT_RE.test(tract)) {
      throw new CivicDataError('INVALID_INPUT', `invalid geography.tract "${tract}": expected 6 digits or "*"`);
    }
    return {
      forClause: `tract:${tract}`,
      inClause: `state:${stateFips} county:${county}`,
      normalizedGeo: { state: stateFips, county, tract },
    };
  }

  if (hasPlace) {
    const place = geo.place!.trim() === '*' ? '*' : assertPlaceFips(geo.place!);
    return {
      forClause: `place:${place}`,
      inClause: `state:${stateFips}`,
      normalizedGeo: { state: stateFips, place },
    };
  }

  if (hasPuma) {
    const puma = geo.puma!.trim() === '*' ? '*' : assertPumaId(geo.puma!);
    return {
      forClause: `public use microdata area:${puma}`,
      inClause: `state:${stateFips}`,
      normalizedGeo: { state: stateFips, puma },
    };
  }

  if (hasCounty) {
    const county = geo.county!.trim() === '*' ? '*' : assertCountyFips(geo.county!);
    return {
      forClause: `county:${county}`,
      inClause: `state:${stateFips}`,
      normalizedGeo: { state: stateFips, county },
    };
  }

  return {
    forClause: `state:${stateFips}`,
    normalizedGeo: { state: stateFips },
  };
}

/**
 * Deterministic connector for the US Census Bureau American Community Survey
 * (ACS 1-Year and 5-Year API). Parses 2D array responses, converts Census
 * sentinel missing codes (`-666666666`, `-999999999`, `-888888888`, etc.)
 * honestly to `null`, pairs `_M` margins of error, and redacts any API key
 * from the canonical citation URL.
 */
export async function queryCensusAcs(
  input: CensusAcsInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<CensusAcsRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  if (input.dataset !== 'acs5' && input.dataset !== 'acs1') {
    throw new CivicDataError('INVALID_INPUT', `unsupported ACS dataset "${String(input.dataset)}": expected "acs5" or "acs1"`);
  }
  if (!Number.isInteger(input.year) || input.year < 2009 || input.year > 2030) {
    throw new CivicDataError('INVALID_INPUT', `invalid ACS year ${input.year}: expected integer 2009..2030`);
  }
  if (!Array.isArray(input.variables) || input.variables.length === 0) {
    throw new CivicDataError('INVALID_INPUT', 'variables must be a non-empty array of Census variable codes');
  }

  const requestedVars: string[] = [];
  const seen = new Set<string>();
  const detectedGroups = new Set<CensusTableGroup>();

  for (const rawVar of input.variables) {
    const code = rawVar.trim().toUpperCase();
    if (!CENSUS_VAR_RE.test(code)) {
      throw new CivicDataError(
        'INVALID_INPUT',
        `invalid Census variable "${rawVar}": expected alphanumeric/underscore identifier (e.g. "B17001_002E")`,
      );
    }
    if (code === 'NAME') continue;
    detectedGroups.add(detectTableGroup(code));
    if (!seen.has(code)) {
      seen.add(code);
      requestedVars.push(code);
    }
    if (input.includeMoe && code.endsWith('E')) {
      const moeCode = `${code.slice(0, -1)}M`;
      if (!seen.has(moeCode)) {
        seen.add(moeCode);
        requestedVars.push(moeCode);
      }
    }
  }

  if (requestedVars.length === 0) {
    throw new CivicDataError('INVALID_INPUT', 'variables must contain at least one Census data variable');
  }
  if (requestedVars.length > MAX_CENSUS_VARIABLES) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `requested ${requestedVars.length} Census variables (including MOE); maximum per request is ${MAX_CENSUS_VARIABLES}`,
    );
  }

  let tableGroup: CensusTableGroup;
  if (input.tableGroup) {
    tableGroup = input.tableGroup;
  } else if (detectedGroups.size > 1) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `cannot mix Census table groups in one request (${[...detectedGroups].join(', ')}); issue one query per table group`,
    );
  } else {
    tableGroup = [...detectedGroups][0] ?? 'detail';
  }

  const { forClause, inClause, normalizedGeo } = buildGeographyParams(input.geography);
  const url = new URL(
    `https://api.census.gov/data/${input.year}/acs/${input.dataset}${tableGroupPathSuffix(tableGroup)}`,
  );
  url.searchParams.set('get', ['NAME', ...requestedVars].join(','));
  url.searchParams.set('for', forClause);
  if (inClause) {
    url.searchParams.set('in', inClause);
  }
  if (input.apiKey) {
    url.searchParams.set('key', input.apiKey);
  }

  const { data, canonicalUrl } = await fetchCivicJson<unknown>({ url: url.toString() }, opts);

  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `Census ACS API returned unexpected payload (expected 2D array) from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  const headers = (data[0] as unknown[]).map((h) => String(h));
  const geoColumns = new Set(['state', 'county', 'place', 'tract', 'public use microdata area']);
  const requestedSet = new Set(requestedVars);

  const rows: CensusAcsRow[] = [];
  let sentinelCount = 0;

  for (let i = 1; i < data.length; i++) {
    const rawRow = data[i];
    if (!Array.isArray(rawRow)) continue;

    let name = '';
    const geography: Record<string, string> = {};
    const values: Record<string, number | null> = {};
    const marginsOfError: Record<string, number | null> = {};
    const missingSentinels: Record<string, CensusSentinelNote> = {};

    for (let col = 0; col < headers.length; col++) {
      const header = headers[col]!;
      const cell = rawRow[col];

      if (header === 'NAME') {
        name = String(cell ?? '').trim();
        continue;
      }
      if (geoColumns.has(header)) {
        const key = header === 'public use microdata area' ? 'puma' : header;
        geography[key] = String(cell ?? '').trim();
        continue;
      }
      if (!requestedSet.has(header)) {
        continue;
      }

      const parsed = parseCensusNumericValue(cell);
      if (parsed.sentinel) {
        missingSentinels[header] = parsed.sentinel;
        sentinelCount++;
      }

      if (header.endsWith('M')) {
        marginsOfError[header] = parsed.value;
      } else {
        values[header] = parsed.value;
      }
    }

    rows.push({
      name,
      geography,
      values,
      margins_of_error: marginsOfError,
      missing_sentinels: missingSentinels,
    });
  }

  const notes: string[] = [];
  if (!input.apiKey) {
    notes.push('Queried Census API without CENSUS_API_KEY (public unauthenticated rate limit applies).');
  }
  if (sentinelCount > 0) {
    notes.push(
      `Converted ${sentinelCount} Census sentinel missing code(s) to null; see row missing_sentinels for exact Census suppression reasons.`,
    );
  }

  const datasetLabel = input.dataset === 'acs5' ? 'ACS 5-Year Estimates' : 'ACS 1-Year Estimates';
  return {
    connector: 'census_acs',
    title: `US Census ${datasetLabel} (${input.year})`,
    source_name: `U.S. Census Bureau, ${input.year} American Community Survey (${input.dataset.toUpperCase()})`,
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      dataset: input.dataset,
      year: input.year,
      table_group: tableGroup,
      variables: requestedVars,
      include_moe: Boolean(input.includeMoe),
      geography: normalizedGeo,
    },
    columns: ['name', ...Object.keys(normalizedGeo), ...requestedVars],
    rows,
    row_count: rows.length,
    notes,
    citation: {
      agency: 'U.S. Census Bureau',
      dataset: `American Community Survey ${input.dataset === 'acs5' ? '5-Year' : '1-Year'} (${tableGroup})`,
      year: input.year,
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: data,
  };
}
