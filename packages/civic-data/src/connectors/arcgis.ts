import { fetchCivicJson, validateHttpsUrlSync } from '../http.js';
import { CivicDataError, type CivicDataHttpOptions, type CivicDataResult } from '../types.js';

export const ARCGIS_MAX_LIMIT = 500;
const ARCGIS_LAYER_PATH_RE = /\/(?:FeatureServer|MapServer)\/\d+(?:\/query)?\/?$/i;
const FIELD_NAME_RE = /^[A-Za-z0-9_.*]+$/;
const UNSAFE_SQL_RE = /(?:;|--|\/\*|\*\/|\b(?:DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|CREATE|EXEC)\b)/i;

export type ArcgisStatisticType = 'count' | 'sum' | 'min' | 'max' | 'avg' | 'stddev' | 'var';

export interface ArcgisOutStatistic {
  statisticType: ArcgisStatisticType;
  onStatisticField: string;
  outStatisticFieldName: string;
}

export interface ArcgisFeaturesInput {
  /**
   * ArcGIS REST FeatureServer or MapServer layer URL, e.g.
   * `https://services.arcgis.com/.../FeatureServer/0` (with or without `/query`).
   */
  serviceUrl: string;
  /** SQL WHERE filter (default: `"1=1"`). */
  where?: string;
  /** Output fields list or comma-separated string (default: `"*"`). */
  outFields?: string[] | string;
  /** Optional server-side aggregation statistics. */
  outStatistics?: ArcgisOutStatistic[];
  /** Optional group-by field names when using `outStatistics`. */
  groupByFieldsForStatistics?: string[];
  /** Optional ORDER BY clause. */
  orderByFields?: string;
  /** Row cap (default: 100, strictly capped <= 500). */
  limit?: number;
  /** Whether to include feature geometry (default: false for compact tabular exhibits). */
  returnGeometry?: boolean;
}

export type ArcgisFeatureRow = Record<string, unknown>;

interface ArcgisErrorEnvelope {
  error?: {
    code?: number;
    message?: string;
    details?: string[];
  };
  features?: Array<{
    attributes?: Record<string, unknown>;
    geometry?: unknown;
  }>;
  exceededTransferLimit?: boolean;
}

function assertSafeSql(label: string, value: string): string {
  const trimmed = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || UNSAFE_SQL_RE.test(trimmed)) {
    throw new CivicDataError('INVALID_INPUT', `disallowed SQL syntax in ArcGIS ${label}`);
  }
  if (trimmed.length > 2000) {
    throw new CivicDataError('INVALID_INPUT', `ArcGIS ${label} exceeds 2000 characters`);
  }
  return trimmed;
}

