import { describe, expect, it } from 'vitest';
import {
  RegionIdentifiersSchema,
  assertCountyFips,
  assertPlaceFips,
  assertStateFips,
  fipsToStateAbbr,
  isValidCountyFips,
  isValidPlaceFips,
  isValidPumaId,
  isValidStateFips,
  resolveUsFips,
  stateAbbrToFips,
} from './fips.js';
import type { FetchFn } from './types.js';

describe('FIPS validation & RegionIdentifiers schema', () => {
  it('validates 2-digit state, 3-digit county, 5-digit place, and 5-digit PUMA formats', () => {
    expect(isValidStateFips('06')).toBe(true);
    expect(isValidStateFips('36')).toBe(true);
    expect(isValidStateFips('72')).toBe(true); // Puerto Rico
    expect(isValidStateFips('99')).toBe(false);
    expect(isValidStateFips('6')).toBe(false);

    expect(isValidCountyFips('087')).toBe(true);
    expect(isValidCountyFips('000')).toBe(false);
    expect(isValidCountyFips('87')).toBe(false);

    expect(isValidPlaceFips('69084')).toBe(true);
    expect(isValidPlaceFips('00000')).toBe(false);
    expect(isValidPlaceFips('6908')).toBe(false);

    expect(isValidPumaId('08701')).toBe(true);
    expect(isValidPumaId('00000')).toBe(false);

    expect(stateAbbrToFips('ca')).toBe('06');
    expect(fipsToStateAbbr('36')).toBe('NY');

    expect(() => assertStateFips('03')).toThrow();
    expect(() => assertCountyFips('000')).toThrow();
    expect(() => assertPlaceFips('123')).toThrow();
  });

  it('validates RegionIdentifiersSchema cleanly', () => {
    const parsed = RegionIdentifiersSchema.parse({
      state_fips: '06',
      county_fips: '087',
      place_fips: '69084',
      puma_ids: ['08701', '08702'],
      socrata_domains: ['data.ca.gov'],
      arcgis_portals: ['https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services'],
    });
    expect(parsed.state_fips).toBe('06');
    expect(parsed.puma_ids).toEqual(['08701', '08702']);

    expect(() =>
      RegionIdentifiersSchema.parse({
        state_fips: '06',
        arcgis_portals: ['http://insecure.example.com/arcgis'],
      }),
    ).toThrow();
  });
});

describe('resolveUsFips', () => {
  const fixedNow = () => new Date('2026-11-23T20:00:00.000Z');

  it('resolves US place and county FIPS from Census ACS geography catalogs and enriches portals', async () => {
    const requestedUrls: string[] = [];
    const mockFetch: FetchFn = async (url) => {
      requestedUrls.push(url);
      if (url.includes('for=county%3A*')) {
        return new Response(
          JSON.stringify([
            ['NAME', 'state', 'county'],
            ['Monterey County, California', '06', '053'],
            ['Santa Cruz County, California', '06', '087'],
          ]),
          { status: 200 },
        );
      }
      if (url.includes('for=place%3A*')) {
        return new Response(
          JSON.stringify([
            ['NAME', 'state', 'place'],
            ['Santa Cruz city, California', '06', '69084'],
            ['Watsonville city, California', '06', '83668'],
          ]),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await resolveUsFips(
      { state: 'CA', countyName: 'Santa Cruz County', placeName: 'Santa Cruz', apiKey: 'TEST_KEY' },
      { fetch: mockFetch, now: fixedNow },
    );

    expect(res.resolved).toBe(true);
    expect(res.is_us_jurisdiction).toBe(true);
    expect(res.identifiers?.state_fips).toBe('06');
    expect(res.identifiers?.county_fips).toBe('087');
    expect(res.identifiers?.place_fips).toBe('69084');
    expect(res.identifiers?.socrata_domains).toContain('data.ca.gov');
    expect(res.source_url).not.toContain('TEST_KEY');
    expect(requestedUrls.length).toBe(2);
  });

  it('resolves FIPS and PUMA IDs via Census Geocoder coordinates lookup', async () => {
    const mockFetch: FetchFn = async (url) => {
      expect(url).toContain('geocoding.geo.census.gov/geocoder/geographies/coordinates');
      return new Response(
        JSON.stringify({
          result: {
            geographies: {
              States: [{ STATE: '36', NAME: 'New York' }],
              Counties: [{ STATE: '36', COUNTY: '061', NAME: 'New York County' }],
              'Incorporated Places': [{ STATE: '36', PLACE: '51000', NAME: 'New York city' }],
              '2020 Census Public Use Microdata Areas': [{ STATE: '36', PUMA: '04101' }],
            },
          },
        }),
        { status: 200 },
      );
    };

    const res = await resolveUsFips(
      { coordinates: { lat: 40.7128, lon: -74.006 } },
      { fetch: mockFetch, now: fixedNow },
    );

    expect(res.resolved).toBe(true);
    expect(res.identifiers?.state_fips).toBe('36');
    expect(res.identifiers?.county_fips).toBe('061');
    expect(res.identifiers?.place_fips).toBe('51000');
    expect(res.identifiers?.puma_ids).toEqual(['04101']);
    expect(res.identifiers?.socrata_domains).toContain('data.cityofnewyork.us');
  });

  it('returns graceful non-US fallback without making network calls for non-US jurisdictions', async () => {
    let called = false;
    const mockFetch: FetchFn = async () => {
      called = true;
      return new Response('[]', { status: 200 });
    };

    const res = await resolveUsFips(
      { state: 'Ontario', placeName: 'Toronto' },
      { fetch: mockFetch, now: fixedNow },
    );
    expect(called).toBe(false);
    expect(res.resolved).toBe(false);
    expect(res.is_us_jurisdiction).toBe(false);
    expect(res.message).toMatch(/non-US/i);
  });
});
