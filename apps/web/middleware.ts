import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, originOf } from '@/lib/csp';
import { embedOriginsFor } from '@/lib/embed-policy';

/**
 * Security headers for every page (SPEC-v3 §2.3): a per-request nonce CSP,
 * framing denied except on /embed/{tenant} (whose frame-ancestors come from
 * the tenant's embed_origins), and the standard hardening headers.
 *
 * Runs on the Node.js runtime (stable in Next 15.5) so the embed allowlist
 * can be read from Postgres directly.
 */
export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const path = request.nextUrl.pathname;

  let frameAncestors: string[] | null = null;
  const embed = /^\/embed\/([^/]+)\/?$/.exec(path);
  if (embed?.[1]) {
    frameAncestors = await embedOriginsFor(decodeURIComponent(embed[1]));
  }

  const csp = buildCsp({
    nonce,
    dev,
    evidenceOrigin: originOf(process.env.S3_PUBLIC_URL),
    frameAncestors,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  if (frameAncestors === null) response.headers.set('x-frame-options', 'DENY');
  // Offline caching contract with public/sw.js: only pages rendered for an
  // anonymous visitor may be stored on the device. A signed-in page can carry
  // an email address and must never outlive the session on a shared computer.
  const signedIn = request.cookies
    .getAll()
    .some((c) => c.name === 'authjs.session-token' || c.name === '__Secure-authjs.session-token');
  response.headers.set('x-df-cache', signedIn ? 'private' : 'public');
  if (signedIn) response.headers.set('cache-control', 'private, no-store');
  if (!dev) {
    response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  }
  return response;
}

export const config = {
  runtime: 'nodejs',
  matcher: [
    // Pages and route handlers; static assets, the service worker, and
    // public files carry their own headers (next.config.ts).
    '/((?!_next/static|_next/image|favicon.ico|icons/|evidence/|embed.js|sw.js|manifest.webmanifest|robots.txt).*)',
  ],
};
