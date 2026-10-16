import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { authConfigured, smtpConfigured } from '@/lib/env';
import { loginI18n } from '../i18n';
import { LOGIN_PATH, loginHref } from '../sign-in';

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await loginI18n();
  return { title: m.login.checkTitle };
}

/**
 * "Check your email" (SPEC-v6 §2.2): Auth.js's verify-request page
 * (auth.ts pages.verifyRequest), shown once a sign-in link is on its way.
 * It says where to look, that the link works once for 15 minutes, and offers
 * to send another — back to the form with the same `next`, so the person
 * still returns to the page they started on.
 *
 * Auth.js appends `?provider=nodemailer&type=email` when it redirects here
 * itself; the page needs neither. The address is not shown: it is not in the
 * URL (deliberately — URLs end up in logs and history).
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!authConfigured()) redirect(LOGIN_PATH);
  const { next } = await searchParams;
  const { m, info } = await loginI18n();
  const t = m.login;

  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main" lang={info.code} dir={info.dir} className="mx-auto max-w-md px-4 sm:px-6 py-16">
        <div className="rounded-lg border border-green-700/30 bg-green-50 p-6">
          <svg
            aria-hidden
            className="h-8 w-8 text-green-800"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
          </svg>
          {/* Arriving from "Send link" is a client-side navigation; Next's
              route announcer reads this page's title to screen readers. */}
          <h1 className="mt-3 text-2xl font-bold">{t.checkTitle}</h1>
          <p className="mt-3 text-sm">{t.checkBody}</p>
          <p className="mt-3 text-sm text-[color:var(--color-muted)]">{t.checkHelp}</p>
        </div>

        <p className="mt-6">
          <Link
            href={loginHref(next)}
            className="inline-flex min-h-11 items-center rounded border border-black/20 bg-white px-4 py-2 text-sm font-medium hover:bg-black/5"
          >
            {t.sendAnother}
          </Link>
        </p>

        {!smtpConfigured() ? (
          // Developer-facing: English on every page.
          <p lang="en" className="mt-4 text-xs text-amber-800">
            Development: SMTP is not configured, so the link was printed to the server log.
          </p>
        ) : null}
      </main>
    </>
  );
}
