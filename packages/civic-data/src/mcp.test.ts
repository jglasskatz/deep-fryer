import { describe, expect, it } from 'vitest';
import { assertStoragePath, type TenantStorage } from '@deep-fryer/research';
import {
  CIVIC_DATA_MCP_SERVER_NAME,
  CIVIC_DATA_MCP_TOOL_NAMES,
  CIVIC_DATA_TOOL_NAMES,
  createCivicDataTools,
} from './mcp.js';
import type { FetchFn } from './types.js';

function createMemoryStorage() {
  const files = new Map<string, Buffer>();
  const storage: Pick<TenantStorage, 'put'> = {
    async put(storagePath: string, body: Buffer): Promise<string> {
      assertStoragePath(storagePath);
      files.set(storagePath, body);
      return storagePath;
    },
  };
  return { storage, files };
}

function parseToolJson(res: { content: Array<{ type: 'text'; text: string }> }): Record<string, unknown> {
  return JSON.parse(res.content[0]!.text) as Record<string, unknown>;
}

describe('createCivicDataTools MCP registry', () => {
  const fixedNow = () => new Date('2026-11-23T20:20:00.000Z');

  it('exposes all 7 typed civic data tools with mcp__civic_data__* names', () => {
    expect(CIVIC_DATA_MCP_SERVER_NAME).toBe('civic_data');
    expect(CIVIC_DATA_TOOL_NAMES).toEqual([
      'query_census_acs',
      'query_bls_laus',
      'query_cdc_places',
      'query_epa_envirofacts',
      'query_socrata',
      'query_arcgis_features',
      'resolve_us_fips',
    ]);
    expect(CIVIC_DATA_MCP_TOOL_NAMES).toContain('mcp__civic_data__query_census_acs');
    expect(CIVIC_DATA_MCP_TOOL_NAMES).toContain('mcp__civic_data__resolve_us_fips');

    const registry = createCivicDataTools({ env: {} });
    expect(registry.tools).toHaveLength(7);
    for (const def of registry.tools) {
      expect(def.mcpName).toBe(`mcp__civic_data__${def.name}`);
      expect(def.description.length).toBeGreaterThan(20);
    }
  });

  it('executes connectors and automatically archives canonical evidence on every successful query', async () => {
    const { storage, files } = createMemoryStorage();

    const mockFetch: FetchFn = async (url) => {
      if (url.includes('api.census.gov')) {
        if (url.includes('for=place%3A*')) {
          return new Response(
            JSON.stringify([
              ['NAME', 'state', 'place'],
              ['Santa Cruz city, California', '06', '69084'],
            ]),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify([
            ['NAME', 'B17001_002E', 'state', 'place'],
            ['Santa Cruz city, California', '11840', '06', '69084'],
          ]),
          { status: 200 },
        );
      }
      if (url.includes('api.bls.gov')) {
        return new Response(
          JSON.stringify({
            status: 'REQUEST_SUCCEEDED',
            Results: {
              series: [
                {
                  seriesID: 'LAUCN060870000000003',
                  data: [{ year: '2024', period: 'M13', periodName: 'Annual', value: '6.1', footnotes: [] }],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('data.cdc.gov')) {
        return new Response(
          JSON.stringify([
            {
              year: '2022',
              stateabbr: 'CA',
              locationname: 'Santa Cruz',
              locationid: '06087',
              measureid: 'ACCESS2',
              datavaluetypeid: 'CrdPrv',
              data_value: '9.4',
              low_confidence_limit: '8.2',
              high_confidence_limit: '10.7',
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('data.epa.gov')) {
        return new Response(
          JSON.stringify([{ STATE_CODE: '06', COUNTY_CODE: '087', ARITHMETIC_MEAN: '6.4' }]),
          { status: 200 },
        );
      }
      if (url.includes('data.cityofnewyork.us')) {
        return new Response(JSON.stringify([{ borough: 'MANHATTAN', count: '123' }]), { status: 200 });
      }
      if (url.includes('FeatureServer/0/query')) {
        return new Response(
          JSON.stringify({ features: [{ attributes: { PARCELS: 55 } }] }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const registry = createCivicDataTools({
      storage,
      fetch: mockFetch,
      env: {}, // Verify optional API keys are NOT required to work
      now: fixedNow,
    });

    const fipsRes = parseToolJson(
      await registry.callTool('resolve_us_fips', { state: 'CA', place_name: 'Santa Cruz' }),
    );
    expect(fipsRes.ok).toBe(true);
    expect((fipsRes.identifiers as Record<string, unknown>).place_fips).toBe('69084');

    const censusRes = parseToolJson(
      await registry.callTool('query_census_acs', {
        dataset: 'acs5',
        year: 2023,
        variables: ['B17001_002E'],
        geography: { state: '06', place: '69084' },
      }),
    );
    expect(censusRes.ok).toBe(true);
    expect((censusRes.evidence as Record<string, unknown>).text_path).toMatch(/^evidence\/[a-f0-9]{64}\.txt$/);

    const blsRes = parseToolJson(
      await registry.callTool('query_bls_laus', {
        series_ids: ['LAUCN060870000000003'],
        start_year: 2024,
        end_year: 2024,
      }),
    );
    expect(blsRes.ok).toBe(true);
    expect((blsRes.evidence as Record<string, unknown>).row_count).toBe(1);

    const cdcRes = parseToolJson(
      await registry.callTool('query_cdc_places', {
        level: 'county',
        state_abbr: 'CA',
        measure_id: 'ACCESS2',
      }),
    );
    expect(cdcRes.ok).toBe(true);
    expect((cdcRes.evidence as Record<string, unknown>).text_path).toMatch(/^evidence\/[a-f0-9]{64}\.txt$/);

    const epaRes = parseToolJson(
      await registry.callTool('query_epa_envirofacts', {
        dataset: 'aqs',
        state_abbr: 'CA',
        year: 2023,
      }),
    );
    expect(epaRes.ok).toBe(true);
    expect((epaRes.evidence as Record<string, unknown>).row_count).toBe(1);

    const socrataRes = parseToolJson(
      await registry.callTool('query_socrata', {
        domain: 'data.cityofnewyork.us',
        dataset_id: 'erm2-nwe9',
        limit: 10,
      }),
    );
    expect(socrataRes.ok).toBe(true);
    expect((socrataRes.evidence as Record<string, unknown>).row_count).toBe(1);

    const arcgisRes = parseToolJson(
      await registry.callTool('query_arcgis_features', {
        service_url: 'https://services.arcgis.com/org/arcgis/rest/services/Test/FeatureServer/0',
      }),
    );
    expect(arcgisRes.ok).toBe(true);
    expect((arcgisRes.evidence as Record<string, unknown>).row_count).toBe(1);

    // All 6 data query tools wrote distinct archived exhibits
    expect(files.size).toBe(6);
  });

  it('returns graceful fallback messages for non-US jurisdictions, missing keys on 429, and invalid args', async () => {
    const rateLimitFetch: FetchFn = async () => new Response('Too Many Requests', { status: 429 });
    const registry = createCivicDataTools({ fetch: rateLimitFetch, env: {}, now: fixedNow });

    // Non-US jurisdiction fallback
    const nonUs = parseToolJson(
      await registry.callTool('query_census_acs', {
        dataset: 'acs5',
        year: 2023,
        variables: ['B17001_002E'],
        geography: { state: 'Buenos Aires' },
      }),
    );
    expect(nonUs.ok).toBe(false);
    expect(nonUs.code).toBe('NON_US_JURISDICTION');
    expect(nonUs.fallback).toBe('web_search');

    // Missing optional CENSUS_API_KEY hint when upstream returns 429
    const rateLimited = await registry.callTool('query_census_acs', {
      dataset: 'acs5',
      year: 2023,
      variables: ['B17001_002E'],
      geography: { state: 'CA' },
    });
    expect(rateLimited.isError).toBe(true);
    const rlBody = parseToolJson(rateLimited);
    expect(rlBody.status).toBe(429);
    expect(String(rlBody.guidance)).toContain('CENSUS_API_KEY');

    // Invalid Zod schema arguments
    const badArgs = await registry.callTool('query_socrata', {
      domain: 'data.sfgov.org',
      dataset_id: 'not-a-4x4-id',
    });
    expect(badArgs.isError).toBe(true);
    expect(parseToolJson(badArgs).code).toBe('INVALID_INPUT');
  });
});
