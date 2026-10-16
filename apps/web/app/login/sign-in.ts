import type { Messages } from '@/lib/i18n/messages/en';

/**
 * Where the sign-in links point and where sign-in sends people back to
 * (SPEC-v6 §2.2). Pure — no request, session, or database imports — so the
 * site header, both sign-in pages, and their tests share one definition.
 *
 * The rule for `next` everywhere: a same-site path that is not one of the
 * sign-in pages themselves. A resident who taps "Sign in" on Housing comes
 * back to Housing; nobody is ever sent "back" to /login after signing in.
 * lib/auth.ts safeNextPath validates `next` again where it is consumed, so
 * these helpers decide what is worth carrying, not what is safe to follow.
 */

export const LOGIN_PATH = '/login';
/** Auth.js's verify-request page (auth.ts pages.verifyRequest). */
export const CHECK_EMAIL_PATH = '/login/check-email';

/** A path on this site: absolute, and not protocol-relative (`//host`) or `/\host`, which browsers treat as `//host`. Mirrors safeNextPath. */
function isSameSitePath(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

function pathnameOf(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

function isSignInPage(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

/**
 * The `next` worth carrying, or null: same-site and not a sign-in page. Used
 * on the way in (the header link) and on the way between the sign-in pages
 * (an error, the check-email page, "send another link").
 */
export function returnPath(next: string | null | undefined): string | null {
  if (!isSameSitePath(next) || isSignInPage(pathnameOf(next))) return null;
  return next;
}

function withNext(base: string, next: string | null | undefined, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  const carried = returnPath(next);
  if (carried) params.set('next', carried);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The sign-in page, carrying `next` when there is somewhere worth returning to. */
export function loginHref(next?: string | null): string {
  return withNext(LOGIN_PATH, next);
}

/** The sign-in page showing an Auth.js error code (mapped to words by loginErrorMessage). */
export function loginErrorHref(code: string, next?: string | null): string {
  return withNext(LOGIN_PATH, next, { error: code });
}

/** The check-your-email page; its "send another link" keeps `next`. */
export function checkEmailHref(next?: string | null): string {
  return withNext(CHECK_EMAIL_PATH, next);
}

/**
 * The header's "Sign in" link for the page being rendered.
 *
 * `requestPath` is the request's unprefixed path and query (lib/i18n/server
 * getRequestPath); `localize` puts the reader's language prefix back
 * (getI18n().href), so a Spanish reader returns to the Spanish page.
 *
 * - On a sign-in page, the link keeps whatever `next` that page already
 *   carries rather than pointing at itself.
 * - On the product's front page (`/`) there is nothing to return to: sign-in
 *   lands on the account page, which lists the person's portraits.
 */
export function signInHref(requestPath: string, localize: (path: string) => string = (path) => path): string {
  if (!isSameSitePath(requestPath)) return LOGIN_PATH;
  const pathname = pathnameOf(requestPath);
  if (isSignInPage(pathname)) {
    const query = requestPath.slice(pathname.length).replace(/^\?/, '').split('#')[0];
    return loginHref(new URLSearchParams(query).get('next'));
  }
  if (pathname === '/') return LOGIN_PATH;
  return loginHref(localize(requestPath));
}

/**
 * Where the email form goes once Auth.js has handled the request.
 *
 * The form calls signIn without letting Auth.js redirect, because Auth.js
 * would send the browser through its own verify-request hop to
 * pages.verifyRequest and drop `next` on the way. Success is any URL
 * without an `error` parameter (Auth.js answers a sent link with its
 * verify-request URL); an error goes back to the form with the same `next`.
 */
export function afterEmailSignIn(authRedirect: string, next?: string | null): string {
  let error: string | null;
  try {
    error = new URL(authRedirect, 'http://sign-in.invalid').searchParams.get('error');
  } catch {
    // Auth.js always answers with a URL; something else is a failed send.
    error = 'EmailSignin';
  }
  return error ? loginErrorHref(error, next) : checkEmailHref(next);
}

/**
 * Words for an Auth.js error code (`/login?error=…`), from the reader's
 * catalog. Unknown codes get the catalog's default; only the catalog's own
 * keys count, so `?error=constructor` cannot reach an object prototype.
 */
export function loginErrorMessage(
  code: string | null | undefined,
  errors: Messages['login']['errors'],
): string | null {
  if (!code) return null;
  return Object.hasOwn(errors, code) ? errors[code as keyof typeof errors] : errors.default;
}
