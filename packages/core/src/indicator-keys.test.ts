import { describe, expect, it } from 'vitest';
import {
  assignIndicatorKeys,
  deriveIndicatorKey,
  frameworkIndicatorKeys,
  INDICATOR_KEY_PATTERN,
  WHOLE_DIMENSION_GAP,
} from './indicator-keys.js';
import { indicatorSchema } from './validators.js';
import type { Indicator } from './types.js';

const row = (name: string, key?: string): Indicator => ({
  ...(key === undefined ? {} : { key }),
  name,
  value: 12,
  unit: '%',
  year: 2025,
  target: 5,
  source: 'City statistics office',
  source_url: 'https://stats.example.gov/series',
  confidence: 'high',
  geographic_scale: 'city',
});

const keys = (rows: Indicator[]) => rows.map((r) => r.key);

describe('assignIndicatorKeys', () => {
  it('keeps a key a row already has, whatever its name now is', () => {
    const previous = [row('Rent burden', 'cost-burdened-renters')];
    const renamed = [row('Renters paying too much', 'cost-burdened-renters')];
    expect(keys(assignIndicatorKeys(renamed, previous))).toEqual(['cost-burdened-renters']);
  });

  it('returns a row that already has its key as it was', () => {
    const keyed = row('Rent burden', 'rent');
    expect(assignIndicatorKeys([keyed])[0]).toBe(keyed);
  });

  it('takes the key of the previous row with the same name, ignoring case and spacing', () => {
    const previous = [row('Rent burden', 'cost-burdened-renters'), row('Homelessness', 'homelessness-rate')];
    expect(keys(assignIndicatorKeys([row('homelessness'), row('  Rent   burden ')], previous))).toEqual([
      'homelessness-rate',
      'cost-burdened-renters',
    ]);
  });

  it('takes the framework slug of a known indicator by name, when the previous version has no such row', () => {
    const known = frameworkIndicatorKeys('housing');
    const name = known.find((k) => k.key === 'homelessness-rate')!.name;
    expect(keys(assignIndicatorKeys([row(name)], [], known))).toEqual(['homelessness-rate']);
  });

  it('keys a previous version written before keys existed by the framework first', () => {
    const known = frameworkIndicatorKeys('housing');
    const name = known.find((k) => k.key === 'cost-burdened-renters')!.name;
    // The previous row has no key; the new row is the same row, unkeyed too.
    expect(keys(assignIndicatorKeys([row(name)], [row(name)], known))).toEqual(['cost-burdened-renters']);
  });

  it('derives a key from the name of a new custom indicator', () => {
    expect(keys(assignIndicatorKeys([row('Tree canopy (% of city)')]))).toEqual(['tree-canopy-of-city']);
  });

  it('never gives a custom row a framework slug because its name spells it', () => {
    const known = frameworkIndicatorKeys('housing');
    // The framework row "Residents experiencing homelessness" was removed and
    // the group added its own row, whose name would derive "homelessness-rate".
    expect(keys(assignIndicatorKeys([row('Homelessness rate')], [], known))).toEqual(['homelessness-rate-2']);
    // Without the framework in view, the same name keeps its plain key.
    expect(keys(assignIndicatorKeys([row('Homelessness rate')]))).toEqual(['homelessness-rate']);
  });

  it('never gives two rows the same key', () => {
    const out = assignIndicatorKeys([row('Parks'), row('Parks'), row('Other', 'parks'), row('Again', 'parks')]);
    // The row that brought "parks" keeps it; the others are numbered.
    expect(keys(out)).toEqual(['parks-2', 'parks-3', 'parks', 'again']);
    expect(new Set(keys(out)).size).toBe(4);
  });

  it('never gives a row the key a whole-dimension gap records', () => {
    expect(keys(assignIndicatorKeys([row('All'), row('Kept', WHOLE_DIMENSION_GAP)]))).toEqual(['all-2', 'kept']);
  });

  it('replaces a key that is not of the right shape', () => {
    expect(keys(assignIndicatorKeys([row('Rent', 'Has Spaces/and slash')]))).toEqual(['rent']);
  });

  it('keeps order and every other field', () => {
    const a = { ...row('A'), supporting_source_url: 'https://x.example.gov' };
    const out = assignIndicatorKeys([a, row('B')]);
    expect(out[0]).toEqual({ ...a, key: 'a' });
    expect(out.map((r) => r.name)).toEqual(['A', 'B']);
  });
});

describe('deriveIndicatorKey', () => {
  it('reads as a key, accents dropped', () => {
    expect(deriveIndicatorKey('Población sin seguro médico')).toBe('poblacion-sin-seguro-medico');
    expect(deriveIndicatorKey('  CO₂ — per resident ')).toMatch(INDICATOR_KEY_PATTERN);
  });

  it('gives a name with no letters or digits a key all the same', () => {
    expect(deriveIndicatorKey('—')).toBe('indicator');
    expect(deriveIndicatorKey('')).toBe('indicator');
  });

  it('stays short for a very long name', () => {
    const key = deriveIndicatorKey('Share of households '.repeat(20));
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toMatch(INDICATOR_KEY_PATTERN);
  });
});

describe('frameworkIndicatorKeys', () => {
  it('lists a framework dimension’s indicators by slug, and none for a custom dimension', () => {
    expect(frameworkIndicatorKeys('housing').map((k) => k.key)).toEqual(['cost-burdened-renters', 'homelessness-rate']);
    expect(frameworkIndicatorKeys('my-own-dimension')).toEqual([]);
  });
});

describe('indicatorSchema key', () => {
  it('accepts a row without a key, and a key of the right shape', () => {
    expect(indicatorSchema.parse(row('Rent')).key).toBeUndefined();
    expect(indicatorSchema.parse(row('Rent', 'rent-burden')).key).toBe('rent-burden');
  });

  it('refuses a key that could not name a row', () => {
    expect(indicatorSchema.safeParse(row('Rent', 'housing/rent')).success).toBe(false);
    expect(indicatorSchema.safeParse(row('Rent', '')).success).toBe(false);
  });
});
