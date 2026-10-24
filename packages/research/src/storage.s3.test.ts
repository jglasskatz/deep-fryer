import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.stubEnv('S3_ACCESS_KEY_ID', 'test-key');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret');
});
afterEach(() => vi.unstubAllEnvs());

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
