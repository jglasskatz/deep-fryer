import { z } from 'zod';
import type { TenantStorage } from '@deep-fryer/research';
import { archiveCivicDataResult, type ArchivedCivicDataEvidence } from './archive.js';
import { ARCGIS_MAX_LIMIT, queryArcgisFeatures } from './connectors/arcgis.js';
import { queryBlsLaus } from './connectors/bls-laus.js';
import { queryCdcPlaces } from './connectors/cdc-places.js';
import { queryCensusAcs } from './connectors/census-acs.js';
import { queryEpaEnvirofacts } from './connectors/epa-envirofacts.js';
import { SOCRATA_MAX_LIMIT, querySocrata } from './connectors/socrata.js';
import { resolveStateInput, resolveUsFips } from './fips.js';
import {
  CivicDataError,
  type CivicDataHttpOptions,
  type CivicDataResult,
  type FetchFn,
} from './types.js';

export const CIVIC_DATA_MCP_SERVER_NAME = 'civic_data' as const;

export const CIVIC_DATA_TOOL_NAMES = [
  'query_census_acs',
  'query_bls_laus',
  'query_cdc_places',
  'query_epa_envirofacts',
  'query_socrata',
  'query_arcgis_features',
  'resolve_us_fips',
] as const;

export type CivicDataToolName = (typeof CIVIC_DATA_TOOL_NAMES)[number];

/** Fully qualified MCP tool names matching Claude Agent SDK `allowedTools` syntax. */
export const CIVIC_DATA_MCP_TOOL_NAMES: readonly string[] = CIVIC_DATA_TOOL_NAMES.map(
  (name) => `mcp__${CIVIC_DATA_MCP_SERVER_NAME}__${name}`,
);

export interface CivicDataToolTextContent {
  type: 'text';
  text: string;
}

export interface CivicDataToolResponse {
  content: CivicDataToolTextContent[];
  isError?: boolean;
}

export interface CivicDataToolDefinition {
  name: CivicDataToolName;
  mcpName: string;
  description: string;
  /** Raw Zod shape compatible directly with `@anthropic-ai/claude-agent-sdk`'s `tool()`. */
  inputSchema: z.ZodRawShape;
  /** Full Zod object schema for validation. */
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (rawArgs: unknown) => Promise<CivicDataToolResponse>;
}

export interface CreateCivicDataToolsOptions {
  /** Optional tenant storage; when supplied, every successful data query is auto-archived to `evidence/<sha256>.txt`. */
  storage?: Pick<TenantStorage, 'put'>;
  /** Injectable fetch implementation (defaults to `@deep-fryer/research`'s `guardedFetch`). */
  fetch?: FetchFn;
  /** Environment map providing optional `CENSUS_API_KEY`, `BLS_API_KEY`, and `SOCRATA_APP_TOKEN`. */
  env?: Record<string, string | undefined>;
  /** Optional extra Socrata domains permitted beyond the built-in civic allowlist. */
  allowedSocrataDomains?: string[];
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /** Max response byte budget override. */
  maxResponseBytes?: number;
  /** Optional DNS resolver passed through to the egress guard. */
  resolve?: (host: string) => Promise<string[]>;
  /** Optional deterministic clock override. */
  now?: () => Date;
  /** Max rows echoed inline in MCP tool text responses (all rows are still archived in storage; default: 50). */
  maxInlineRows?: number;
}

export interface CivicDataToolRegistry {
  serverName: typeof CIVIC_DATA_MCP_SERVER_NAME;
  version: string;
  tools: readonly CivicDataToolDefinition[];
  byName: Readonly<Record<CivicDataToolName, CivicDataToolDefinition>>;
  callTool: (name: CivicDataToolName, args: unknown) => Promise<CivicDataToolResponse>;
}

function jsonResponse(payload: unknown, isError = false): CivicDataToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

function nonUsFallbackResponse(jurisdiction: string, toolName: CivicDataToolName): CivicDataToolResponse {
  return jsonResponse({
    ok: false,
    code: 'NON_US_JURISDICTION',
    fallback: 'web_search',
    error: `"${jurisdiction}" is not a recognized US state/territory for ${toolName}.`,
    guidance:
      'US federal civic connectors (Census ACS, BLS LAUS, CDC PLACES, EPA Envirofacts) only cover US jurisdictions. Fall back to national statistical agencies or WebSearch for non-US portraits.',
  });
}

