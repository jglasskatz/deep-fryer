import { z } from 'zod';
import { fetchCivicJson } from './http.js';
import { CivicDataError, type CivicDataHttpOptions } from './types.js';

export const STATE_FIPS_RE = /^\d{2}$/;
export const COUNTY_FIPS_RE = /^\d{3}$/;
export const PLACE_FIPS_RE = /^\d{5}$/;
export const PUMA_ID_RE = /^\d{5}$/;

export interface UsStateEntry {
  fips: string;
  abbr: string;
  name: string;
}

/** Official US Census Bureau 2-digit FIPS codes for all 50 states, DC, and Puerto Rico. */
export const US_STATES: readonly UsStateEntry[] = [
  { fips: '01', abbr: 'AL', name: 'Alabama' },
  { fips: '02', abbr: 'AK', name: 'Alaska' },
  { fips: '04', abbr: 'AZ', name: 'Arizona' },
  { fips: '05', abbr: 'AR', name: 'Arkansas' },
  { fips: '06', abbr: 'CA', name: 'California' },
  { fips: '08', abbr: 'CO', name: 'Colorado' },
  { fips: '09', abbr: 'CT', name: 'Connecticut' },
  { fips: '10', abbr: 'DE', name: 'Delaware' },
  { fips: '11', abbr: 'DC', name: 'District of Columbia' },
  { fips: '12', abbr: 'FL', name: 'Florida' },
  { fips: '13', abbr: 'GA', name: 'Georgia' },
  { fips: '15', abbr: 'HI', name: 'Hawaii' },
  { fips: '16', abbr: 'ID', name: 'Idaho' },
  { fips: '17', abbr: 'IL', name: 'Illinois' },
  { fips: '18', abbr: 'IN', name: 'Indiana' },
  { fips: '19', abbr: 'IA', name: 'Iowa' },
  { fips: '20', abbr: 'KS', name: 'Kansas' },
  { fips: '21', abbr: 'KY', name: 'Kentucky' },
  { fips: '22', abbr: 'LA', name: 'Louisiana' },
  { fips: '23', abbr: 'ME', name: 'Maine' },
  { fips: '24', abbr: 'MD', name: 'Maryland' },
  { fips: '25', abbr: 'MA', name: 'Massachusetts' },
  { fips: '26', abbr: 'MI', name: 'Michigan' },
  { fips: '27', abbr: 'MN', name: 'Minnesota' },
  { fips: '28', abbr: 'MS', name: 'Mississippi' },
  { fips: '29', abbr: 'MO', name: 'Missouri' },
  { fips: '30', abbr: 'MT', name: 'Montana' },
  { fips: '31', abbr: 'NE', name: 'Nebraska' },
  { fips: '32', abbr: 'NV', name: 'Nevada' },
  { fips: '33', abbr: 'NH', name: 'New Hampshire' },
  { fips: '34', abbr: 'NJ', name: 'New Jersey' },
  { fips: '35', abbr: 'NM', name: 'New Mexico' },
  { fips: '36', abbr: 'NY', name: 'New York' },
  { fips: '37', abbr: 'NC', name: 'North Carolina' },
  { fips: '38', abbr: 'ND', name: 'North Dakota' },
  { fips: '39', abbr: 'OH', name: 'Ohio' },
  { fips: '40', abbr: 'OK', name: 'Oklahoma' },
  { fips: '41', abbr: 'OR', name: 'Oregon' },
  { fips: '42', abbr: 'PA', name: 'Pennsylvania' },
  { fips: '44', abbr: 'RI', name: 'Rhode Island' },
  { fips: '45', abbr: 'SC', name: 'South Carolina' },
  { fips: '46', abbr: 'SD', name: 'South Dakota' },
  { fips: '47', abbr: 'TN', name: 'Tennessee' },
  { fips: '48', abbr: 'TX', name: 'Texas' },
  { fips: '49', abbr: 'UT', name: 'Utah' },
  { fips: '50', abbr: 'VT', name: 'Vermont' },
  { fips: '51', abbr: 'VA', name: 'Virginia' },
  { fips: '53', abbr: 'WA', name: 'Washington' },
  { fips: '54', abbr: 'WV', name: 'West Virginia' },
  { fips: '55', abbr: 'WI', name: 'Wisconsin' },
  { fips: '56', abbr: 'WY', name: 'Wyoming' },
  { fips: '72', abbr: 'PR', name: 'Puerto Rico' },
];

