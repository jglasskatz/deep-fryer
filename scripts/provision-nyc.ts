#!/usr/bin/env tsx
/**
 * Provision the NYC portrait family: the whole-city doughnut plus one per
 * borough. Idempotent — existing tenants are kept and their region config
 * updated. Boroughs are county-equivalents, so the default scale policy
 * (city → county) matches how NYC data is actually published.
 */
import { eq } from 'drizzle-orm';
import { getDb, provisionTenant, tenantBySlug, tenantConfig } from '@deep-fryer/db';

const NYC_CONTEXT = [
  'Primary portals: NYC Open Data (data.cityofnewyork.us), DOHMH Community Health Profiles,',
  'DCP Population FactFinder, Mayor\'s Office of Climate & Environmental Justice (GHG inventories),',
  'DEP water/harbor water quality reports, NYCHA & HPD housing data, ACS county-equivalents.',
  'Each borough is a county: use county-level federal series where city publications lack borough cuts.',
].join(' ');

const TENANTS = [
  {
    slug: 'nyc',
    name: 'New York City',
    population: 8804190,
    description: 'The five boroughs — the whole-city doughnut.',
    definition: 'The City of New York: all five boroughs (New York, Kings, Queens, Bronx, and Richmond Counties).',
  },
  {
    slug: 'manhattan',
    name: 'Manhattan',
    population: 1694251,
    description: 'Borough of Manhattan.',
    definition: 'The Borough of Manhattan (New York County, NY).',
  },
  {
    slug: 'brooklyn',
    name: 'Brooklyn',
    population: 2736074,
    description: 'Borough of Brooklyn.',
    definition: 'The Borough of Brooklyn (Kings County, NY).',
  },
  {
    slug: 'queens',
    name: 'Queens',
    population: 2405464,
    description: 'Borough of Queens.',
    definition: 'The Borough of Queens (Queens County, NY).',
  },
  {
    slug: 'bronx',
    name: 'The Bronx',
    population: 1472654,
    description: 'Borough of The Bronx.',
    definition: 'The Borough of The Bronx (Bronx County, NY).',
  },
  {
    slug: 'staten-island',
    name: 'Staten Island',
    population: 495747,
    description: 'Borough of Staten Island.',
    definition: 'The Borough of Staten Island (Richmond County, NY).',
  },
];

async function main() {
  const db = getDb();
  for (const t of TENANTS) {
    let tenant = await tenantBySlug(db, t.slug);
    if (!tenant) {
      ({ tenant } = await provisionTenant(db, {
        slug: t.slug,
        name: t.name,
        region: 'NY, USA',
        population: t.population,
        description: t.description,
      }));
      console.log(`provisioned ${t.slug}`);
    } else {
      console.log(`exists ${t.slug} — updating region config`);
    }
    const region = { name: t.name, definition: t.definition, context_notes: NYC_CONTEXT };
    await db
      .insert(tenantConfig)
      .values({ tenantId: tenant.id, key: 'region', value: region })
      .onConflictDoUpdate({
        target: [tenantConfig.tenantId, tenantConfig.key],
        set: { value: region, updatedAt: new Date() },
      });
  }
  console.log('NYC family ready: nyc + 5 boroughs');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
