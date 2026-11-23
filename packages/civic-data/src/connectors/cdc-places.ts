import { resolveStateInput } from '../fips.js';
import { fetchCivicJson } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

export type CdcPlacesLevel = 'county' | 'place' | 'tract';

/** Official CDC PLACES SODA dataset IDs hosted on `data.cdc.gov`. */
export const CDC_PLACES_DATASETS: Readonly<Record<CdcPlacesLevel, string>> = {
  county: 'swc5-untb',
  place: 'eav7-hnsx',
  tract: 'cwsq-ngmh',
};

export interface CdcPlacesInput {
  level: CdcPlacesLevel;
  /** 2-letter US state abbreviation (e.g. "CA"), state name, or 2-digit FIPS. */
  stateAbbr: string;
  /** Optional city/county name filter (case-insensitive substring match). */
  locationName?: string;
  /** Optional exact FIPS / GEOID filter (e.g. "06087" for county, "0669084" for place). */
  locationId?: string;
  /** CDC PLACES measure ID (e.g. "ACCESS2", "BPHIGH", "CASTHMA", "DIABETES", "MHLTH", "PHLTH"). */
  measureId: string;
  /** Optional observation year (e.g. 2022). */
  year?: number;
  /** Filter to crude prevalence ("CrdPrv"), age-adjusted ("AgeAdjPrv"), or both ("all", default). */
  dataValueType?: 'CrdPrv' | 'AgeAdjPrv' | 'all';
  /** Maximum rows returned (default: 100, capped at 500). */
  limit?: number;
}

export interface CdcPlacesRow {
  year: number | null;
  state_abbr: string;
  state_desc: string;
  location_name: string;
  location_id: string;
  category: string;
  measure: string;
  measure_id: string;
  data_value_type: string;
  data_value_type_id: string;
  data_value_unit: string;
  value: number | null;
  low_confidence_limit: number | null;
  high_confidence_limit: number | null;
  total_population: number | null;
  footnote: string | null;
}

const MEASURE_ID_RE = /^[A-Z0-9_]{2,32}$/;
const LOCATION_ID_RE = /^[0-9]{2,15}$/;
const MAX_LIMIT = 500;

function escapeSoqlString(value: string): string {
  // Escape single quotes by doubling per SoQL syntax, and strip control chars.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/'/g, "''");
}

function parseOptionalNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '' || text.toLowerCase() === 'null') return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/**
 * Deterministic connector for CDC PLACES (Local Data for Better Health) via
 * the `data.cdc.gov` SODA API. Returns crude and/or age-adjusted prevalence
 * estimates alongside their 95% confidence intervals.
 */