const BY_FIPS = new Map<string, UsStateEntry>(US_STATES.map((s) => [s.fips, s]));
const BY_ABBR = new Map<string, UsStateEntry>(US_STATES.map((s) => [s.abbr, s]));
const BY_NAME = new Map<string, UsStateEntry>(US_STATES.map((s) => [s.name.toLowerCase(), s]));

export function isValidStateFips(value: string): boolean {
  return STATE_FIPS_RE.test(value) && BY_FIPS.has(value);
}

export function isValidCountyFips(value: string): boolean {
  return COUNTY_FIPS_RE.test(value) && value !== '000';
}

export function isValidPlaceFips(value: string): boolean {
  return PLACE_FIPS_RE.test(value) && value !== '00000';
}

export function isValidPumaId(value: string): boolean {
  return PUMA_ID_RE.test(value) && value !== '00000';
}

export function assertStateFips(value: string): string {
  const trimmed = value.trim();
  if (!isValidStateFips(trimmed)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid state_fips "${value}": expected a valid 2-digit US Census state FIPS code (e.g. "06")`,
    );
  }
  return trimmed;
}

export function assertCountyFips(value: string): string {
  const trimmed = value.trim();
  if (!isValidCountyFips(trimmed)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid county_fips "${value}": expected a 3-digit county FIPS code (e.g. "087")`,
    );
  }
  return trimmed;
}

