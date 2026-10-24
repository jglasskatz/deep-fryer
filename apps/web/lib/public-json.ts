import { createHash } from 'node:crypto';

/** Semantic ETag: generation time describes the request, not a data change.
 * Public callers must supply only anonymous projections, never member data.
 */
export function publicJson(request: Request, body: Record<string, unknown>, maxAge = 300): Response {
  const { generated_at: _generatedAt, ...content } = body;
  const digest = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const etag = `W/"${digest}"`;
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'ETag',
    'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=600`,
    etag,
  };
  const match = request.headers.get('if-none-match')?.split(',').some((value) => {
    const candidate = value.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === etag.replace(/^W\//, '');
  });
  return match ? new Response(null, { status: 304, headers }) : Response.json(body, { headers });
}

/** Permit browser conditional requests; this API is public and credential-free. */
export function publicOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'If-None-Match',
      'access-control-max-age': '86400',
    },
  });
}
