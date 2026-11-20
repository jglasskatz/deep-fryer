import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidencePublicBase, isPrivateStoragePath } from '@deep-fryer/core';
import { assertStoragePath, isMissingObject, localPrivateDir, tenantStorage } from './storage.js';

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function localOnly() {
  vi.stubEnv('S3_BUCKET', '');
  vi.stubEnv('LOCAL_EVIDENCE_DIR', '');
  vi.stubEnv('LOCAL_PRIVATE_DIR', '');
  // Undefined chooses the fallback; an empty override is itself a path.
  delete process.env.LOCAL_EVIDENCE_DIR;
}

async function tempDir(name: string) {
  const dir = await mkdtemp(path.join(tmpdir(), `df-${name}-`));
  dirs.push(dir);
  return dir;
}

async function archive() {
  localOnly();
  const dir = await tempDir('archive');
  return { dir, storage: await tenantStorage('test-city', { localFallbackDir: dir }) };
}

/** Every file below `dir`, relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name))).sort();
}

/** The worker's and web app's layout under a stand-in repository root. */
async function repoLayout(slug = 'test-city') {
  localOnly();
  const root = await tempDir('repo');
  const publicDir = path.join(root, 'apps', 'web', 'public');
  const opts = {
    localFallbackDir: path.join(publicDir, 'evidence', slug),
    localPrivateDir: localPrivateDir(root, slug),
  };
  return { root, publicDir, opts, storage: await tenantStorage(slug, opts) };
}

describe('a group’s own files without S3', () => {
  it('writes supplied/ and material/ keys outside apps/web/public, so /evidence/<slug>/… has nothing to serve', async () => {
    const { root, publicDir, opts, storage } = await repoLayout();
    const pdf = Buffer.from('%PDF-1.7 county health report');
    await storage.put('supplied/report.pdf', pdf, 'application/pdf');
    await storage.put('material/0123abcd.txt', Buffer.from('text read from the report'), 'text/plain');
    await storage.put('evidence/snap.png', Buffer.from('png'), 'image/png');

    // Only the public evidence lands where the web app serves static files.
    expect(await filesUnder(publicDir)).toEqual([path.join('evidence', 'test-city', 'evidence', 'snap.png')]);
    // The /evidence/<slug>/supplied/… URL maps onto that public directory, which holds nothing there.
    expect(`${evidencePublicBase('test-city')}/supplied/report.pdf`).toBe('/evidence/test-city/supplied/report.pdf');
    expect(existsSync(path.join(opts.localFallbackDir, 'supplied', 'report.pdf'))).toBe(false);

    const privateDir = opts.localPrivateDir;
    expect(path.relative(path.join(root, 'apps', 'web'), privateDir).startsWith('..')).toBe(true);
    expect(await readFile(path.join(privateDir, 'supplied', 'report.pdf'))).toEqual(pdf);
    expect(await storage.get('supplied/report.pdf')).toEqual(pdf);
    expect(await storage.get('material/0123abcd.txt')).toEqual(Buffer.from('text read from the report'));
    // A self-ignoring marker keeps the default directory out of commits.
    expect(await readFile(path.join(privateDir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('never overwrites a private object and reports a missing one as missing', async () => {
    const { storage } = await repoLayout();
    await storage.put('supplied/a.pdf', Buffer.from('first'), 'application/pdf');
    await expect(storage.put('supplied/a.pdf', Buffer.from('second'), 'application/pdf')).rejects.toThrow();
    expect(await storage.get('supplied/a.pdf')).toEqual(Buffer.from('first'));
    const missing = await storage.get('supplied/absent.pdf').catch((e: unknown) => e);
    expect(isMissingObject(missing)).toBe(true);
  });

  it('refuses private keys, writing nothing, when no private directory is given', async () => {
    const { dir, storage } = await archive();
    await expect(storage.put('supplied/report.pdf', Buffer.from('pdf'), 'application/pdf')).rejects.toThrow('private uploads are not stored');
    await expect(storage.get('supplied/report.pdf')).rejects.toThrow('private uploads are not stored');
    expect(await filesUnder(dir)).toEqual([]);
  });

  it.each([
    ['inside the public evidence directory', (pub: string) => path.join(pub, 'private')],
    ['under any public/ directory', (pub: string) => path.join(path.dirname(pub), 'public', 'private')],
  ])('refuses a private directory %s', async (_label, place) => {
    localOnly();
    const pub = path.join(await tempDir('pub'), 'evidence');
    const storage = await tenantStorage('test-city', { localFallbackDir: pub, localPrivateDir: place(pub) });
    await expect(storage.put('supplied/report.pdf', Buffer.from('pdf'), 'application/pdf')).rejects.toThrow('must not be inside a public directory');
    expect(await filesUnder(path.dirname(pub))).toEqual([]);
  });

  it('keeps each tenant in its own directory under LOCAL_PRIVATE_DIR', async () => {
    localOnly();
    const root = await tempDir('private-root');
    vi.stubEnv('LOCAL_PRIVATE_DIR', root);
    const pub = await tempDir('pub');
    const a = await tenantStorage('town-a', { localFallbackDir: path.join(pub, 'a') });
    const b = await tenantStorage('town-b', { localFallbackDir: path.join(pub, 'b') });
    await a.put('supplied/report.pdf', Buffer.from('a'), 'application/pdf');
    await expect(b.get('supplied/report.pdf')).rejects.toThrow();
    expect(await filesUnder(root)).toEqual([path.join('town-a', 'supplied', 'report.pdf')]);
    expect(await filesUnder(pub)).toEqual([]);
  });

  it('names exactly the private prefixes', () => {
    expect(isPrivateStoragePath('supplied/report.pdf')).toBe(true);
    expect(isPrivateStoragePath('material/abc.txt')).toBe(true);
    expect(isPrivateStoragePath('evidence/supplied/report.pdf')).toBe(false);
    expect(isPrivateStoragePath('suppliedx/report.pdf')).toBe(false);
  });
});

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
