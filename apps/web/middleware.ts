import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, originOf } from '@/lib/csp';
import { embedOriginsFor } from '@/lib/embed-policy';
import { DEFAULT_LOCALE, asLocale, localeInfo, type Locale } from '@/lib/i18n/locales';
import { isLocalizablePath, localizeHref, splitLocale } from '@/lib/i18n/routing';
import { translationOnFor } from '@/lib/translation-policy';

/** The reader's language choice, remembered across visits (1 year). */
const LANG_COOKIE = 'df_lang';

/**
 * Next runs middleware again on the target of a rewrite (/es/nyc → /nyc),
 * carrying the request headers the first pass set. That second pass must
 * keep the first pass's language instead of re-deriving English from the
 * unprefixed path. The marker is a per-process random value that never
 * leaves the server, so a client cannot send it to choose a locale.
 */
const ROUTED_MARK = crypto.randomUUID();

/**
 * Language routing (lib/i18n/routing.ts). Returns a redirect, or the locale
 * and unprefixed path the page renders.
 *
 * - `/es/nyc` renders /nyc in Spanish and remembers the choice.
 * - `/es/login` (a page that exists only in English) redirects to /login.
 * - `/nyc?hl=en` is the switcher's way back to English: it records the
 *   choice and redirects to the clean URL.
 * - `/nyc` for a reader who chose Spanish earlier redirects to /es/nyc —
 *   only for top-level page loads, never for embeds, APIs, or fetches.
 * - A portrait whose `translation` feature is off (SPEC-v7 §3.5) is English
 *   only: `/es/{portrait}/…` redirects to `/{portrait}/…`, and a remembered
 *   language does not send its readers to a prefixed URL. The remembered
 *   choice is kept, so portraits that are translated still open in it.
 */
async function routeLanguage(
  request: NextRequest,
): Promise<{ redirect: NextResponse } | { locale: Locale; path: string; remember: Locale | null }> {
  const url = request.nextUrl;
  const { locale: prefixed, path } = splitLocale(url.pathname);
  if (prefixed) {
    if (!isLocalizablePath(path) || !(await translationOnFor(path))) {
      const to = url.clone();
      to.pathname = path;
      // 307 (not 308) for a portrait's pages: turning translation on later
      // makes the prefixed URL valid again, so browsers must not cache this.
      return { redirect: NextResponse.redirect(to, isLocalizablePath(path) ? 307 : 308) };
    }
    return { locale: prefixed, path, remember: prefixed };
  }

  const hl = url.searchParams.get('hl');
  if (hl !== null) {
    const chosen = asLocale(hl);
    const to = url.clone();
    to.searchParams.delete('hl');
    to.pathname = (await translationOnFor(url.pathname)) ? localizeHref(chosen, url.pathname) : url.pathname;
    const res = NextResponse.redirect(to, 303);
    rememberLanguage(res, chosen);
    return { redirect: res };
  }

  const saved = request.cookies.get(LANG_COOKIE)?.value;
  const preferred = saved ? asLocale(saved) : DEFAULT_LOCALE;
  const topLevelPage =
    request.method === 'GET' &&
    request.headers.get('sec-fetch-dest') === 'document' &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
  if (
    preferred !== DEFAULT_LOCALE &&
    topLevelPage &&
    isLocalizablePath(url.pathname) &&
    (await translationOnFor(url.pathname))
  ) {
    const to = url.clone();
    to.pathname = `/${localeInfo(preferred).prefix}${url.pathname}`;
    return { redirect: NextResponse.redirect(to, 307) };
  }
  return { locale: DEFAULT_LOCALE, path: url.pathname, remember: null };
}

function rememberLanguage(response: NextResponse, locale: Locale): void {
  response.cookies.set(LANG_COOKIE, locale, {
    path: '/',
    maxAge: 365 * 86_400,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Security headers for every page (SPEC-v3 §2.3): a per-request nonce CSP,
 * framing denied except on /embed/{tenant} (whose frame-ancestors come from
 * the tenant's embed_origins), and the standard hardening headers.
 *
 * Runs on the Node.js runtime (stable in Next 15.5) so the embed allowlist
 * can be read from Postgres directly.
 */
export async function middleware(request: NextRequest) {
  const alreadyRouted = request.headers.get('x-df-routed') === ROUTED_MARK;
  const language = alreadyRouted
    ? { locale: asLocale(request.headers.get('x-df-locale')), path: request.nextUrl.pathname, remember: null }
    : await routeLanguage(request);
  if ('redirect' in language) return language.redirect;
  const { locale, path } = language;

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';

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
    signInOrigins: [originOf(process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER)],
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  // Always set, so a client-sent x-df-locale / x-df-path can never reach a page.
  requestHeaders.set('x-df-locale', locale);
  requestHeaders.set(
    'x-df-path',
    alreadyRouted ? (request.headers.get('x-df-path') ?? path) : path + request.nextUrl.search,
  );
  requestHeaders.set('x-df-routed', ROUTED_MARK);

  const response =
    path === request.nextUrl.pathname
      ? NextResponse.next({ request: { headers: requestHeaders } })
      : NextResponse.rewrite(new URL(path + request.nextUrl.search, request.url), {
          request: { headers: requestHeaders },
        });
  // Embeds render inside other sites; their language is the host page's
  // choice (data-lang), not the reader's remembered preference for this site.
  const isEmbed = path.startsWith('/embed/');
  if (language.remember && !isEmbed && request.cookies.get(LANG_COOKIE)?.value !== language.remember) {
    rememberLanguage(response, language.remember);
  }
  response.headers.set('content-language', locale);
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