function formatErrorResponse(err: unknown, toolName: CivicDataToolName, missingKeyHint?: string): CivicDataToolResponse {
  if (err instanceof CivicDataError) {
    const rateLimited = err.status === 429 || err.status === 403;
    const guidance =
      rateLimited && missingKeyHint
        ? `Upstream API returned HTTP ${err.status}. Configure ${missingKeyHint} in the worker environment or fall back to WebSearch.`
        : err.code === 'EGRESS_BLOCKED'
          ? 'Refused by HTTPS/allowlist egress policy. Use an approved public HTTPS civic API endpoint or WebSearch.'
          : 'Fix query parameters or fall back to WebSearch / official statistical publications.';
    return jsonResponse(
      {
        ok: false,
        tool: toolName,
        code: err.code,
        status: err.status,
        error: err.message,
        fallback: 'web_search',
        guidance,
      },
      true,
    );
  }
  return jsonResponse(
    {
      ok: false,
      tool: toolName,
      code: 'UNEXPECTED_ERROR',
      error: err instanceof Error ? err.message : String(err),
      fallback: 'web_search',
      guidance: 'Fall back to WebSearch or capture_evidence on the official agency page.',
    },
    true,
  );
}

async function finalizeConnectorResult<TRow>(
  result: CivicDataResult<TRow>,
  storage: Pick<TenantStorage, 'put'> | undefined,
  maxInlineRows: number,
): Promise<CivicDataToolResponse> {
  let evidence: ArchivedCivicDataEvidence | undefined;
  if (storage) {
    evidence = await archiveCivicDataResult(storage, result);
  }

  const inlineRows = result.rows.slice(0, maxInlineRows);
  const inlineTruncated = result.rows.length > maxInlineRows;

  return jsonResponse({
    ok: true,
    connector: result.connector,
    title: result.title,
    source_name: result.source_name,
    source_url: result.source_url,
    retrieved_at: result.retrieved_at,
    row_count: result.row_count,
    truncated: Boolean(result.truncated),
    inline_rows_truncated: inlineTruncated,
    columns: result.columns,
    rows: inlineRows,
    citation: result.citation,
    notes: result.notes ?? [],
    ...(evidence ? { evidence } : {}),
  });
}

const censusAcsShape = {
  dataset: z.enum(['acs5', 'acs1']).describe('ACS dataset: "acs5" (5-year, all places/counties) or "acs1" (1-year, pop >= 65k)'),
  year: z.number().int().min(2009).max(2030).describe('ACS release year (e.g. 2023)'),
  variables: z
    .array(z.string().min(3).max(32))
    .min(1)
    .max(49)
    .describe('Census variable codes (e.g. ["B17001_002E", "B17001_001E"])'),
  include_moe: z
    .boolean()
    .optional()
    .describe('When true, automatically requests paired _M margin-of-error variables'),
  geography: z
    .object({
      state: z.string().min(2).describe('US state 2-digit FIPS ("06"), 2-letter abbr ("CA"), or state name'),
      county: z.string().optional().describe('3-digit county FIPS (e.g. "087") or "*"'),
      place: z.string().optional().describe('5-digit place FIPS (e.g. "69084") or "*"'),
      puma: z.string().optional().describe('5-digit PUMA code or "*"'),
      tract: z.string().optional().describe('6-digit Census tract code or "*" (requires county)'),
    })
    .describe('Target US Census geography'),
  table_group: z
    .enum(['detail', 'subject', 'profile', 'cprofile'])
    .optional()
    .describe('Optional Census table group override (auto-detected from variable prefix when omitted)'),
} satisfies z.ZodRawShape;

const blsLausShape = {
  series_ids: z
    .array(z.string().min(10).max(25))
    .min(1)
    .max(50)
    .describe('BLS LAUS series IDs (e.g. ["LAUCN060870000000003"])'),
  start_year: z.number().int().min(1976).max(2030).describe('First year to retrieve'),
  end_year: z.number().int().min(1976).max(2030).describe('Last year to retrieve'),
  annual_average: z.boolean().optional().describe('Include M13 annual averages (default: true)'),
} satisfies z.ZodRawShape;

