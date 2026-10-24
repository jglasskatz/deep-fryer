import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertStoragePath, tenantStorage } from './storage.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function archive() {
  vi.stubEnv('S3_BUCKET', '');
  vi.stubEnv('LOCAL_EVIDENCE_DIR', '');
  // Undefined chooses the fallback; an empty override is itself a path.
  delete process.env.LOCAL_EVIDENCE_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), 'df-archive-'));
  dirs.push(dir);
  return { dir, storage: await tenantStorage('test-city', { localFallbackDir: dir }) };
}

describe('tenant evidence archive reads', () => {
  it('reads an immutable object and refuses overwritten provenance', async () => {
    const { storage } = await archive();
    await storage.put('evidence/a.png', Buffer.from('snapshot'), 'image/png');
    expect(await storage.get('evidence/a.png')).toEqual(Buffer.from('snapshot'));
    await expect(storage.put('evidence/a.png', Buffer.from('replaced'), 'image/png')).rejects.toThrow();
  });

  it.each(['../secrets', 'evidence/../../secret', '/etc/passwd', 'https://example.gov/a.pdf', 'evidence/../a.png', 'evidence/./a.png', 'evidence\\a.png', 'evidence/a\0.png'])('refuses model-supplied path %j', (value) => {
    expect(() => assertStoragePath(value)).toThrow('invalid tenant-relative');
  });

  it('refuses symlink escapes into another archive or the worker filesystem', async () => {
    const { dir, storage } = await archive();
    const outside = await mkdtemp(path.join(tmpdir(), 'df-outside-'));
    dirs.push(outside);
    await mkdir(path.join(dir, 'evidence'));
    await writeFile(path.join(outside, 'secret.png'), 'secret');
    await symlink(path.join(outside, 'secret.png'), path.join(dir, 'evidence', 'bad.png'));
    await expect(storage.get('evidence/bad.png')).rejects.toThrow('outside the tenant archive');
    await symlink(outside, path.join(dir, 'linked'));
    await expect(storage.get('linked/secret.png')).rejects.toThrow('outside the tenant archive');
  });

  it('bounds reads before allocating the object and refuses nonexistent objects', async () => {
    const { storage } = await archive();
    await storage.put('evidence/a.pdf', Buffer.from('123456'), 'application/pdf');
    await expect(storage.get('evidence/a.pdf', 5)).rejects.toThrow('exceeds 5 bytes');
    await expect(storage.get('evidence/a.pdf', 0)).rejects.toThrow('invalid archived exhibit byte limit');
    await expect(storage.get('evidence/absent.pdf')).rejects.toThrow();
  });
});
