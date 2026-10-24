import { describe, expect, it, vi } from 'vitest';
import { loadArchivedExhibits, loadFindingExhibits } from './archived-exhibits.js';
import type { IndicatorFindingPayload } from '@deep-fryer/core';
import type { TenantStorage } from './storage.js';

const evidence = { snapshot_path: 'evidence/capture.png', pdf_path: 'evidence/capture.pdf', captured_at: '2026-10-23T12:00:00Z' };
const store = (get: TenantStorage['get']): TenantStorage => ({ get, put: vi.fn(), describe: () => 'test' });

describe('archived verifier exhibits', () => {
  it('loads the actual captured bytes under fixed workspace filenames, PDF first', async () => {
    const get = vi.fn(async (key: string) => Buffer.from(key));
    const loaded = await loadArchivedExhibits(store(get), evidence);
    expect(loaded.names).toEqual(['archived-source.pdf', 'archived-snapshot.png']);
    expect(loaded.exhibits.pdf).toEqual(Buffer.from(evidence.pdf_path));
    expect(loaded.exhibits.snapshot).toEqual(Buffer.from(evidence.snapshot_path));
    expect(loaded.note).toBe('');
  });

  it('retains a screenshot when a large PDF is omitted, explicitly explaining the limit', async () => {
    const loaded = await loadArchivedExhibits(store(async (key) => {
      if (key.endsWith('.pdf')) throw new Error('archived exhibit exceeds 33554432 bytes');
      return Buffer.from('snapshot');
    }), evidence);
    expect(loaded.names).toEqual(['archived-snapshot.png']);
    expect(loaded.exhibits.pdf).toBeUndefined();
    expect(loaded.note).toContain('pdf was not loaded: it exceeds the 32 MiB');
  });

  it('never passes URLs, traversal, or a neighboring tenant prefix to storage', async () => {
    for (const snapshot_path of ['https://source.example/a.png', '../other/evidence/a.png', 'tenant-other/evidence/a.png', '/etc/passwd', 'evidence/a.pdf']) {
      const get = vi.fn();
      const loaded = await loadArchivedExhibits(store(get), { snapshot_path, captured_at: evidence.captured_at });
      expect(get).not.toHaveBeenCalled();
      expect(loaded.names).toEqual([]);
      expect(loaded.note).toContain('invalid evidence path');
    }
  });

  it('explains unavailable archives without exposing storage credentials in the prompt', async () => {
    const loaded = await loadArchivedExhibits(store(async () => { throw new Error('S3 secret credential detail'); }), evidence);
    expect(loaded.names).toEqual([]);
    expect(loaded.note).toContain('snapshot was not loaded');
    expect(loaded.note).toContain('pdf was not loaded');
    expect(loaded.note).not.toContain('secret');
  });

  it('loads action captures under generated names and identifies each omitted action exhibit', async () => {
    const payload = { evidence, narrative_draft: { context: 'Supported context', actions: [
      { text: 'Join a hearing', source_url: 'https://city.example/hearings', evidence: { ...evidence, snapshot_path: 'evidence/action.png', pdf_path: undefined } },
      { text: 'Enroll', source_url: 'https://city.example/enroll', evidence: { ...evidence, snapshot_path: 'evidence/missing.png', pdf_path: undefined } },
    ] } } as IndicatorFindingPayload;
    const result = await loadFindingExhibits(store(async (key) => {
      if (key.includes('missing')) throw new Error('missing');
      return Buffer.from(key);
    }), payload);
    expect(result.names).toEqual(['archived-source.pdf', 'archived-snapshot.png', 'action-1-snapshot.png']);
    expect(result.exhibits.additional).toEqual([{ filename: 'action-1-snapshot.png', body: Buffer.from('evidence/action.png') }]);
    expect(result.note).toContain('Action 2: The archived snapshot was not loaded');
  });
});
