import { describe, expect, it } from 'vitest';
import { defaultTenantConfig } from './config-defaults.js';
import { SAMPLE_DATA_CONFIG_KEY, isSampleDataValue } from './config.js';

/**
 * The sample-data mark (scripts/seed-demo-data.ts): one key, one meaning,
 * read the same way by the portrait pages, the embed, the organization pages
 * and the open-data API.
 */
describe('sample_data config key', () => {
  it('is the key the seeding script writes and migration 0015 makes public', () => {
    expect(SAMPLE_DATA_CONFIG_KEY).toBe('sample_data');
  });

  it('marks a portrait only for the literal true the script stores', () => {
    expect(isSampleDataValue(true)).toBe(true);
    for (const value of [false, null, undefined, 'true', 1, {}, []]) expect(isSampleDataValue(value)).toBe(false);
  });

  it('is not an owner setting: a new portrait’s config never carries it, so staff cannot switch the notice off', () => {
    expect(Object.keys(defaultTenantConfig('Ithaca', 'City of Ithaca'))).not.toContain(SAMPLE_DATA_CONFIG_KEY);
  });
});
