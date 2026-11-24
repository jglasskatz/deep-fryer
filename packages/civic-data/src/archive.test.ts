import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertStoragePath, type TenantStorage } from '@deep-fryer/research';
import { archiveCivicDataResult, formatCivicDataExhibit } from './archive.js';
import type { CivicDataResult } from './types.js';

function createMemoryStorage() {
  const files = new Map<string, { body: Buffer; contentType: string }>();
  const storage: Pick<TenantStorage, 'put'> = {
    async put(storagePath: string, body: Buffer, contentType: string): Promise<string> {
      assertStoragePath(storagePath);
      if (files.has(storagePath)) {
        const err = new Error(`evidence object already exists: ${storagePath}`) as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      files.set(storagePath, { body, contentType });
      return storagePath;
    },
  };
  return { storage, files };
}

describe('archiveCivicDataResult', () => {
  const sampleResult: CivicDataResult = {
    connector: 'census_acs',
    title: 'US Census ACS 5-Year Estimates (2023)',
    source_name: 'U.S. Census Bureau, 2023 American Community Survey (ACS5)',
    source_url: 'https://api.census.gov/data/2023/acs/acs5?get=NAME,B17001_002E&for=place:69084&in=state:06',
    retrieved_at: '2026-11-23T20:15:00.000Z',
    query_params: {
      year: 2023,
      dataset: 'acs5',
      variables: ['B17001_002E'],
      geography: { place: '69084', state: '06' },
    },
    columns: ['name', 'state', 'place', 'B17001_002E'],
    rows: [
      {
        name: 'Santa Cruz city, California',
        geography: { state: '06', place: '69084' },
        values: { B17001_002E: 11840 },
        margins_of_error: {},
        missing_sentinels: {},
      },
    ],
    row_count: 1,
    citation: {
      agency: 'U.S. Census Bureau',
      dataset: 'American Community Survey 5-Year (detail)',
      year: 2023,
      source_tier_hint: 1,
      canonical_url:
        'https://api.census.gov/data/2023/acs/acs5?get=NAME,B17001_002E&for=place:69084&in=state:06',
    },
  };

  it('archives deterministic content-addressed text exhibits under evidence/<sha256>.txt', async () => {
    const { storage, files } = createMemoryStorage();
    const archived = await archiveCivicDataResult(storage, sampleResult);

    expect(archived.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(archived.text_path).toBe(`evidence/${archived.sha256}.txt`);
    expect(archived.source_url).toBe(sampleResult.source_url);
    expect(archived.retrieved_at).toBe(sampleResult.retrieved_at);
    expect(archived.row_count).toBe(1);
    expect(archived.summary_preview).toContain('Santa Cruz city, California');
    expect(archived.summary_preview).toContain('11840');

    const stored = files.get(archived.text_path)!;
    expect(stored).toBeDefined();
    expect(stored.contentType).toBe('text/plain; charset=utf-8');

    const recomputedHash = createHash('sha256').update(stored.body).digest('hex');
    expect(recomputedHash).toBe(archived.sha256);

    const text = stored.body.toString('utf8');
    expect(text).toContain('--- SUMMARY TABLE ---');
    expect(text).toContain('--- CANONICAL JSON ---');
    expect(text).toContain('Provenance URL: https://api.census.gov/data/2023/acs/acs5');
  });

  it('produces identical SHA-256 hashes regardless of object key insertion order and handles idempotent replays', async () => {
    const reordered: CivicDataResult = {
      ...sampleResult,
      query_params: {
        geography: { state: '06', place: '69084' },
        variables: ['B17001_002E'],
        dataset: 'acs5',
        year: 2023,
      },
    };

    const a = formatCivicDataExhibit(sampleResult);
    const b = formatCivicDataExhibit(reordered);
    expect(a.fullText).toBe(b.fullText);

    const { storage } = createMemoryStorage();
    const first = await archiveCivicDataResult(storage, sampleResult);
    const second = await archiveCivicDataResult(storage, reordered);
    expect(second.sha256).toBe(first.sha256);
    expect(second.text_path).toBe(first.text_path);
  });

  it('rethrows non-EEXIST storage failures', async () => {
    const brokenStorage: Pick<TenantStorage, 'put'> = {
      async put() {
        throw new Error('disk full');
      },
    };
    await expect(archiveCivicDataResult(brokenStorage, sampleResult)).rejects.toThrow('disk full');
  });
});
