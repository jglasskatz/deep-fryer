import path from 'node:path';
import { SLUG_RE, isPrivateStoragePath } from '@deep-fryer/core';
import { tenantBySlug } from '@deep-fryer/db';
import { assertStoragePath, isMissingObject, localPrivateDir, tenantStorage } from '@deep-fryer/research';
import { getRole, roleAtLeast } from '@/lib/auth';
import { systemDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Types a group's files are named with; anything else is sent as plain
 * bytes. Every answer is a download (never rendered on this origin), so
 * the type only tells the reader's computer which program opens it.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Not found, for every refusal: someone who is not a member learns nothing,
 * not even whether the portrait or the file exists.
 */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store', 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * A group's own files, for its members only. These objects live in the
 * private store (core's private prefixes), which has no public URL; this
 * route is the only way to read one back, and it answers only to someone
 * with a role on the portrait.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; path: string[] }> },
) {
  const { tenant: slug, path: parts } = await params;
  const storagePath = parts.join('/');
  if (!SLUG_RE.test(slug) || !isPrivateStoragePath(storagePath)) return notFound();
  try {
    assertStoragePath(storagePath);
  } catch {
    return notFound();
  }

  const tenant = await tenantBySlug(systemDb(), slug);
  if (!tenant) return notFound();
  if (!roleAtLeast(await getRole(tenant.id), 'viewer')) return notFound();

  // The web app runs from apps/web, so the repository root is two levels up
  // (the same private directory the worker writes to).
  const storage = await tenantStorage(tenant.slug, {
    localFallbackDir: path.resolve(process.cwd(), 'public', 'evidence', tenant.slug),
    localPrivateDir: localPrivateDir(path.resolve(process.cwd(), '..', '..'), tenant.slug),
  });
  let body: Buffer;
  try {
    body = await storage.get(storagePath);
  } catch (error) {
    if (isMissingObject(error)) return notFound();
    throw error;
  }

  const name = parts[parts.length - 1]!;
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      // The name passed assertStoragePath: letters, digits, '.', '_' and '-' only.
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
    },
  });
}
