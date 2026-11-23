import { describe, expect, it } from 'vitest';
import { queryArcgisFeatures } from './arcgis.js';
import { queryBlsLaus } from './bls-laus.js';
import { queryCdcPlaces } from './cdc-places.js';
import { queryCensusAcs } from './census-acs.js';
import { queryEpaEnvirofacts } from './epa-envirofacts.js';
import { isAllowedSocrataDomain, querySocrata } from './socrata.js';
import { CivicDataError, type FetchFn } from '../types.js';

const FIXED_NOW = () => new Date('2026-11-23T20:10:00.000Z');

describe('queryCensusAcs', () => {
  it('parses ACS 2D arrays, computes paired MOE vars, converts sentinels to null, and redacts API keys', async () => {
    let capturedUrl = '';
    const mockFetch: FetchFn = async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify([
          [
            'NAME',
            'B17001_001E',
            'B17001_001M',
            'B17001_002E',
            'B17001_002M',
            'B19013_001E',
            'B19013_001M',
            'B25070_010E',
            'B25070_010M',
            'state',
            'place',
          ],
          [
            'Santa Cruz city, California',
            '54210',
            '1120',
            '11840',
            '1045',
            '-666666666',
            '-222222222',
            '-999999999',
            '-888888888',
            '06',
            '69084',
          ],
        ]),
        { status: 200 },
      );
    };

    const result = await queryCensusAcs(
      {
        dataset: 'acs5',
        year: 2023,
        variables: ['B17001_001E', 'B17001_002E', 'B19013_001E', 'B25070_010E'],
        includeMoe: true,
        geography: { state: 'CA', place: '69084' },
        apiKey: 'SECRET_CENSUS_KEY',
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );

    expect(capturedUrl).toContain('key=SECRET_CENSUS_KEY');
    expect(capturedUrl).toContain('B17001_002M');
    expect(result.source_url).not.toContain('SECRET_CENSUS_KEY');
    expect(result.citation.canonical_url).not.toContain('SECRET_CENSUS_KEY');
    expect(result.row_count).toBe(1);

    const row = result.rows[0]!;
    expect(row.name).toBe('Santa Cruz city, California');
    expect(row.geography).toEqual({ state: '06', place: '69084' });
    expect(row.values['B17001_001E']).toBe(54210);
    expect(row.values['B17001_002E']).toBe(11840);
    expect(row.margins_of_error['B17001_002M']).toBe(1045);

    // Every Census sentinel code must become honest null, NEVER a negative number!
    expect(row.values['B19013_001E']).toBeNull();
    expect(row.margins_of_error['B19013_001M']).toBeNull();
    expect(row.values['B25070_010E']).toBeNull();
    expect(row.margins_of_error['B25070_010M']).toBeNull();
    expect(row.missing_sentinels['B19013_001E']?.code).toBe(-666666666);
    expect(row.missing_sentinels['B25070_010E']?.code).toBe(-999999999);
    expect(row.missing_sentinels['B25070_010M']?.code).toBe(-888888888);
    expect(result.notes?.some((n) => n.includes('sentinel'))).toBe(true);
  });

  it('auto-detects subject and profile table endpoints and rejects conflicting geographies', async () => {
    let requested = '';
    const mockFetch: FetchFn = async (url) => {
      requested = url;
      return new Response(
        JSON.stringify([
          ['NAME', 'S1701_C03_001E', 'state', 'county'],
          ['Santa Cruz County, California', '11.4', '06', '087'],
        ]),
        { status: 200 },
      );
    };

    const res = await queryCensusAcs(
      {
        dataset: 'acs1',
        year: 2023,
        variables: ['S1701_C03_001E'],
        geography: { state: '06', county: '087' },
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );
    expect(requested).toContain('/2023/acs/acs1/subject');
    expect(res.rows[0]?.values['S1701_C03_001E']).toBe(11.4);

    await expect(
      queryCensusAcs(
        {
          dataset: 'acs5',
          year: 2023,
          variables: ['B17001_001E'],
          geography: { state: '06', county: '087', place: '69084' },
        },
        { fetch: mockFetch },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('queryBlsLaus', () => {
  it('normalizes monthly and annual-average LAUS series with provisional flags and footnotes', async () => {
    let capturedBody = '';
    const mockFetch: FetchFn = async (_url, init) => {
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          status: 'REQUEST_SUCCEEDED',
          responseTime: 118,
          message: [],
          Results: {
            series: [
              {
                seriesID: 'LAUCN060870000000003',
                data: [
                  {
                    year: '2024',
                    period: 'M12',
                    periodName: 'December',
                    latest: 'true',
                    value: '5.8',
                    footnotes: [{ code: 'P', text: 'Preliminary.' }],
                  },
                  {
                    year: '2024',
                    period: 'M13',
                    periodName: 'Annual',
                    value: '6.1',
                    footnotes: [{}],
                  },
                  {
                    year: '2023',
                    period: 'M11',
                    periodName: 'November',
                    value: '-',
                    footnotes: [{ code: 'N', text: 'Not available.' }],
                  },
                ],
              },
            ],
          },
        }),
        { status: 200 },
      );
    };

    const result = await queryBlsLaus(
      {
        seriesIds: ['LAUCN060870000000003'],
        startYear: 2023,
        endYear: 2024,
        apiKey: 'SECRET_BLS_KEY',
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );

    expect(capturedBody).toContain('SECRET_BLS_KEY');
    expect(result.source_url).not.toContain('SECRET_BLS_KEY');
    expect(result.row_count).toBe(3);

    const annual = result.rows.find((r) => r.period === 'M13')!;
    expect(annual.is_annual_average).toBe(true);
    expect(annual.value).toBe(6.1);
    expect(annual.provisional).toBe(false);

    const dec = result.rows.find((r) => r.period === 'M12')!;
    expect(dec.latest).toBe(true);
    expect(dec.provisional).toBe(true);
    expect(dec.footnotes).toEqual([{ code: 'P', text: 'Preliminary.' }]);

    const missing = result.rows.find((r) => r.year === 2023)!;
    expect(missing.value).toBeNull();
  });

  it('surfaces BLS API_ERROR status and enforces year span limits', async () => {
    const errFetch: FetchFn = async () =>
      new Response(
        JSON.stringify({
          status: 'REQUEST_NOT_PROCESSED',
          message: ['Request could not be serviced, daily threshold reached.'],
        }),
        { status: 200 },
      );

    await expect(
      queryBlsLaus(
        { seriesIds: ['LAUCN060870000000003'], startYear: 2020, endYear: 2024 },
        { fetch: errFetch },
      ),
    ).rejects.toMatchObject({ code: 'API_ERROR' });

    await expect(
      queryBlsLaus(
        { seriesIds: ['LAUCN060870000000003'], startYear: 2010, endYear: 2024 },
        { fetch: errFetch },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('queryCdcPlaces', () => {
  it('queries CDC PLACES SODA endpoint with escaped SoQL and parses confidence intervals', async () => {
    let capturedUrl = '';
    const mockFetch: FetchFn = async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify([
          {
            year: '2022',
            stateabbr: 'CA',
            statedesc: 'California',
            locationname: "O'Brien",
            locationid: '06087',
            category: 'Health Risk Behaviors',
            measure: 'Current lack of health insurance among adults aged 18-64 years',
            measureid: 'ACCESS2',
            datavaluetype: 'Crude prevalence',
            datavaluetypeid: 'CrdPrv',
            data_value_unit: '%',
            data_value: '9.4',
            low_confidence_limit: '8.2',
            high_confidence_limit: '10.7',
            totalpopulation: '267792',
          },
          {
            year: '2022',
            stateabbr: 'CA',
            statedesc: 'California',
            locationname: "O'Brien",
            locationid: '06087',
            category: 'Health Risk Behaviors',
            measure: 'Current lack of health insurance among adults aged 18-64 years',
            measureid: 'ACCESS2',
            datavaluetype: 'Age-adjusted prevalence',
            datavaluetypeid: 'AgeAdjPrv',
            data_value_unit: '%',
            data_value: '10.1',
            low_confidence_limit: '8.9',
            high_confidence_limit: '11.4',
            totalpopulation: '267792',
          },
        ]),
        { status: 200 },
      );
    };

    const result = await queryCdcPlaces(
      {
        level: 'county',
        stateAbbr: 'CA',
        locationName: "O'Brien",
        measureId: 'ACCESS2',
        year: 2022,
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );

    expect(capturedUrl).toContain('data.cdc.gov/resource/swc5-untb.json');
    expect(decodeURIComponent(capturedUrl)).toContain("O''Brien");
    expect(result.row_count).toBe(2);
    expect(result.rows[0]?.value).toBe(9.4);
    expect(result.rows[0]?.low_confidence_limit).toBe(8.2);
    expect(result.rows[0]?.high_confidence_limit).toBe(10.7);
    expect(result.rows[1]?.data_value_type_id).toBe('AgeAdjPrv');
  });
});

describe('queryEpaEnvirofacts', () => {
  it('queries SDWIS, TRI, and AQS endpoints and preserves string ID codes', async () => {
    const urls: string[] = [];
    const mockFetch: FetchFn = async (url) => {
      urls.push(url);
      if (url.includes('GEOGRAPHIC_AREA')) {
        return new Response(
          JSON.stringify([
            {
              PWSID: 'CA4410010',
              VIOLATION_CODE: '02',
              CONTAMINANT_CODE: '2950',
              IS_HEALTH_BASED_IND: 'Y',
              COMPL_PER_BEGIN_DATE: '2023-01-01',
              POPULATION_SERVED_COUNT: '98200',
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('V_TRI_FORM_R_EZ')) {
        return new Response(
          JSON.stringify([
            {
              TRI_FACILITY_ID: '95060EXAMPLE01',
              FACILITY_NAME: 'Coastal Plant',
              ST: 'CA',
              COUNTY: 'SANTA CRUZ',
              REPORTING_YEAR: '2023',
              TOTAL_RELEASES: '1425.5',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify([
          {
            STATE_CODE: '06',
            COUNTY_CODE: '087',
            PARAMETER_CODE: '88101',
            YEAR: '2023',
            ARITHMETIC_MEAN: '6.42',
          },
        ]),
        { status: 200 },
      );
    };

    const sdwis = await queryEpaEnvirofacts(
      { dataset: 'sdwis', stateAbbr: 'CA', countyName: 'Santa Cruz County', year: 2023, limit: 25 },
      { fetch: mockFetch, now: FIXED_NOW },
    );
    expect(urls[0]).toContain('COUNTY_SERVED/SANTA%20CRUZ/VIOLATION/COMPL_PER_BEGIN_DATE/CONTAINING/2023/rows/0:24/JSON');
    expect(sdwis.rows[0]?.pwsid).toBe('CA4410010');
    expect(sdwis.rows[0]?.violation_code).toBe('02'); // Leading zero preserved
    expect(sdwis.rows[0]?.population_served_count).toBe(98200);

    const tri = await queryEpaEnvirofacts(
      { dataset: 'tri', stateAbbr: 'CA', countyName: 'Santa Cruz', year: 2023 },
      { fetch: mockFetch, now: FIXED_NOW },
    );
    expect(tri.rows[0]?.total_releases).toBe(1425.5);

    const aqs = await queryEpaEnvirofacts(
      { dataset: 'aqs', stateAbbr: 'CA', countyName: 'Santa Cruz', year: 2023 },
      { fetch: mockFetch, now: FIXED_NOW },
    );
    expect(urls[2]).toContain('/AQS_ANNUAL_SUMMARY/STATE_CODE/06/COUNTY_NAME/SANTA%20CRUZ/YEAR/2023/');
    expect(aqs.rows[0]?.state_code).toBe('06');
    expect(aqs.rows[0]?.arithmetic_mean).toBe(6.42);
  });
});

describe('querySocrata', () => {
  it('enforces civic domain allowlist, row caps, safe SoQL, and header-only app tokens', async () => {
    expect(isAllowedSocrataDomain('data.cityofnewyork.us')).toBe(true);
    expect(isAllowedSocrataDomain('data.sfgov.org')).toBe(true);
    expect(isAllowedSocrataDomain('data.ca.gov')).toBe(true);
    expect(isAllowedSocrataDomain('evil.example.com')).toBe(false);
    expect(isAllowedSocrataDomain('127.0.0.1')).toBe(false);

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    const mockFetch: FetchFn = async (url, init) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(
        JSON.stringify([
          { borough: 'BROOKLYN', count_complaints: '42150' },
          { borough: 'QUEENS', count_complaints: '38910' },
        ]),
        { status: 200 },
      );
    };

    const res = await querySocrata(
      {
        domain: 'data.cityofnewyork.us',
        datasetId: 'erm2-nwe9',
        select: 'borough, count(*) as count_complaints',
        where: "created_date >= '2024-01-01T00:00:00'",
        group: 'borough',
        order: 'count_complaints DESC',
        limit: 50,
        appToken: 'SECRET_SOCRATA_TOKEN',
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );

    expect(capturedHeaders['X-App-Token']).toBe('SECRET_SOCRATA_TOKEN');
    expect(capturedUrl).not.toContain('SECRET_SOCRATA_TOKEN');
    expect(res.source_url).toContain('https://data.cityofnewyork.us/resource/erm2-nwe9.json');
    expect(res.row_count).toBe(2);

    // Refuses non-allowlisted domain
    await expect(
      querySocrata({ domain: 'evil.example.com', datasetId: 'erm2-nwe9' }, { fetch: mockFetch }),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' });

    // Refuses limit > 500
    await expect(
      querySocrata({ domain: 'data.sfgov.org', datasetId: 'abcd-1234', limit: 501 }, { fetch: mockFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    // Refuses SQL injection / mutating SoQL
    await expect(
      querySocrata(
        { domain: 'data.sfgov.org', datasetId: 'abcd-1234', where: '1=1; DROP TABLE users' },
        { fetch: mockFetch },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('queryArcgisFeatures', () => {
  it('queries FeatureServer layers with outStatistics, handles transfer limits, and detects HTTP 200 error envelopes', async () => {
    let capturedUrl = '';
    const mockFetch: FetchFn = async (url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          exceededTransferLimit: true,
          features: [
            { attributes: { DISTRICT: 'D1', TOTAL_UNITS: 1420 } },
            { attributes: { DISTRICT: 'D2', TOTAL_UNITS: 980 } },
          ],
        }),
        { status: 200 },
      );
    };

    const res = await queryArcgisFeatures(
      {
        serviceUrl: 'https://services.arcgis.com/org123/arcgis/rest/services/Housing/FeatureServer/0',
        where: 'YEAR = 2024',
        outStatistics: [
          {
            statisticType: 'sum',
            onStatisticField: 'UNITS',
            outStatisticFieldName: 'TOTAL_UNITS',
          },
        ],
        groupByFieldsForStatistics: ['DISTRICT'],
        limit: 100,
      },
      { fetch: mockFetch, now: FIXED_NOW },
    );

    expect(capturedUrl).toContain('/FeatureServer/0/query?');
    expect(capturedUrl).toContain('f=json');
    expect(capturedUrl).toContain('returnGeometry=false');
    expect(res.row_count).toBe(2);
    expect(res.truncated).toBe(true);
    expect(res.rows[0]).toEqual({ DISTRICT: 'D1', TOTAL_UNITS: 1420 });

    // ArcGIS HTTP 200 error envelope
    const errFetch: FetchFn = async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, message: 'Unable to complete operation.', details: ['Invalid where clause'] },
        }),
        { status: 200 },
      );

    await expect(
      queryArcgisFeatures(
        { serviceUrl: 'https://services.arcgis.com/org123/arcgis/rest/services/Housing/FeatureServer/0' },
        { fetch: errFetch },
      ),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(CivicDataError);
      expect((err as CivicDataError).code).toBe('API_ERROR');
      expect((err as CivicDataError).message).toContain('Invalid where clause');
      return true;
    });

    // Rejects non-FeatureServer/MapServer path and non-HTTPS
    await expect(
      queryArcgisFeatures({ serviceUrl: 'https://example.gov/not-arcgis' }, { fetch: mockFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      queryArcgisFeatures(
        { serviceUrl: 'http://services.arcgis.com/org/arcgis/rest/services/H/FeatureServer/0' },
        { fetch: mockFetch },
      ),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' });
  });
});
