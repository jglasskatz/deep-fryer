import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { isPrivateStoragePath, tenantBucketName } from '@deep-fryer/core';

export interface TenantStorage {
  /**
   * Store bytes at a tenant-relative path; returns the stored path. Never
   * overwrites: evidence is an audit record (SPEC-v3 §2.3), so writing to an
   * existing path is an error, not an update. Paths under core's private
   * prefixes go to the private store, everything else to the public one.
   */
  put(storagePath: string, body: Buffer, contentType: string): Promise<string>;
  /** Read only an object in this tenant's archive, with a bounded byte budget. */
  get(storagePath: string, maxBytes?: number): Promise<Buffer>;
  describe(): string;
}

export const MAX_ARCHIVED_EXHIBIT_BYTES = 32 * 1024 * 1024;

/** Model-produced paths never become filesystem traversal or cross-tenant S3 keys. */
export function assertStoragePath(storagePath: string): void {
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(storagePath) ||
      storagePath.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('invalid tenant-relative evidence path');
  }
}

function byteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_ARCHIVED_EXHIBIT_BYTES) {
    throw new Error('invalid archived exhibit byte limit');
  }
}

/**
 * Whether a read failed because the object is not there (as opposed to the
 * store being unreachable or the object being refused), on either backend.
 */
export function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.code === 'ENOENT' || e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

/**
 * S3-compatible object storage settings (SPEC-v3 §2.1: SeaweedFS on the
 * droplet, DigitalOcean Spaces, or AWS S3). One bucket, one prefix per
 * tenant (`tenant-<slug>/`) — the S3 form of v2's bucket-per-tenant.
 */
export interface S3Settings {
  bucket: string;
  /**
   * A second bucket, with no anonymous or public access, for the objects
   * under core's private prefixes (same tenant prefixes inside it). Unset,
   * those objects are refused rather than written to the public bucket.
   */
  privateBucket?: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Self-hosted stores need path-style addressing; Spaces and AWS use virtual hosts. */
  forcePathStyle: boolean;
}

