import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { SubmitButton } from '@/components/login/SubmitButton';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getAuth, safeNextPath } from '@/lib/auth';
import {
  authConfigured,
  emailSignInEnabled,
  googleConfigured,
  microsoftConfigured,
  smtpConfigured,
} from '@/lib/env';
import { deploymentFeatureOn } from '@/lib/features';
import { rich } from '@/lib/i18n/format';
import { loginI18n } from './i18n';
import {
  afterEmailSignIn,
  checkEmailHref,
  isPlausibleEmail,
  isStartPath,
  loginErrorHref,
  loginErrorMessage,
  MAX_EMAIL_LENGTH,
  returnPath,
  START_PATH,
} from './sign-in';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await loginI18n();
  return { title: m.login.title };
}

/**
 * Sign in (SPEC-v3 §2.1, SPEC-v6 §2.2): Microsoft and Google for city staff's
 * work accounts, an emailed link for anyone.
 *
 * Residents arrive from the portrait — often from a translated page — so
 * every word they read comes from the language catalogs, in the language
 * they last chose (./i18n.ts). Two notices stay English because only an
 * operator or developer can act on them: "authentication is not configured"
 * and the development-only SMTP note.
 *
 * `next` is where the person was; it survives errors and the check-email
 * page (./sign-in.ts), and lib/auth.ts safeNextPath validates it before any
 * redirect follows it. When it is the self-serve start flow (/start), the
 * person is city staff setting up a portrait, so the introduction speaks to
 * them and asks for a work address, and the "start a portrait" pointer is
 * left out (they are on their way there).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  const { next: rawNext, sent, error } = await searchParams;
  const next = safeNextPath(rawNext);
  /** `next` as the sign-in pages carry it between themselves (null: nowhere particular). */
  const carried = returnPath(rawNext);

  // The verify-request page used to be /login?sent=1, which Auth.js turned
  // into /login?sent=1?provider=nodemailer&type=email. Links and history
  // entries with that shape go to the page that replaced it.
  if (sent !== undefined) redirect(checkEmailHref(carried));

  const { m, info } = await loginI18n();
  const t = m.login;

  if (!authConfigured()) {
    return (
      <>
        <SiteHeader variant="sign-in" />
        <main id="main" lang={info.code} dir={info.dir} className="mx-auto max-w-md px-4 sm:px-6 py-20 text-center">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          {/* Operator-facing: English on every page (see the component comment). */}
          <p lang="en" className="mt-6 text-sm text-[color:var(--color-muted)]">
            Authentication is not configured (no <code>AUTH_SECRET</code>). Local development runs
            in dev mode: every request acts as an owner, so there is nothing to sign in to.
          </p>
        </main>
      </>
    );
  }

  const ctx = await getAuth();
  if (ctx.userId) redirect(next);

  async function oauth(provider: 'google' | 'microsoft-entra-id') {
    'use server';
    await signIn(provider, { redirectTo: next });
  }

  async function emailLink(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    // A plausible single address of bounded length (./sign-in.ts says why);
    // Auth.js normalizes and validates it again.
    if (!isPlausibleEmail(email)) redirect(loginErrorHref('EmailSignin', carried));
    let destination: string;
    try {
      // redirect: false — Auth.js's own redirect would go through its
      // verify-request hop and lose `next` (afterEmailSignIn).
      const authRedirect: unknown = await signIn('nodemailer', { email, redirectTo: next, redirect: false });
      destination = afterEmailSignIn(String(authRedirect), carried);
    } catch (err) {
      // Auth.js throws here when auth.ts callbacks.signIn failed (the sign-in
      // limits could not be read). A limit that refuses, and a send that
      // fails, come back as an error URL instead (afterEmailSignIn).
      if (err instanceof AuthError) redirect(loginErrorHref('EmailSignin', carried));
      throw err;
    }
    redirect(destination);
  }

  const providers = {
    google: googleConfigured(),
    microsoft: microsoftConfigured(),
    email: emailSignInEnabled(),
  };
  const errorText = loginErrorMessage(error, t.errors);
  const forStart = isStartPath(carried);
  // The pointer to /start is a "build your city's doughnut" call to action:
  // gone with the self_serve feature (the page is then a 404), and redundant
  // for someone already headed there.
  const offerStart = deploymentFeatureOn('self_serve') && !forStart;
  const providerButton =
    'w-full rounded border border-black/20 bg-white px-4 py-2.5 text-sm font-medium hover:bg-black/5';

  return (
    <>
      <SiteHeader variant="sign-in" />
      <main id="main" lang={info.code} dir={info.dir} className="mx-auto max-w-md px-4 sm:px-6 py-16">
        <h1 className="text-2xl font-bold">{t.title}</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">{forStart ? t.startIntro : t.intro}</p>

        {errorText ? (
          <p role="alert" className="mt-6 rounded border border-red-700/30 bg-red-50 p-3 text-sm text-red-900">
            {errorText}
          </p>
        ) : null}

        <div className="mt-8 space-y-3">
          {providers.microsoft ? (
            <form action={oauth.bind(null, 'microsoft-entra-id')}>
              <SubmitButton label={t.microsoft} className={providerButton} />
            </form>
          ) : null}
          {providers.google ? (
            <form action={oauth.bind(null, 'google')}>
              <SubmitButton label={t.google} className={providerButton} />
            </form>
          ) : null}
        </div>

        {providers.email ? (
          <form action={emailLink} className="mt-6 border-t border-black/10 pt-6">
            <label className="block text-sm font-medium" htmlFor="email">
              {t.emailLabel}
            </label>
            {/* Addresses are written left to right in every language. */}
            <input
              id="email"
              name="email"
              type="email"
              required
              maxLength={MAX_EMAIL_LENGTH}
              autoComplete="email"
              dir="ltr"
              className="mt-2 w-full rounded border border-field-border bg-white px-3 py-2 text-sm"
              placeholder={t.emailPlaceholder}
            />
            <SubmitButton
              label={t.send}
              pendingLabel={t.sending}
              className="mt-3 w-full rounded bg-black px-4 py-2.5 text-sm font-medium text-white"
            />
            {!smtpConfigured() ? (
              <p lang="en" className="mt-2 text-xs text-amber-800">
                Development: SMTP is not configured, so the link prints to the server log.
              </p>
            ) : null}
          </form>
        ) : null}

        {!providers.google && !providers.microsoft && !providers.email ? (
          <p className="mt-6 text-sm text-red-800">{t.noMethods}</p>
        ) : null}

        {offerStart ? (
          <p className="mt-10 text-xs text-[color:var(--color-muted)]">
            {rich(t.newHere, {
              link: (
                <Link className="underline" href={START_PATH}>
                  {t.startLink}
                </Link>
              ),
            })}
          </p>
        ) : null}
      </main>
    </>
  );
}
