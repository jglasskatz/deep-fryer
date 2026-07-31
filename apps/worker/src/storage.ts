import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface TenantStorage {
  /** Store bytes at a tenant-relative path; returns the stored path. */
  put(storagePath: string, body: Buffer, contentType: string): Promise<string>;
  describe(): string;
}

/**
 * One bucket per tenant (SPEC.md §4). Supabase Storage in real deployments;
 * the local fallback writes into the web app's public/ directory so the
 * drilldown renders evidence in dev.
 */
export async function tenantStorage(tenantSlug: string): Promise<TenantStorage> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, serviceKey, { auth: { persistSession: false } });
    const bucket = `tenant-${tenantSlug}`;
    const { data: buckets } = await client.storage.listBuckets();
    if (!buckets?.some((b) => b.name === bucket)) {
      await client.storage.createBucket(bucket, { public: true });
    }
    return {
      describe: () => `supabase:${bucket}`,
      async put(storagePath, body, contentType) {
        const { error } = await client.storage
          .from(bucket)
          .upload(storagePath, body, { upsert: true, contentType });
        if (error) throw new Error(`storage upload failed: ${error.message}`);
        return storagePath;
      },
    };
  }

  const baseDir =
    process.env.LOCAL_EVIDENCE_DIR ??
    path.resolve(process.cwd(), '..', 'web', 'public', 'evidence', tenantSlug);
  return {
    describe: () => `local:${baseDir}`,
    async put(storagePath, body) {
      const full = path.join(baseDir, storagePath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
      return storagePath;
    },
  };
}