function normalizeArcgisQueryUrl(rawServiceUrl: string): URL {
  const parsed = validateHttpsUrlSync(rawServiceUrl.trim());
  if (!ARCGIS_LAYER_PATH_RE.test(parsed.pathname)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid ArcGIS serviceUrl "${rawServiceUrl}": URL path must target a FeatureServer/<layerId> or MapServer/<layerId> endpoint`,
      { url: parsed.toString() },
    );
  }
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const queryPath = /\/query$/i.test(cleanPath) ? cleanPath : `${cleanPath}/query`;
  const queryUrl = new URL(`${parsed.origin}${queryPath}`);
  return queryUrl;
}

/**
 * Deterministic connector for ArcGIS REST FeatureServer / MapServer `query?f=json`
 * endpoints. Enforces HTTPS egress, FeatureServer/MapServer path validation,
 * safe read-only SQL clauses, ArcGIS error-envelope detection, and a strict
 * row cap (`<= 500`).
 */
export async function queryArcgisFeatures(
  input: ArcgisFeaturesInput,
  opts: CivicDataHttpOptions = {},
): Promise<CivicDataResult<ArcgisFeatureRow>> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  const queryUrl = normalizeArcgisQueryUrl(input.serviceUrl);

  const requestedLimit = input.limit ?? 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > ARCGIS_MAX_LIMIT) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid ArcGIS limit ${requestedLimit}: expected integer 1..${ARCGIS_MAX_LIMIT}`,
    );
  }

  const where = assertSafeSql('where', input.where ?? '1=1');
  const returnGeometry = input.returnGeometry ?? false;

  let outFieldsParam = '*';
  if (Array.isArray(input.outFields)) {
    const cleaned = input.outFields.map((f) => f.trim()).filter(Boolean);
    for (const f of cleaned) {
      if (!FIELD_NAME_RE.test(f)) {
        throw new CivicDataError('INVALID_INPUT', `invalid ArcGIS outField "${f}"`);
      }
    }
    outFieldsParam = cleaned.length > 0 ? cleaned.join(',') : '*';
  } else if (typeof input.outFields === 'string' && input.outFields.trim()) {
    const parts = input.outFields
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    for (const f of parts) {
      if (!FIELD_NAME_RE.test(f)) {
        throw new CivicDataError('INVALID_INPUT', `invalid ArcGIS outField "${f}"`);
      }
    }
    outFieldsParam = parts.join(',');
  }

  queryUrl.searchParams.set('f', 'json');
  queryUrl.searchParams.set('where', where);
  queryUrl.searchParams.set('returnGeometry', returnGeometry ? 'true' : 'false');
  queryUrl.searchParams.set('resultRecordCount', String(requestedLimit));

  if (input.outStatistics && input.outStatistics.length > 0) {
    for (const stat of input.outStatistics) {
      if (!FIELD_NAME_RE.test(stat.onStatisticField) || !FIELD_NAME_RE.test(stat.outStatisticFieldName)) {
        throw new CivicDataError(
          'INVALID_INPUT',
          `invalid ArcGIS outStatistics field name: "${stat.onStatisticField}" / "${stat.outStatisticFieldName}"`,
        );
      }
    }
    queryUrl.searchParams.set('outStatistics', JSON.stringify(input.outStatistics));
    if (input.groupByFieldsForStatistics && input.groupByFieldsForStatistics.length > 0) {
      for (const f of input.groupByFieldsForStatistics) {
        if (!FIELD_NAME_RE.test(f.trim())) {
          throw new CivicDataError('INVALID_INPUT', `invalid ArcGIS groupByFieldsForStatistics field "${f}"`);
        }
      }
      queryUrl.searchParams.set(
        'groupByFieldsForStatistics',
        input.groupByFieldsForStatistics.map((f) => f.trim()).join(','),
      );
    }
  } else {
    queryUrl.searchParams.set('outFields', outFieldsParam);
  }

  if (input.orderByFields) {
    queryUrl.searchParams.set('orderByFields', assertSafeSql('orderByFields', input.orderByFields));
  }

  const { data, canonicalUrl } = await fetchCivicJson<ArcgisErrorEnvelope>(
    { url: queryUrl.toString() },
    opts,
  );

  if (!data || typeof data !== 'object') {
    throw new CivicDataError(
      'PARSE_ERROR',
      `ArcGIS REST API returned non-object payload from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  if (data.error) {
    const details = Array.isArray(data.error.details) && data.error.details.length > 0
      ? ` (${data.error.details.join('; ')})`
      : '';
    throw new CivicDataError(
      'API_ERROR',
      `ArcGIS REST error ${data.error.code ?? ''}: ${data.error.message ?? 'unknown error'}${details}`.trim(),
      { status: data.error.code, url: canonicalUrl },
    );
  }

  if (!Array.isArray(data.features)) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `ArcGIS REST response missing "features" array from ${canonicalUrl}`,
      { url: canonicalUrl },
    );
  }

  const truncated = Boolean(data.exceededTransferLimit) || data.features.length > requestedLimit;
  const boundedFeatures = data.features.slice(0, requestedLimit);

  const rows: ArcgisFeatureRow[] = boundedFeatures.map((feature) => {
    const attrs = feature?.attributes && typeof feature.attributes === 'object'
      ? { ...feature.attributes }
      : {};
    if (returnGeometry && feature?.geometry !== undefined) {
      attrs._geometry = feature.geometry;
    }
    return attrs;
  });

  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) columnSet.add(k);
  }

  const host = queryUrl.hostname;
  return {
    connector: 'arcgis_features',
    title: `ArcGIS REST Features (${host})`,
    source_name: `ArcGIS REST Service (${host})`,
    source_url: canonicalUrl,
    retrieved_at: retrievedAt,
    query_params: {
      service_url: `${queryUrl.origin}${queryUrl.pathname.replace(/\/query$/i, '')}`,
      where,
      out_fields: input.outStatistics?.length ? undefined : outFieldsParam,
      out_statistics: input.outStatistics,
      group_by: input.groupByFieldsForStatistics,
      order_by: input.orderByFields,
      limit: requestedLimit,
      return_geometry: returnGeometry,
    },
    columns: [...columnSet],
    rows,
    row_count: rows.length,
    truncated,
    notes: truncated
      ? ['ArcGIS reported exceededTransferLimit or truncated rows at the connector cap.']
      : undefined,
    citation: {
      agency: host,
      dataset: queryUrl.pathname.replace(/\/query$/i, ''),
      source_tier_hint: 1,
      canonical_url: canonicalUrl,
    },
    raw_payload: {
      exceededTransferLimit: Boolean(data.exceededTransferLimit),
      features: boundedFeatures,
    },
  };
}