export function s3SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): S3Settings | null {
  const { S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return {
    bucket: S3_BUCKET,
    privateBucket: env.S3_PRIVATE_BUCKET || undefined,
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

/**
 * The default local directory for one tenant's private objects when no S3
 * store is configured: `.private-uploads/<slug>` at the repository root,
 * outside the web app and so outside anything it serves as static files.
 * Callers pass the repository root they run under.
 */
export function localPrivateDir(repoRoot: string, tenantSlug: string): string {
  return path.join(repoRoot, '.private-uploads', tenantSlug);
}

interface ObjectStore {
  get(storagePath: string, maxBytes: number): Promise<Buffer>;
  put(storagePath: string, body: Buffer, contentType: string): Promise<void>;
}

/** Whether `child` is `parent` itself or somewhere beneath it. */
function within(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function refusePrivate(reason: string): ObjectStore {
  const fail = async (): Promise<never> => {
    throw new Error(`private uploads are not stored: ${reason}`);
  };
  return { get: fail, put: fail };
}

function localStore(baseDir: string, opts: { ignoredByGit: boolean }): ObjectStore {
  return {
    async get(storagePath, maxBytes) {
      // Resolve symlinks as well as '..': a valid relative path must still
      // refer to this tenant's archive, never another tenant or a worker secret.
      const base = await realpath(baseDir);
      const full = path.resolve(base, storagePath);
      const actual = await realpath(full);
      if (!actual.startsWith(base + path.sep)) throw new Error('archived exhibit is outside the tenant archive');
      const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile()) throw new Error('archived exhibit is not a regular file');
        if (stat.size > maxBytes) throw new Error(`archived exhibit exceeds ${maxBytes} bytes`);
        // Read at most the budget plus one byte, even if the file grows after stat.
        const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > maxBytes) throw new Error(`archived exhibit exceeds ${maxBytes} bytes`);
        return buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    },
    async put(storagePath, body) {
      const full = path.join(baseDir, storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      if (opts.ignoredByGit) {
        // The default private directory sits inside a working copy; a
        // self-ignoring marker keeps a group's files out of any commit.
        await writeFile(path.join(baseDir, '.gitignore'), '*\n', { flag: 'wx' }).catch((error: unknown) => {
          if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
        });
      }
      await writeFile(full, body, { flag: 'wx' });
    },
  };
}

/**
 * Evidence storage for one tenant: S3-compatible when configured, otherwise
 * local disk under `localFallbackDir` (dev serves it from the web app's
 * public/). The web app reads the same layout through core's
 * evidencePublicBase.
 *
 * Objects under core's private prefixes never share that public layout:
 * with S3 they go to `S3_PRIVATE_BUCKET`, locally to `LOCAL_PRIVATE_DIR/<slug>`
 * or else `localPrivateDir`, which must not sit inside the public directory
 * or under any `public/` directory. With no private store, reading or
 * writing such a path throws; it never falls back to the public store.
 */
export async function tenantStorage(
  tenantSlug: string,
  opts: { localFallbackDir: string; localPrivateDir?: string },
): Promise<TenantStorage> {
  const s3 = s3SettingsFromEnv();
  let describe: () => string;
  let publicStore: ObjectStore;
  let privateStore: ObjectStore;

  if (s3) {
    const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    const prefix = tenantBucketName(tenantSlug);
    const s3Store = (bucket: string, cacheControl: string): ObjectStore => ({
      async get(storagePath, maxBytes) {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/${storagePath}` }), {
          abortSignal: AbortSignal.timeout(30_000),
        });
        if (!response.Body) throw new Error('archived exhibit has no body');
        const body = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
        try {
          if ((response.ContentLength ?? 0) > maxBytes) throw new Error(`archived exhibit exceeds ${maxBytes} bytes`);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of body) {
            size += chunk.byteLength;
            if (size > maxBytes) throw new Error(`archived exhibit exceeds ${maxBytes} bytes`);
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks, size);
        } finally {
          body.destroy?.();
        }
      },
      async put(storagePath, body, contentType) {
        const Key = `${prefix}/${storagePath}`;
        // Keys embed the capture timestamp, so a collision means a bug or a
        // replay; refuse rather than overwrite the audit record.
        const exists = await client
          .send(new HeadObjectCommand({ Bucket: bucket, Key }))
          .then(() => true)
          .catch(() => false);
        if (exists) throw new Error(`evidence object already exists: ${Key}`);
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
        );
      },
    });
    publicStore = s3Store(s3.bucket, 'public, max-age=31536000, immutable');
    privateStore = !s3.privateBucket
      ? refusePrivate('S3_PRIVATE_BUCKET is not set')
      : s3.privateBucket === s3.bucket
        ? refusePrivate('S3_PRIVATE_BUCKET must be a different bucket from S3_BUCKET')
        : s3Store(s3.privateBucket, 'private, no-store');
    describe = () => `s3:${s3.bucket}/${prefix}${s3.privateBucket ? ` (private: ${s3.privateBucket}/${prefix})` : ''}`;
  } else {
    const baseDir = process.env.LOCAL_EVIDENCE_DIR ?? opts.localFallbackDir;
    const override = process.env.LOCAL_PRIVATE_DIR;
    const privateDir = override ? path.join(override, tenantSlug) : opts.localPrivateDir;
    publicStore = localStore(baseDir, { ignoredByGit: false });
    if (!privateDir) {
      privateStore = refusePrivate('no private directory is configured');
    } else if (within(baseDir, privateDir) || path.resolve(privateDir).split(path.sep).includes('public')) {
      privateStore = refusePrivate('the private directory must not be inside a public directory');
    } else {
      privateStore = localStore(privateDir, { ignoredByGit: !override });
    }
    describe = () => `local:${baseDir}${privateDir ? ` (private: ${privateDir})` : ''}`;
  }

  const storeFor = (storagePath: string) => (isPrivateStoragePath(storagePath) ? privateStore : publicStore);
  return {
    describe,
    async get(storagePath, maxBytes = MAX_ARCHIVED_EXHIBIT_BYTES) {
      assertStoragePath(storagePath);
      byteLimit(maxBytes);
      return storeFor(storagePath).get(storagePath, maxBytes);
    },
    async put(storagePath, body, contentType) {
      assertStoragePath(storagePath);
      await storeFor(storagePath).put(storagePath, body, contentType);
      return storagePath;
    },
  };
}
