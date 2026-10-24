import { describe, expect, it, vi } from 'vitest';
vi.mock('./env', () => ({ appUrl: () => 'https://portraits.example.org', hasDatabase: () => false }));
vi.mock('./features', () => ({ deploymentDisabled: () => new Set() }));
vi.mock('./data', () => ({ evidenceUrl: (slug: string, path: string) => `/evidence/${slug}/${path}` }));
import { absoluteEvidenceUrl } from './public-api-metadata';

describe('public evidence URLs', () => {
  it('returns absolute URLs for storage keys while refusing escape/URL syntax', () => {
    expect(absoluteEvidenceUrl('carmel', 'evidence/abc.png')).toBe('https://portraits.example.org/evidence/carmel/evidence/abc.png');
    for (const path of [undefined, '', '/etc/passwd', '../secret', 'evidence/../secret', 'evidence/%2e%2e/secret', 'evidence/x%2fy', 'evidence/x%5cy', 'https://example.org/x', 'evidence/x?token=foo', 'evidence/%']) {
      expect(absoluteEvidenceUrl('carmel', path)).toBeNull();
    }
  });
});