const cdcPlacesShape = {
  level: z.enum(['county', 'place', 'tract']).describe('Geographic granularity: "county", "place", or "tract"'),
  state_abbr: z.string().min(2).describe('US state 2-letter abbreviation ("CA"), name, or 2-digit FIPS'),
  location_name: z.string().optional().describe('Optional city or county name filter'),
  location_id: z.string().optional().describe('Optional exact numeric FIPS / GEOID filter'),
  measure_id: z.string().min(2).max(32).describe('CDC PLACES measure ID (e.g. "ACCESS2", "BPHIGH", "CASTHMA", "DIABETES")'),
  year: z.number().int().min(2015).max(2030).optional().describe('Optional observation year'),
  data_value_type: z
    .enum(['CrdPrv', 'AgeAdjPrv', 'all'])
    .optional()
    .describe('Crude prevalence ("CrdPrv"), age-adjusted ("AgeAdjPrv"), or both ("all")'),
  limit: z.number().int().min(1).max(500).optional().describe('Row cap (default: 100, max: 500)'),
} satisfies z.ZodRawShape;

const epaEnvirofactsShape = {
  dataset: z
    .enum(['sdwis', 'tri', 'aqs'])
    .describe('EPA Envirofacts dataset: "sdwis" (drinking water), "tri" (toxic releases), or "aqs" (air quality)'),
  state_abbr: z.string().min(2).describe('US state 2-letter abbreviation ("CA"), name, or 2-digit FIPS'),
  county_name: z.string().optional().describe('Optional county name filter (e.g. "Santa Cruz")'),
  year: z.number().int().min(1987).max(2030).optional().describe('Optional reporting/compliance year'),
  limit: z.number().int().min(1).max(500).optional().describe('Row cap (default: 100, max: 500)'),
} satisfies z.ZodRawShape;

const socrataShape = {
  domain: z
    .string()
    .min(4)
    .describe('Allowlisted municipal/state/federal Socrata domain (e.g. "data.cityofnewyork.us", "data.sfgov.org")'),
  dataset_id: z
    .string()
    .regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/i, 'must be a Socrata 4x4 dataset ID like "erm2-nwe9"')
    .describe('Socrata 4x4 dataset ID'),
  select: z.string().optional().describe('SoQL $select clause'),
  where: z.string().optional().describe('SoQL $where filter'),
  group: z.string().optional().describe('SoQL $group clause'),
  order: z.string().optional().describe('SoQL $order clause'),
  limit: z.number().int().min(1).max(SOCRATA_MAX_LIMIT).optional().describe('Row cap (default: 100, max: 500)'),
  offset: z.number().int().min(0).optional().describe('Row offset (default: 0)'),
} satisfies z.ZodRawShape;

const arcgisFeaturesShape = {
  service_url: z
    .string()
    .min(10)
    .describe('HTTPS ArcGIS FeatureServer/<layer> or MapServer/<layer> URL'),
  where: z.string().optional().describe('SQL WHERE filter (default: "1=1")'),
  out_fields: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Comma-separated field names or array (default: "*")'),
  out_statistics: z
    .array(
      z.object({
        statisticType: z.enum(['count', 'sum', 'min', 'max', 'avg', 'stddev', 'var']),
        onStatisticField: z.string().min(1),
        outStatisticFieldName: z.string().min(1),
      }),
    )
    .optional()
    .describe('Optional server-side aggregation statistics'),
  group_by_fields: z
    .array(z.string().min(1))
    .optional()
    .describe('Group-by fields when using out_statistics'),
  order_by_fields: z.string().optional().describe('Optional ORDER BY clause'),
  limit: z.number().int().min(1).max(ARCGIS_MAX_LIMIT).optional().describe('Row cap (default: 100, max: 500)'),
  return_geometry: z.boolean().optional().describe('Include feature geometry (default: false)'),
} satisfies z.ZodRawShape;

const resolveUsFipsShape = {
  state: z.string().optional().describe('US state abbreviation ("CA"), full name ("California"), or 2-digit FIPS ("06")'),
  place_name: z.string().optional().describe('City, town, or CDP name (e.g. "Santa Cruz")'),
  county_name: z.string().optional().describe('County, parish, or borough name (e.g. "Santa Cruz County")'),
  address: z.string().optional().describe('Optional US street address for Census Geocoder lookup'),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional()
    .describe('Optional WGS84 coordinates for Census Geocoder lookup'),
  year: z.number().int().min(2009).max(2030).optional().describe('Census ACS catalog year (default: 2023)'),
} satisfies z.ZodRawShape;