export function assertPlaceFips(value: string): string {
  const trimmed = value.trim();
  if (!isValidPlaceFips(trimmed)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid place_fips "${value}": expected a 5-digit Census place FIPS code (e.g. "69084")`,
    );
  }
  return trimmed;
}

export function assertPumaId(value: string): string {
  const trimmed = value.trim();
  if (!isValidPumaId(trimmed)) {
    throw new CivicDataError(
      'INVALID_INPUT',
      `invalid puma_id "${value}": expected a 5-digit Census PUMA code`,
    );
  }
  return trimmed;
}

/**
 * Resolve a 2-digit FIPS, 2-letter postal abbreviation, or full US state name.
 * Returns `null` when the input is not a recognized US state/DC/PR.
 */
export function resolveStateInput(raw: string): UsStateEntry | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (STATE_FIPS_RE.test(cleaned)) {
    return BY_FIPS.get(cleaned) ?? null;
  }
  const upper = cleaned.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return BY_ABBR.get(upper) ?? null;
  }
  return BY_NAME.get(cleaned.toLowerCase()) ?? null;
}

export function stateAbbrToFips(abbr: string): string | null {
  return BY_ABBR.get(abbr.trim().toUpperCase())?.fips ?? null;
}

export function fipsToStateAbbr(fips: string): string | null {
  return BY_FIPS.get(fips.trim())?.abbr ?? null;
}

const httpsUrlString = z
  .string()
  .refine((val) => {
    try {
      return new URL(val).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be a valid https URL');

const hostnameString = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i,
    'must be a valid hostname',
  );

export const RegionIdentifiersSchema = z.object({
  state_fips: z.string().refine(isValidStateFips, 'must be a valid 2-digit US state FIPS'),
  county_fips: z
    .string()
    .refine(isValidCountyFips, 'must be a valid 3-digit county FIPS')
    .optional(),
  place_fips: z
    .string()
    .refine(isValidPlaceFips, 'must be a valid 5-digit place FIPS')
    .optional(),
  puma_ids: z
    .array(z.string().refine(isValidPumaId, 'must be a valid 5-digit PUMA ID'))
    .default([]),
  socrata_domains: z.array(hostnameString).default([]),
  arcgis_portals: z.array(httpsUrlString).default([]),
  state_abbr: z.string().regex(/^[A-Z]{2}$/).optional(),
  matched_name: z.string().optional(),
  source_url: httpsUrlString.optional(),
});

export type RegionIdentifiers = z.infer<typeof RegionIdentifiersSchema>;

interface PortalHint {
  state_fips: string;
  county_fips?: string;
  place_fips?: string;
  socrata_domains: string[];
  arcgis_portals: string[];
}

const KNOWN_CIVIC_PORTALS: readonly PortalHint[] = [
  {
    state_fips: '36',
    place_fips: '51000',
    socrata_domains: ['data.cityofnewyork.us', 'data.ny.gov'],
    arcgis_portals: ['https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services'],
  },
  {
    state_fips: '06',
    place_fips: '67000',
    socrata_domains: ['data.sfgov.org', 'data.ca.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '06',
    county_fips: '087',
    socrata_domains: ['data.ca.gov'],
    arcgis_portals: ['https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services'],
  },
  {
    state_fips: '06',
    place_fips: '44000',
    socrata_domains: ['data.lacity.org', 'data.lacounty.gov', 'data.ca.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '17',
    place_fips: '14000',
    socrata_domains: ['data.cityofchicago.org', 'data.illinois.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '53',
    place_fips: '63000',
    socrata_domains: ['data.seattle.gov', 'data.kingcounty.gov', 'data.wa.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '48',
    place_fips: '05000',
    socrata_domains: ['data.austintexas.gov', 'data.texas.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '25',
    place_fips: '07000',
    socrata_domains: ['data.boston.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '06',
    socrata_domains: ['data.ca.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '36',
    socrata_domains: ['data.ny.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '53',
    socrata_domains: ['data.wa.gov'],
    arcgis_portals: [],
  },
  {
    state_fips: '48',
    socrata_domains: ['data.texas.gov'],
    arcgis_portals: [],
  },
];

export function lookupKnownCivicPortals(ids: {
  state_fips: string;
  county_fips?: string;
  place_fips?: string;
}): { socrata_domains: string[]; arcgis_portals: string[] } {
  const socrata = new Set<string>();
  const arcgis = new Set<string>();
  for (const hint of KNOWN_CIVIC_PORTALS) {
    if (hint.state_fips !== ids.state_fips) continue;
    if (hint.place_fips && hint.place_fips !== ids.place_fips) continue;
    if (hint.county_fips && hint.county_fips !== ids.county_fips) continue;
    for (const d of hint.socrata_domains) socrata.add(d);
    for (const a of hint.arcgis_portals) arcgis.add(a);
  }
  return {
    socrata_domains: [...socrata],
    arcgis_portals: [...arcgis],
  };
}

export interface ResolveUsFipsInput {
  /** 2-letter abbreviation ("CA"), full state name ("California"), or 2-digit FIPS ("06"). */
  state?: string;
  /** City, town, or CDP name (e.g. "Santa Cruz", "New York"). */
  placeName?: string;
  /** County / Parish / Borough name (e.g. "Santa Cruz County", "Monterey"). */
  countyName?: string;
  /** Optional street address for Census Geocoder lookup. */
  address?: string;
  /** Optional WGS84 coordinates for Census Geocoder lookup. */
  coordinates?: { lat: number; lon: number };
  /** ACS catalog year for place/county Gazetteer lookup (default: 2023). */
  year?: number;
  /** Optional Census API key (omitted from archived canonical URL). */
  apiKey?: string;
}

export interface FipsCandidate {
  name: string;
  state_fips: string;
  county_fips?: string;
  place_fips?: string;
}

export interface ResolveUsFipsResult {
  resolved: boolean;
  is_us_jurisdiction: boolean;
  identifiers?: RegionIdentifiers;
  candidates?: FipsCandidate[];
  source_url?: string;
  retrieved_at: string;
  message: string;
}

const PLACE_SUFFIX_RE =
  /\s+(?:city and borough|consolidated government|unified government|metro government|metropolitan government|city|town|village|borough|municipality|cdp|zona urbana|comunidad)$/i;

const COUNTY_SUFFIX_RE =
  /\s+(?:county|parish|borough|census area|municipality|municipio|city and borough)$/i;

function normalizeGeoName(raw: string, kind: 'place' | 'county'): string {
  // Census ACS NAME format is e.g. "Santa Cruz city, California" or "Santa Cruz County, California"
  const head = raw.split(',')[0]?.trim() ?? raw.trim();
  const stripped = head.replace(kind === 'place' ? PLACE_SUFFIX_RE : COUNTY_SUFFIX_RE, '');
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface CensusGeocoderGeography {
  STATE?: string;
  COUNTY?: string;
  PLACE?: string;
  PUMA?: string;
  NAME?: string;
  BASENAME?: string;
}

interface CensusGeocoderResponse {
  result?: {
    geographies?: Record<string, CensusGeocoderGeography[] | undefined>;
    addressMatches?: Array<{
      matchedAddress?: string;
      geographies?: Record<string, CensusGeocoderGeography[] | undefined>;
    }>;
  };
}

function extractGeographiesFromGeocoder(
  geos: Record<string, CensusGeocoderGeography[] | undefined>,
  sourceUrl: string,
  retrievedAt: string,
): ResolveUsFipsResult {
  const states = geos['States'] ?? [];
  const counties = geos['Counties'] ?? [];
  const places = geos['Incorporated Places'] ?? geos['Census Designated Places'] ?? [];
  const pumaKey = Object.keys(geos).find((k) => /public use microdata areas/i.test(k));
  const pumas = pumaKey ? (geos[pumaKey] ?? []) : [];

  const stateGeo = states[0];
  const stateFips = stateGeo?.STATE ?? counties[0]?.STATE ?? places[0]?.STATE;
  if (!stateFips || !isValidStateFips(stateFips)) {
    return {
      resolved: false,
      is_us_jurisdiction: false,
      source_url: sourceUrl,
      retrieved_at: retrievedAt,
      message:
        'Census Geocoder returned no US state FIPS for the supplied coordinates/address. If this is a non-US jurisdiction, fall back to national statistical agency sources.',
    };
  }

  const countyFips = counties[0]?.COUNTY;
  const placeFips = places[0]?.PLACE;
  const pumaIds = pumas
    .map((p) => p.PUMA)
    .filter((id): id is string => typeof id === 'string' && isValidPumaId(id));
  const portals = lookupKnownCivicPortals({
    state_fips: stateFips,
    county_fips: countyFips && isValidCountyFips(countyFips) ? countyFips : undefined,
    place_fips: placeFips && isValidPlaceFips(placeFips) ? placeFips : undefined,
  });

  const identifiers = RegionIdentifiersSchema.parse({
    state_fips: stateFips,
    county_fips: countyFips && isValidCountyFips(countyFips) ? countyFips : undefined,
    place_fips: placeFips && isValidPlaceFips(placeFips) ? placeFips : undefined,
    puma_ids: pumaIds,
    socrata_domains: portals.socrata_domains,
    arcgis_portals: portals.arcgis_portals,
    state_abbr: fipsToStateAbbr(stateFips) ?? undefined,
    matched_name: places[0]?.NAME ?? counties[0]?.NAME ?? stateGeo?.NAME,
    source_url: sourceUrl,
  });

  return {
    resolved: true,
    is_us_jurisdiction: true,
    identifiers,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    message: `Resolved US Census FIPS via Census Geocoder (${identifiers.matched_name ?? identifiers.state_fips}).`,
  };
}

function parseCensusNameTable(
  payload: unknown,
  geoCol: 'place' | 'county',
): Array<{ name: string; state_fips: string; code: string }> {
  if (!Array.isArray(payload) || payload.length < 2 || !Array.isArray(payload[0])) {
    throw new CivicDataError(
      'PARSE_ERROR',
      'Census geography catalog returned an unexpected payload shape (expected 2D array)',
    );
  }
  const headers = (payload[0] as unknown[]).map((h) => String(h));
  const nameIdx = headers.indexOf('NAME');
  const stateIdx = headers.indexOf('state');
  const geoIdx = headers.indexOf(geoCol);
  if (nameIdx === -1 || stateIdx === -1 || geoIdx === -1) {
    throw new CivicDataError(
      'PARSE_ERROR',
      `Census geography catalog missing required columns (NAME, state, ${geoCol})`,
    );
  }
  const rows: Array<{ name: string; state_fips: string; code: string }> = [];
  for (let i = 1; i < payload.length; i++) {
    const row = payload[i];
    if (!Array.isArray(row)) continue;
    const name = String(row[nameIdx] ?? '').trim();
    const stateFips = String(row[stateIdx] ?? '').trim();
    const code = String(row[geoIdx] ?? '').trim();
    if (name && stateFips && code) {
      rows.push({ name, state_fips: stateFips, code });
    }
  }
  return rows;
}

/**
 * Resolve US Census FIPS codes (`state_fips`, `county_fips`, `place_fips`,
 * `puma_ids`) and known open-data portal domains for a US jurisdiction.
 *
 * Uses the official US Census Geocoder for coordinates/addresses, or the
 * Census Bureau ACS geography catalog for place/county name lookups.
 * Returns a clean `is_us_jurisdiction: false` result for non-US places.
 */
export async function resolveUsFips(
  input: ResolveUsFipsInput,
  opts: CivicDataHttpOptions = {},
): Promise<ResolveUsFipsResult> {
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();

  // Mode 1: Census Geocoder by coordinates
  if (input.coordinates) {
    const { lat, lon } = input.coordinates;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new CivicDataError('INVALID_INPUT', 'coordinates must be valid WGS84 lat (-90..90) and lon (-180..180)');
    }
    const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/coordinates');
    url.searchParams.set('x', String(lon));
    url.searchParams.set('y', String(lat));
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('vintage', 'Current_Current');
    url.searchParams.set('format', 'json');

    const { data, canonicalUrl } = await fetchCivicJson<CensusGeocoderResponse>(
      { url: url.toString() },
      opts,
    );
    const geos = data?.result?.geographies ?? {};
    return extractGeographiesFromGeocoder(geos, canonicalUrl, retrievedAt);
  }

  // Mode 2: Census Geocoder by one-line street address
  if (input.address && input.address.trim()) {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');
    url.searchParams.set('address', input.address.trim());
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('vintage', 'Current_Current');
    url.searchParams.set('format', 'json');

    const { data, canonicalUrl } = await fetchCivicJson<CensusGeocoderResponse>(
      { url: url.toString() },
      opts,
    );
    const match = data?.result?.addressMatches?.[0];
    if (!match?.geographies) {
      return {
        resolved: false,
        is_us_jurisdiction: true,
        source_url: canonicalUrl,
        retrieved_at: retrievedAt,
        message: `Census Geocoder found no address match for "${input.address.trim()}".`,
      };
    }
    return extractGeographiesFromGeocoder(match.geographies, canonicalUrl, retrievedAt);
  }

  // Mode 3: State / County / Place name resolution via US state table + Census geography API
  if (!input.state || !input.state.trim()) {
    throw new CivicDataError(
      'INVALID_INPUT',
      'provide either state (abbr/name/FIPS), coordinates, or address to resolve US FIPS',
    );
  }

  const stateEntry = resolveStateInput(input.state);
  if (!stateEntry) {
    return {
      resolved: false,
      is_us_jurisdiction: false,
      retrieved_at: retrievedAt,
      message: `"${input.state}" is not a recognized US state, DC, or Puerto Rico. US Census/BLS/CDC/EPA connectors apply to US jurisdictions only; use national statistical agencies or web search for non-US regions.`,
    };
  }

  const year = input.year ?? 2023;
  if (!Number.isInteger(year) || year < 2009 || year > 2030) {
    throw new CivicDataError('INVALID_INPUT', `invalid year ${year}: expected integer 2009..2030`);
  }

  let countyFips: string | undefined;
  let placeFips: string | undefined;
  let matchedName = stateEntry.name;
  let lastSourceUrl: string | undefined;
  const candidates: FipsCandidate[] = [];

  if (input.countyName && input.countyName.trim()) {
    const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
    url.searchParams.set('get', 'NAME');
    url.searchParams.set('for', 'county:*');
    url.searchParams.set('in', `state:${stateEntry.fips}`);
    if (input.apiKey) url.searchParams.set('key', input.apiKey);

    const { data, canonicalUrl } = await fetchCivicJson<unknown>({ url: url.toString() }, opts);
    lastSourceUrl = canonicalUrl;
    const rows = parseCensusNameTable(data, 'county');
    const target = normalizeGeoName(input.countyName, 'county');
    const exact = rows.filter((r) => normalizeGeoName(r.name, 'county') === target);

    if (exact.length === 1 && exact[0]) {
      countyFips = exact[0].code;
      matchedName = exact[0].name;
    } else if (exact.length > 1) {
      candidates.push(
        ...exact.map((r) => ({ name: r.name, state_fips: r.state_fips, county_fips: r.code })),
      );
    } else {
      const partial = rows
        .filter((r) => normalizeGeoName(r.name, 'county').includes(target))
        .slice(0, 10);
      candidates.push(
        ...partial.map((r) => ({ name: r.name, state_fips: r.state_fips, county_fips: r.code })),
      );
      if (!input.placeName) {
        return {
          resolved: false,
          is_us_jurisdiction: true,
          candidates,
          source_url: canonicalUrl,
          retrieved_at: retrievedAt,
          message: `No exact county match for "${input.countyName}" in ${stateEntry.name} (${stateEntry.fips}).`,
        };
      }
    }
  }

  if (input.placeName && input.placeName.trim()) {
    const url = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
    url.searchParams.set('get', 'NAME');
    url.searchParams.set('for', 'place:*');
    url.searchParams.set('in', `state:${stateEntry.fips}`);
    if (input.apiKey) url.searchParams.set('key', input.apiKey);

    const { data, canonicalUrl } = await fetchCivicJson<unknown>({ url: url.toString() }, opts);
    lastSourceUrl = canonicalUrl;
    const rows = parseCensusNameTable(data, 'place');
    const target = normalizeGeoName(input.placeName, 'place');
    const exact = rows.filter((r) => normalizeGeoName(r.name, 'place') === target);

    if (exact.length === 1 && exact[0]) {
      placeFips = exact[0].code;
      matchedName = exact[0].name;
    } else if (exact.length > 1) {
      // Prefer incorporated city/town over CDP when both share a name
      const incorporated = exact.find((r) => /\b(city|town|village|borough)\b/i.test(r.name));
      if (incorporated) {
        placeFips = incorporated.code;
        matchedName = incorporated.name;
      }
      candidates.push(
        ...exact.map((r) => ({ name: r.name, state_fips: r.state_fips, place_fips: r.code })),
      );
    } else {
      const partial = rows
        .filter((r) => normalizeGeoName(r.name, 'place').includes(target))
        .slice(0, 10);
      candidates.push(
        ...partial.map((r) => ({ name: r.name, state_fips: r.state_fips, place_fips: r.code })),
      );
      return {
        resolved: false,
        is_us_jurisdiction: true,
        candidates,
        source_url: canonicalUrl,
        retrieved_at: retrievedAt,
        message: `No exact place match for "${input.placeName}" in ${stateEntry.name} (${stateEntry.fips}).`,
      };
    }
  }

  const portals = lookupKnownCivicPortals({
    state_fips: stateEntry.fips,
    county_fips: countyFips,
    place_fips: placeFips,
  });

  const identifiers = RegionIdentifiersSchema.parse({
    state_fips: stateEntry.fips,
    county_fips: countyFips,
    place_fips: placeFips,
    puma_ids: [],
    socrata_domains: portals.socrata_domains,
    arcgis_portals: portals.arcgis_portals,
    state_abbr: stateEntry.abbr,
    matched_name: matchedName,
    source_url: lastSourceUrl,
  });

  return {
    resolved: true,
    is_us_jurisdiction: true,
    identifiers,
    ...(candidates.length > 0 ? { candidates } : {}),
    source_url: lastSourceUrl,
    retrieved_at: retrievedAt,
    message: `Resolved US Census FIPS for ${matchedName} (state=${stateEntry.fips}${countyFips ? `, county=${countyFips}` : ''}${placeFips ? `, place=${placeFips}` : ''}).`,
  };
}
