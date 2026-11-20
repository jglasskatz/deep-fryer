import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evidencePublicBase, tenantBucketName } from '@deep-fryer/core';
import { tenantStorage } from './storage.js';

const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mock.send; },
  GetObjectCommand: class { constructor(public input: Record<string, unknown>) {} },
  PutObjectCommand: class { constructor(public input: Record<string, unknown>) {} },
  HeadObjectCommand: class { constructor(public input: Record<string, unknown>) {} },
}));

beforeEach(() => {
  mock.send.mockReset();
  vi.stubEnv('S3_BUCKET', 'test-evidence');
  vi.stubEnv('S3_PRIVATE_BUCKET', '');
  vi.stubEnv('S3_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret');
});
afterEach(() => vi.unstubAllEnvs());

/** The requests the store received, by command, in order. */
function sent(): { command: string; input: Record<string, unknown> }[] {
  return mock.send.mock.calls.map(([command]) => ({ command: command.constructor.name, input: command.input }));
}

/** A store that has no such object until it is written. */
function emptyBucket() {
  mock.send.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === 'HeadObjectCommand') throw Object.assign(new Error('NotFound'), { name: 'NotFound' });
    return {};
  });
}

describe('a group’s own files in S3', () => {
  it('writes supplied/ and material/ keys only to the private bucket, under the same tenant prefix', async () => {
    vi.stubEnv('S3_PRIVATE_BUCKET', 'test-private');
    emptyBucket();
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    await storage.put('supplied/report.pdf', Buffer.from('%PDF'), 'application/pdf');
    await storage.put('material/0123abcd.txt', Buffer.from('text'), 'text/plain');
    await storage.put('evidence/snapshot.png', Buffer.from('png'), 'image/png');
    const puts = sent().filter((s) => s.command === 'PutObjectCommand').map((s) => s.input);
    expect(puts.map(({ Bucket, Key, CacheControl }) => ({ Bucket, Key, CacheControl }))).toEqual([
      { Bucket: 'test-private', Key: 'tenant-civic-town/supplied/report.pdf', CacheControl: 'private, no-store' },
      { Bucket: 'test-private', Key: 'tenant-civic-town/material/0123abcd.txt', CacheControl: 'private, no-store' },
      { Bucket: 'test-evidence', Key: 'tenant-civic-town/evidence/snapshot.png', CacheControl: 'public, max-age=31536000, immutable' },
    ]);
    // Every request about a private key went to the private bucket, the existence check included.
    for (const { input } of sent()) {
      expect(input.Bucket === 'test-private').toBe(/\/(supplied|material)\//.test(String(input.Key)));
    }
  });

  it('reads private keys from the private bucket', async () => {
    vi.stubEnv('S3_PRIVATE_BUCKET', 'test-private');
    const body = Object.assign((async function* () { yield Buffer.from('%PDF'); })(), { destroy: vi.fn() });
    mock.send.mockResolvedValue({ Body: body, ContentLength: 4 });
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    expect(await storage.get('supplied/report.pdf')).toEqual(Buffer.from('%PDF'));
    expect(sent()).toEqual([{ command: 'GetObjectCommand', input: { Bucket: 'test-private', Key: 'tenant-civic-town/supplied/report.pdf' } }]);
  });

  it('leaves the public /files/ and S3_PUBLIC_URL path empty: both name the public bucket, which never receives the file', async () => {
    vi.stubEnv('S3_PRIVATE_BUCKET', 'test-private');
    emptyBucket();
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    await storage.put('supplied/report.pdf', Buffer.from('%PDF'), 'application/pdf');
    // The proxy maps /files/<key> to /<S3_BUCKET>/<key>; the public URL is the same key under it.
    const publicUrl = `${evidencePublicBase('civic-town', 'https://app.example.gov/files')}/supplied/report.pdf`;
    expect(publicUrl).toBe(`https://app.example.gov/files/${tenantBucketName('civic-town')}/supplied/report.pdf`);
    expect(sent().some((s) => s.input.Bucket === 'test-evidence')).toBe(false);
  });

  it.each([
    ['unset', '', 'S3_PRIVATE_BUCKET is not set'],
    ['the public bucket', 'test-evidence', 'must be a different bucket'],
  ])('refuses private keys without a request when the private bucket is %s', async (_label, value, message) => {
    vi.stubEnv('S3_PRIVATE_BUCKET', value);
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    await expect(storage.put('supplied/report.pdf', Buffer.from('%PDF'), 'application/pdf')).rejects.toThrow(message);
    await expect(storage.get('material/0123abcd.txt')).rejects.toThrow(message);
    expect(mock.send).not.toHaveBeenCalled();
  });
});

describe('tenant-scoped S3 archive reads', () => {
  it('reads a fixed bucket/prefix and closes the stream', async () => {
    const destroy = vi.fn();
    const body = Object.assign((async function* () { yield Buffer.from('png'); })(), { destroy });
    mock.send.mockResolvedValue({ Body: body, ContentLength: 3 });
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    expect(await storage.get('evidence/snapshot.png')).toEqual(Buffer.from('png'));
    expect(mock.send.mock.calls[0]![0].input).toEqual({ Bucket: 'test-evidence', Key: 'tenant-civic-town/evidence/snapshot.png' });
    expect(mock.send.mock.calls[0]![1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects declared oversized objects before reading any bytes', async () => {
    const read = vi.fn();
    const destroy = vi.fn();
    const body = Object.assign((async function* () { read(); yield Buffer.from('bytes'); })(), { destroy });
    mock.send.mockResolvedValue({ Body: body, ContentLength: 100 });
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    await expect(storage.get('evidence/report.pdf', 4)).rejects.toThrow('exceeds 4 bytes');
    expect(read).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('enforces the streaming byte limit when the server omits the object size', async () => {
    const destroy = vi.fn();
    const body = Object.assign((async function* () { yield Buffer.from('123'); yield Buffer.from('456'); })(), { destroy });
    mock.send.mockResolvedValue({ Body: body });
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    await expect(storage.get('evidence/report.pdf', 4)).rejects.toThrow('exceeds 4 bytes');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('never makes a request for a path outside the tenant namespace', async () => {
    const storage = await tenantStorage('civic-town', { localFallbackDir: '/unused' });
    for (const key of ['../tenant-other/evidence/report.pdf', 'https://other.example/report.pdf', '/etc/passwd']) {
      await expect(storage.get(key)).rejects.toThrow('invalid tenant-relative');
    }
    expect(mock.send).not.toHaveBeenCalled();
  });
});