function buildTool(
  name: CivicDataToolName,
  description: string,
  inputSchema: z.ZodRawShape,
  execute: (parsed: Record<string, unknown>) => Promise<CivicDataToolResponse>,
): CivicDataToolDefinition {
  const schema = z.object(inputSchema);
  return {
    name,
    mcpName: `mcp__${CIVIC_DATA_MCP_SERVER_NAME}__${name}`,
    description,
    inputSchema,
    schema,
    handler: async (rawArgs: unknown): Promise<CivicDataToolResponse> => {
      const parsed = schema.safeParse(rawArgs);
      if (!parsed.success) {
        return jsonResponse(
          {
            ok: false,
            tool: name,
            code: 'INVALID_INPUT',
            error: `invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
          },
          true,
        );
      }
      return execute(parsed.data);
    },
  };
}

/**
 * Create the complete typed registry of deterministic civic data MCP tools,
 * ready to mount in `apps/worker/src/session.ts` via `createSdkMcpServer`.
 *
 * When `storage` is provided, every successful connector call automatically
 * archives its canonical exhibit to `evidence/<sha256>.txt` and returns the
 * `evidence` provenance block alongside the structured rows.
 */
export function createCivicDataTools(
  opts: CreateCivicDataToolsOptions = {},
): CivicDataToolRegistry {
  const env = opts.env ?? process.env;
  const maxInlineRows = opts.maxInlineRows ?? 50;
  const httpOpts: CivicDataHttpOptions = {
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
    maxResponseBytes: opts.maxResponseBytes,
    resolve: opts.resolve,
    now: opts.now,
  };

  const censusKey = env.CENSUS_API_KEY?.trim() || undefined;
  const blsKey = env.BLS_API_KEY?.trim() || undefined;
  const socrataToken = env.SOCRATA_APP_TOKEN?.trim() || undefined;

  const tools: CivicDataToolDefinition[] = [
    buildTool(
      'query_census_acs',
      'Query US Census Bureau American Community Survey (ACS 5-year or 1-year) variables by FIPS geography. Converts Census sentinel missing codes (-666666666, -999999999, -888888888) to null, optionally fetches margins of error (_M), and auto-archives the canonical exhibit.',
      censusAcsShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof censusAcsShape>>;
        if (!resolveStateInput(args.geography.state)) {
          return nonUsFallbackResponse(args.geography.state, 'query_census_acs');
        }
        try {
          const result = await queryCensusAcs(
            {
              dataset: args.dataset,
              year: args.year,
              variables: args.variables,
              includeMoe: args.include_moe,
              geography: args.geography,
              tableGroup: args.table_group,
              apiKey: censusKey,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_census_acs', !censusKey ? 'CENSUS_API_KEY' : undefined);
        }
      },
    ),

    buildTool(
      'query_bls_laus',
      'Query U.S. Bureau of Labor Statistics (BLS) Public Data API v2 for Local Area Unemployment Statistics (LAUS) and labor-force series. Normalizes monthly and annual-average (M13) rows with footnotes and provisional flags, and auto-archives the exhibit.',
      blsLausShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof blsLausShape>>;
        try {
          const result = await queryBlsLaus(
            {
              seriesIds: args.series_ids,
              startYear: args.start_year,
              endYear: args.end_year,
              annualAverage: args.annual_average,
              apiKey: blsKey,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_bls_laus', !blsKey ? 'BLS_API_KEY' : undefined);
        }
      },
    ),

    buildTool(
      'query_cdc_places',
      'Query CDC PLACES (Local Data for Better Health) via data.cdc.gov SODA for county, place, or tract health prevalence measures with 95% confidence intervals, and auto-archives the canonical exhibit.',
      cdcPlacesShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof cdcPlacesShape>>;
        if (!resolveStateInput(args.state_abbr)) {
          return nonUsFallbackResponse(args.state_abbr, 'query_cdc_places');
        }
        try {
          const result = await queryCdcPlaces(
            {
              level: args.level,
              stateAbbr: args.state_abbr,
              locationName: args.location_name,
              locationId: args.location_id,
              measureId: args.measure_id,
              year: args.year,
              dataValueType: args.data_value_type,
              limit: args.limit,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_cdc_places');
        }
      },
    ),

    buildTool(
      'query_epa_envirofacts',
      'Query U.S. EPA Envirofacts REST API for Safe Drinking Water violations (sdwis), Toxics Release Inventory releases (tri), or Air Quality System annual summaries (aqs), and auto-archives the canonical exhibit.',
      epaEnvirofactsShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof epaEnvirofactsShape>>;
        if (!resolveStateInput(args.state_abbr)) {
          return nonUsFallbackResponse(args.state_abbr, 'query_epa_envirofacts');
        }
        try {
          const result = await queryEpaEnvirofacts(
            {
              dataset: args.dataset,
              stateAbbr: args.state_abbr,
              countyName: args.county_name,
              year: args.year,
              limit: args.limit,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_epa_envirofacts');
        }
      },
    ),

    buildTool(
      'query_socrata',
      'Execute a safe, read-only SoQL query against an allowlisted municipal, state, or federal Socrata open-data portal (e.g. data.cityofnewyork.us, data.sfgov.org, data.ca.gov; max 500 rows) and auto-archive the canonical exhibit.',
      socrataShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof socrataShape>>;
        try {
          const result = await querySocrata(
            {
              domain: args.domain,
              datasetId: args.dataset_id,
              select: args.select,
              where: args.where,
              group: args.group,
              order: args.order,
              limit: args.limit,
              offset: args.offset,
              appToken: socrataToken,
              allowedDomains: opts.allowedSocrataDomains,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_socrata', !socrataToken ? 'SOCRATA_APP_TOKEN' : undefined);
        }
      },
    ),

    buildTool(
      'query_arcgis_features',
      'Execute a safe read-only ArcGIS REST FeatureServer/MapServer query (f=json, max 500 rows) with optional server-side outStatistics aggregation and auto-archive the canonical exhibit.',
      arcgisFeaturesShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof arcgisFeaturesShape>>;
        try {
          const result = await queryArcgisFeatures(
            {
              serviceUrl: args.service_url,
              where: args.where,
              outFields: args.out_fields,
              outStatistics: args.out_statistics,
              groupByFieldsForStatistics: args.group_by_fields,
              orderByFields: args.order_by_fields,
              limit: args.limit,
              returnGeometry: args.return_geometry,
            },
            httpOpts,
          );
          return await finalizeConnectorResult(result, opts.storage, maxInlineRows);
        } catch (err) {
          return formatErrorResponse(err, 'query_arcgis_features');
        }
      },
    ),

    buildTool(
      'resolve_us_fips',
      'Resolve official US Census FIPS identifiers (state_fips, county_fips, place_fips, puma_ids) and known municipal Socrata/ArcGIS portal domains by place/county/state name, street address, or coordinates. Returns a graceful non-US fallback notice for non-US regions.',
      resolveUsFipsShape,
      async (raw) => {
        const args = raw as z.infer<z.ZodObject<typeof resolveUsFipsShape>>;
        try {
          const res = await resolveUsFips(
            {
              state: args.state,
              placeName: args.place_name,
              countyName: args.county_name,
              address: args.address,
              coordinates: args.coordinates,
              year: args.year,
              apiKey: censusKey,
            },
            httpOpts,
          );
          return jsonResponse({
            ok: res.resolved,
            ...res,
            ...(!res.is_us_jurisdiction ? { fallback: 'web_search' } : {}),
          });
        } catch (err) {
          return formatErrorResponse(err, 'resolve_us_fips');
        }
      },
    ),
  ];

  const byName = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
    CivicDataToolName,
    CivicDataToolDefinition
  >;

  return {
    serverName: CIVIC_DATA_MCP_SERVER_NAME,
    version: '1.0.0',
    tools,
    byName,
    callTool: async (name: CivicDataToolName, args: unknown): Promise<CivicDataToolResponse> => {
      const def = byName[name];
      if (!def) {
        return jsonResponse({ ok: false, code: 'INVALID_INPUT', error: `unknown civic data tool "${String(name)}"` }, true);
      }
      return def.handler(args);
    },
  };
}