export async function queryCdcPlaces(
  input: CdcPlacesInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<CdcPlacesRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  const datasetId = CDC_PLACES_DATASETS[input.level];
  if (!datasetId) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid CDC PLACES level "${String(input.level)}": expected "county", "place", or "tract"`,
    );
  }

  const stateEntry = resolveStateInput(input.stateAbbr);
  if (!stateEntry) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid stateAbbr "${input.stateAbbr}": expected a US state postal abbreviation, name, or FIPS`,
    );
  }

  const measureId = input.measureId.trim().toUpperCase();
  if (!MEASURE_ID_RE.test(measureId)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid measureId "${input.measureId}": expected 2-32 uppercase alphanumeric/underscore characters (e.g. "ACCESS2")`,
    );
  }

  if (input.locationId !== undefined && !LOCATION_ID_RE.test(input.locationId.trim())) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid locationId "${input.locationId}": expected numeric FIPS/GEOID`,
    );
  }

  if (input.year !== undefined && (!Number.isInteger(input.year) || input.year < 2015 || input.year > 2030)) {
    throw new CivicDataError('INVALID_INPUT', `invalid year ${input.year}: expected integer 2015..2030`);
  }

  const requestedLimit = input.limit ?? 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_LIMIT) {
    throw new CivicDataError('INVALID_INPUT', `invalid limit ${requestedLimit}: expected integer 1..${MAX_LIMIT}`);
  }

  const whereClauses: string[] = [
    `stateabbr='${escapeSoqlString(stateEntry.abbr)}'`,
    `measureid='${escapeSoqlString(measureId)}'`,
  ];

  if (input.year !== undefined) {
    whereClauses.push(`year='${input.year}'`);
  }
  if (input.locationId) {
    whereClauses.push(`locationid='${escapeSoqlString(input.locationId.trim())}'`);
  }
  if (input.locationName && input.locationName.trim()) {
    const cleanName = input.locationName.trim();
    whereClauses.push(`upper(locationname) like upper('%${escapeSoqlString(cleanName)}%')`);
  }
  if (input.dataValueType && input.dataValueType !== 'all') {
    whereClauses.push(`datavaluetypeid='${escapeSoqlString(input.dataValueType)}'`);
  }

  const url = new URL(`https://data.cdc.gov/resource/${datasetId}.json`);
  url.searchParams.set('$where', whereClauses.join(' AND '));
  url.searchParams.set('$order', 'year DESC, locationname ASC, datavaluetypeid ASC');
  url.searchParams.set('$limit', String(requestedLimit));

  const { data, canonicalUrl } = await fetchCivicJson<unknown>({ url: url.toString() }, opts);

  if (!Array.isArray(data)) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `CDC PLACES SODA API returned non-array payload from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  const truncated = data.length > requestedLimit;
  const bounded = data.slice(0, requestedLimit);

  const rows: CdcPlacesRow[] = bounded.map((raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
      year: parseOptionalNumber(r.year),
      state_abbr: String(r.stateabbr ?? stateEntry.abbr).trim(),
      state_desc: String(r.statedesc ?? stateEntry.name).trim(),
      location_name: String(r.locationname ?? '').trim(),
      location_id: String(r.locationid ?? '').trim(),
      category: String(r.category ?? '').trim(),
      measure: String(r.measure ?? '').trim(),
      measure_id: String(r.measureid ?? measureId).trim(),
      data_value_type: String(r.datavaluetype ?? '').trim(),
      data_value_type_id: String(r.datavaluetypeid ?? '').trim(),
      data_value_unit: String(r.data_value_unit ?? '%').trim(),
      value: parseOptionalNumber(r.data_value),
      low_confidence_limit: parseOptionalNumber(r.low_confidence_limit),
      high_confidence_limit: parseOptionalNumber(r.high_confidence_limit),
      total_population: parseOptionalNumber(r.totalpopulation),
      footnote: r.data_value_footnote ? String(r.data_value_footnote).trim() : null,
    };
  });

  return {
    connector: 'cdc_places',
    title: `CDC PLACES (${input.level}) — ${measureId} in ${stateEntry.abbr}`,
    source_name: `Centers for Disease Control and Prevention, PLACES: Local Data for Better Health (${input.level} dataset ${datasetId})`,
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      level: input.level,
      dataset_id: datasetId,
      state_abbr: stateEntry.abbr,
      location_name: input.locationName?.trim() || undefined,
      location_id: input.locationId?.trim() || undefined,
      measure_id: measureId,
      year: input.year,
      data_value_type: input.dataValueType ?? 'all',
      limit: requestedLimit,
    },
    columns: [
      'year',
      'state_abbr',
      'location_name',
      'location_id',
      'measure_id',
      'measure',
      'data_value_type_id',
      'value',
      'low_confidence_limit',
      'high_confidence_limit',
      'data_value_unit',
      'total_population',
    ],
    rows,
    row_count: rows.length,
    truncated,
    citation: {
      agency: 'Centers for Disease Control and Prevention (CDC)',
      dataset: `PLACES Local Data for Better Health (${input.level}, ${datasetId})`,
      year: input.year ?? rows[0]?.year ?? undefined,
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: bounded,
  };
}
