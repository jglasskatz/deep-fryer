import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tenantBucketName } from '@deep-fryer/core';

export interface TenantStorage {
  /**
   * Store bytes at a tenant-relative path; returns the stored path. Never
   * overwrites: evidence is an audit record (SPEC-v3 §2.3), so writing to an
   * existing path is an error, not an update.
   */
  put(storagePath: string, body: Buffer, contentType: string): Promise<string>;
  describe(): string;
}

/**
 * S3-compatible object storage settings (SPEC-v3 §2.1: SeaweedFS on the
 * droplet, DigitalOcean Spaces, or AWS S3). One bucket, one prefix per
 * tenant (`tenant-<slug>/`) — the S3 form of v2's bucket-per-tenant.
 */
export interface S3Settings {
  bucket: string;
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
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

/**
 * Evidence storage for one tenant: S3-compatible when configured, otherwise
 * local disk under `localFallbackDir` (dev serves it from the web app's
 * public/). The web app reads the same layout through core's
 * evidencePublicBase.
 */
export async function tenantStorage(
  tenantSlug: string,
  opts: { localFallbackDir: string },
): Promise<TenantStorage> {
  const s3 = s3SettingsFromEnv();
  if (s3) {
    const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    const prefix = tenantBucketName(tenantSlug);
    return {
      describe: () => `s3:${s3.bucket}/${prefix}`,
      async put(storagePath, body, contentType) {
        const Key = `${prefix}/${storagePath}`;
        // Keys embed the capture timestamp, so a collision means a bug or a
        // replay; refuse rather than overwrite the audit record.
        const exists = await client
          .send(new HeadObjectCommand({ Bucket: s3.bucket, Key }))
          .then(() => true)
          .catch(() => false);
        if (exists) throw new Error(`evidence object already exists: ${Key}`);
        await client.send(
          new PutObjectCommand({
            Bucket: s3.bucket,
            Key,
            Body: body,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        return storagePath;
      },
    };
  }

  const baseDir = process.env.LOCAL_EVIDENCE_DIR ?? opts.localFallbackDir;
  return {
    describe: () => `local:${baseDir}`,
    async put(storagePath, body) {
      const full = path.join(baseDir, storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body, { flag: 'wx' });
      return storagePath;
    },
  };
}
