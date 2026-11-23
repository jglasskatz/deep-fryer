import { fetchCivicJson } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

export interface BlsLausInput {
  /** BLS series IDs, e.g. `['LAUCN060870000000003']` (unemployment rate) or `LAUCT...` (city). */
  seriesIds: string[];
  startYear: number;
  endYear: number;
  /** Include annual average (`M13`) observations when supported by the series (default: true). */
  annualAverage?: boolean;
  /** Optional BLS Public Data API v2 registration key (raises limits from 10yr/25 series to 20yr/50 series). */
  apiKey?: string;
}

export interface BlsFootnote {
  code: string;
  text: string;
}

export interface BlsLausRow {
  series_id: string;
  year: number;
  period: string;
  period_name: string;
  is_annual_average: boolean;
  value: number | null;
  provisional: boolean;
  latest: boolean;
  footnotes: BlsFootnote[];
}

interface BlsApiFootnote {
  code?: string;
  text?: string;
}

interface BlsApiObservation {
  year?: string;
  period?: string;
  periodName?: string;
  latest?: string;
  value?: string;
  footnotes?: BlsApiFootnote[];
}

interface BlsApiSeries {
  seriesID?: string;
  data?: BlsApiObservation[];
}

interface BlsApiResponse {
  status?: string;
  responseTime?: number;
  message?: string[];
  Results?: {
    series?: BlsApiSeries[];
  };
}

const BLS_SERIES_ID_RE = /^[A-Z0-9]{10,25}$/;
const BLS_ENDPOINT = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

function parseBlsValue(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed.toLowerCase() === 'null') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function isProvisionalFootnotes(footnotes: BlsFootnote[]): boolean {
  return footnotes.some(
    (f) =>
      f.code.toUpperCase() === 'P' ||
      /\b(?:preliminary|provisional)\b/i.test(f.text),
  );
}

/**
 * Deterministic connector for the U.S. Bureau of Labor Statistics (BLS) Public
 * Data API v2 (Local Area Unemployment Statistics / labor-force time series).
 * Normalizes monthly and annual-average (`M13`) observations, preserves
 * footnotes, and flags provisional/preliminary data explicitly.
 */
export async function queryBlsLaus(
  input: BlsLausInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<BlsLausRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  if (!Array.isArray(input.seriesIds) || input.seriesIds.length === 0) {
    throw new CivicDataError('INVALID_INPUT', 'seriesIds must be a non-empty array of BLS series IDs');
  }

  const maxSeries = input.apiKey ? 50 : 25;
  const maxYearSpan = input.apiKey ? 20 : 10;

  const seriesIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.seriesIds) {
    const id = raw.trim().toUpperCase();
    if (!BLS_SERIES_ID_RE.test(id)) {
      throw new CivicDataError(
        'INVALID_INPUT',
        `invalid BLS series ID "${raw}": expected 10-25 uppercase alphanumeric characters (e.g. "LAUCN060870000000003")`,
      );
    }
    if (!seen.has(id)) {
      seen.add(id);
      seriesIds.push(id);
    }
  }

  if (seriesIds.length > maxSeries) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `too many BLS series IDs (${seriesIds.length}); maximum is ${maxSeries}${input.apiKey ? '' : ' without BLS_API_KEY'}`,
    );
  }

  if (!Number.isInteger(input.startYear) || !Number.isInteger(input.endYear)) {
    throw new CivicDataError('INVALID_INPUT', 'startYear and endYear must be integers');
  }
  if (input.startYear < 1976 || input.endYear > 2030 || input.startYear > input.endYear) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid year range ${input.startYear}..${input.endYear}: expected 1976..2030 with startYear <= endYear`,
    );
  }
  if (input.endYear - input.startYear + 1 > maxYearSpan) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `BLS year span (${input.endYear - input.startYear + 1} years) exceeds limit of ${maxYearSpan} years${input.apiKey ? '' : ' without BLS_API_KEY'}`,
    );
  }

  const annualAverage = input.annualAverage ?? true;
  const requestBody: Record<string, unknown> = {
    seriesid: seriesIds,
    startyear: String(input.startYear),
    endyear: String(input.endYear),
    annualaverage: annualAverage,
  };
  if (input.apiKey) {
    requestBody.registrationkey = input.apiKey;
  }

  const { data } = await fetchCivicJson<BlsApiResponse>(
    {
      url: BLS_ENDPOINT,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
    opts,
  );

  if (!data || typeof data !== 'object' || data.status !== 'REQUEST_SUCCEEDED') {
    const detail = Array.isArray(data?.message) && data.message.length > 0
      ? data.message.join('; ')
      : `status=${String(data?.status ?? 'unknown')}`;
    throw new CivicDataError('API_ERROR', `BLS Public Data API rejected request: ${detail}`, {
      url: BLS_ENDPOINT,
    });
  }

  const canonicalUrlObj = new URL(BLS_ENDPOINT);
  canonicalUrlObj.searchParams.set('seriesid', seriesIds.join(','));
  canonicalUrlObj.searchParams.set('startyear', String(input.startYear));
  canonicalUrlObj.searchParams.set('endyear', String(input.endYear));
  const canonicalUrl = canonicalUrlObj.toString();

  const rows: BlsLausRow[] = [];
  const apiSeries = data.Results?.series ?? [];
  for (const s of apiSeries) {
    const sid = String(s.seriesID ?? '').trim();
    if (!sid || !Array.isArray(s.data)) continue;
    for (const obs of s.data) {
      const year = Number(obs.year);
      const period = String(obs.period ?? '').trim();
      if (!Number.isInteger(year) || !period) continue;

      const footnotes: BlsFootnote[] = (obs.footnotes ?? [])
        .map((f) => ({
          code: String(f?.code ?? '').trim(),
          text: String(f?.text ?? '').trim(),
        }))
        .filter((f) => f.code !== '' || f.text !== '');

      rows.push({
        series_id: sid,
        year,
        period,
        period_name: String(obs.periodName ?? period).trim(),
        is_annual_average: period === 'M13',
        value: parseBlsValue(obs.value),
        provisional: isProvisionalFootnotes(footnotes),
        latest: String(obs.latest ?? '').toLowerCase() === 'true',
        footnotes,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.series_id !== b.series_id) return a.series_id.localeCompare(b.series_id);
    if (a.year !== b.year) return b.year - a.year;
    return b.period.localeCompare(a.period);
  });

  const notes: string[] = [];
  if (!input.apiKey) {
    notes.push('Queried BLS API v2 without BLS_API_KEY (unauthenticated tier: max 10 years, 25 requests/day).');
  }
  if (Array.isArray(data.message) && data.message.length > 0) {
    notes.push(...data.message.map((m) => `BLS message: ${m}`));
  }

  return {
    connector: 'bls_laus',
    title: `BLS Labor Force / LAUS Series (${input.startYear}-${input.endYear})`,
    source_name: 'U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics (Public Data API v2)',
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      series_ids: seriesIds,
      start_year: input.startYear,
      end_year: input.endYear,
      annual_average: annualAverage,
    },
    columns: [
      'series_id',
      'year',
      'period',
      'period_name',
      'is_annual_average',
      'value',
      'provisional',
      'latest',
      'footnotes',
    ],
    rows,
    row_count: rows.length,
    notes,
    citation: {
      agency: 'U.S. Bureau of Labor Statistics',
      dataset: 'Local Area Unemployment Statistics (LAUS)',
      year: `${input.startYear}-${input.endYear}`,
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: data,
  };
}
