import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tenantStorage } from '@deep-fryer/research';

const mocks = vi.hoisted(() => ({ tenant: vi.fn(), role: vi.fn() }));
vi.mock('@deep-fryer/db', () => ({ tenantBySlug: mocks.tenant }));
vi.mock('@/lib/db', () => ({ systemDb: () => ({}) }));
vi.mock('@/lib/auth', () => ({ getRole: mocks.role, roleAtLeast: (role: string | null) => role !== null }));

const TENANTS: Record<string, { id: string; slug: string }> = {
  'civic-town': { id: 'tenant-civic', slug: 'civic-town' },
  'other-town': { id: 'tenant-other', slug: 'other-town' },
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Title (County health report) >> endobj\n%%EOF\n');

let privateRoot: string;
let publicRoot: string;

beforeEach(async () => {
  privateRoot = await mkdtemp(path.join(tmpdir(), 'df-supplied-private-'));
  publicRoot = await mkdtemp(path.join(tmpdir(), 'df-supplied-public-'));
  vi.stubEnv('S3_BUCKET', '');
  vi.stubEnv('LOCAL_PRIVATE_DIR', privateRoot);
  vi.stubEnv('LOCAL_EVIDENCE_DIR', publicRoot);
  mocks.tenant.mockReset().mockImplementation(async (_db: unknown, slug: string) => TENANTS[slug] ?? null);
  mocks.role.mockReset();
  const storage = await tenantStorage('civic-town', { localFallbackDir: publicRoot });
  await storage.put('supplied/county-report.pdf', PDF, 'application/pdf');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(privateRoot, { recursive: true, force: true });
  await rm(publicRoot, { recursive: true, force: true });
});

async function fetchFile(tenant: string, key: string) {
  const { GET } = await import('./route');
  return GET(new Request(`https://app.example.gov/api/supplied/${tenant}/${key}`), {
    params: Promise.resolve({ tenant, path: key.split('/') }),
  });
}

describe('a group’s own files, through the members-only route', () => {
  it('gives a member the uploaded PDF as a private download', async () => {
    mocks.role.mockImplementation(async (id: string) => (id === 'tenant-civic' ? 'viewer' : null));
    const response = await fetchFile('civic-town', 'supplied/county-report.pdf');
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="county-report.pdf"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    // Written to the private store, not where public evidence is served from.
    expect(existsSync(path.join(publicRoot, 'supplied', 'county-report.pdf'))).toBe(false);
  });

  it('answers 404 to someone signed out, and to a member of another portrait', async () => {
    mocks.role.mockResolvedValue(null);
    const outsider = await fetchFile('civic-town', 'supplied/county-report.pdf');
    expect(outsider.status).toBe(404);
    expect(await outsider.text()).toBe('Not found');
    expect(outsider.headers.get('cache-control')).toBe('private, no-store');

    // A member of other-town asking for civic-town's file, or for it under their own portrait.
    mocks.role.mockImplementation(async (id: string) => (id === 'tenant-other' ? 'owner' : null));
    expect((await fetchFile('civic-town', 'supplied/county-report.pdf')).status).toBe(404);
    expect((await fetchFile('other-town', 'supplied/county-report.pdf')).status).toBe(404);
  });

  it('answers 404, before looking anyone up, for paths outside the private prefixes', async () => {
    mocks.role.mockResolvedValue('owner');
    for (const key of ['evidence/snapshot.png', 'supplied/../evidence/a.png', 'supplied/./county-report.pdf', 'supplied']) {
      expect((await fetchFile('civic-town', key)).status).toBe(404);
    }
    expect((await fetchFile('Not A Slug', 'supplied/county-report.pdf')).status).toBe(404);
    expect(mocks.tenant).not.toHaveBeenCalled();
    expect(mocks.role).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown portrait or a file that is not there', async () => {
    mocks.role.mockResolvedValue('owner');
    expect((await fetchFile('no-such-town', 'supplied/county-report.pdf')).status).toBe(404);
    expect((await fetchFile('civic-town', 'supplied/absent.pdf')).status).toBe(404);
  });
});
