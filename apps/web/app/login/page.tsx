import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getAuth, safeNextPath } from '@/lib/auth';
import {
  authConfigured,
  emailSignInEnabled,
  googleConfigured,
  microsoftConfigured,
  smtpConfigured,
} from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

/** Auth.js error codes → what the person can actually do about it. */
const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    'That email already signed in another way. Use the method you used before (or an email link), then link this provider from your account page.',
  Verification: 'That sign-in link has expired or was already used. Request a new one.',
  AccessDenied: 'Sign-in was declined.',
  Configuration: 'Sign-in is misconfigured on this server. Contact the site administrator.',
  EmailSignin: 'We could not send the sign-in email. Try again in a few minutes.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  const { next: rawNext, sent, error } = await searchParams;
  const next = safeNextPath(rawNext);

  if (!authConfigured()) {
    return (
      <>
        <SiteHeader variant="landing" />
        <main id="main" className="mx-auto max-w-md px-6 py-20 text-center">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-6 text-sm text-[color:var(--color-muted)]">
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      redirect(`/login?error=EmailSignin&next=${encodeURIComponent(next)}`);
    }
    try {
      await signIn('nodemailer', { email, redirectTo: next });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/login?error=EmailSignin&next=${encodeURIComponent(next)}`);
      }
      throw err;
    }
  }

  const providers = {
    google: googleConfigured(),
    microsoft: microsoftConfigured(),
    email: emailSignInEnabled(),
  };

  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main" className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          City staff use their work account. Residents can sign in to join a portrait&apos;s
          discussion.
        </p>

        {sent ? (
          <div role="status" className="mt-6 rounded border border-green-700/30 bg-green-50 p-4 text-sm">
            <p className="font-medium">Check your email.</p>
            <p className="mt-1">
              We sent a sign-in link. It expires in 15 minutes and works once.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-6 rounded border border-red-700/30 bg-red-50 p-3 text-sm text-red-900">
            {ERRORS[error] ?? 'Sign-in failed. Try again.'}
          </p>
        ) : null}

        <div className="mt-8 space-y-3">
          {providers.microsoft ? (
            <form action={oauth.bind(null, 'microsoft-entra-id')}>
              <button className="w-full rounded border border-black/20 bg-white px-4 py-2.5 text-sm font-medium hover:bg-black/5">
                Continue with Microsoft (work account)
              </button>
            </form>
          ) : null}
          {providers.google ? (
            <form action={oauth.bind(null, 'google')}>
              <button className="w-full rounded border border-black/20 bg-white px-4 py-2.5 text-sm font-medium hover:bg-black/5">
                Continue with Google
              </button>
            </form>
          ) : null}
        </div>

        {providers.email ? (
          <form action={emailLink} className="mt-6 border-t border-black/10 pt-6">
            <label className="block text-sm font-medium" htmlFor="email">
              Email me a sign-in link
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-2 w-full rounded border border-black/20 bg-white px-3 py-2 text-sm"
              placeholder="you@cityofexample.gov"
            />
            <button className="mt-3 w-full rounded bg-black px-4 py-2.5 text-sm font-medium text-white">
              Send link
            </button>
            {!smtpConfigured() ? (
              <p className="mt-2 text-xs text-amber-800">
                Development: SMTP is not configured, so the link prints to the server log.
              </p>
            ) : null}
          </form>
        ) : null}

        {!providers.google && !providers.microsoft && !providers.email ? (
          <p className="mt-6 text-sm text-red-800">
            No sign-in method is configured on this server.
          </p>
        ) : null}

        <p className="mt-10 text-xs text-[color:var(--color-muted)]">
          New to deep-fryer? After signing in you can{' '}
          <a className="underline" href="/start">
            start a portrait for your jurisdiction
          </a>
          .
        </p>
      </main>
    </>
  );
}
