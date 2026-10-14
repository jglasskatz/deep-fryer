/**
 * Content-Security-Policy construction (SPEC-v3 §2.3), kept pure so it is
 * unit-testable and the middleware stays a thin adapter.
 *
 * Scripts are nonce-gated with 'strict-dynamic' (Next.js stamps the nonce on
 * its own scripts when it sees this header on the request). Framing is
 * denied everywhere except the embed route, whose frame-ancestors come from
 * the tenant's embed_origins allowlist — enforced by the browser, unlike the
 * v2 `?origin=` query parameter a hostile page could simply lie about.
 */

export interface CspOptions {
  nonce: string;
  dev: boolean;
  /** Origin evidence images are served from (S3 public URL), if not same-origin. */
  evidenceOrigin?: string | null;
  /** null = no framing; [] = same-origin only; list = those origins may frame. */
  frameAncestors: string[] | null;
}

/** Where sign-in and checkout forms post or redirect (form-action covers redirects in Chromium). */
const FORM_TARGETS = [
  'https://checkout.stripe.com',
  'https://billing.stripe.com',
  'https://accounts.google.com',
  'https://login.microsoftonline.com',
];

export function buildCsp(opts: CspOptions): string {
  const scriptSrc = [`'self'`, `'nonce-${opts.nonce}'`, `'strict-dynamic'`];
  if (opts.dev) scriptSrc.push(`'unsafe-eval'`);
  const imgSrc = [`'self'`, 'data:', 'blob:'];
  if (opts.evidenceOrigin) imgSrc.push(opts.evidenceOrigin);
  const connectSrc = [`'self'`];
  if (opts.dev) connectSrc.push('ws:');

  const ancestors =
    opts.frameAncestors === null
      ? `'none'`
      : [`'self'`, ...opts.frameAncestors.filter(isOrigin)].join(' ');

  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    // Inline style attributes come from React style props and the canvas
    // tooltip; styles cannot execute code, so this is the accepted trade.
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${imgSrc.join(' ')}`,
    `font-src 'self'`,
    `connect-src ${connectSrc.join(' ')}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' ${FORM_TARGETS.join(' ')}`,
    `frame-ancestors ${ancestors}`,
  ];
  if (!opts.dev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Only scheme://host[:port] values may enter a CSP — no paths, wildcards, or injection. */
export function isOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      u.origin === value.replace(/\/+$/, '') &&
      !value.includes(';') &&
      !value.includes(' ')
    );
  } catch {
    return false;
  }
}

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
