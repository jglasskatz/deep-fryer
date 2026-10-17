import Link from 'next/link';
import type { Messages } from '@/lib/i18n/messages';
import { rich } from '@/lib/i18n/format';
import { DoughnutCredit } from './DoughnutCredit';

export interface SiteFooterProps {
  /** m.footer in the page's language (the root layout's catalog, so the sign-in pages' too). */
  labels: Messages['footer'];
  /** SUPPORT_EMAIL (lib/env.ts supportEmail): required in production, so only a dev server lacks it. */
  supportEmail: string | null;
  /** TERMS_URL (lib/site-settings.ts termsUrl): the operator's terms, linked only when set. */
  termsUrl: string | null;
}

/**
 * The site footer, rendered once by the root layout under every page but
 * embeds (an embed sits inside a city's own page and carries the Doughnut
 * credit itself, components/embed/EmbedFrame.tsx).
 *
 * - Contact: the operator's support address, shown as well as linked, so a
 *   reader without a mail program can still copy it.
 * - Accessibility and Privacy: the statement and the notice, which exist in
 *   English only (hrefLang says so to assistive technology and crawlers).
 * - Terms: only when the operator has terms to link; the software has none
 *   of its own to offer.
 * - The Doughnut's attribution (docs/OPEN-SOURCE.md §3.3) — the footer is on
 *   every page that draws a doughnut, so the credit is too.
 *
 * Synchronous and given everything it shows, so it renders the same wherever
 * it is called and needs no request to test. No prefetch on the links: they
 * are on every page and rarely followed.
 */
export function SiteFooter({ labels, supportEmail, termsUrl }: SiteFooterProps) {
  const link = 'inline-block py-1 underline hover:opacity-80';
  return (
    <footer className="border-t border-black/10">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-[color:var(--color-muted)] sm:px-6">
        <nav aria-label={labels.label}>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {supportEmail ? (
              <li className="[overflow-wrap:anywhere]">
                {rich(labels.contact, {
                  email: (
                    <a className={link} href={`mailto:${supportEmail}`} dir="ltr">
                      {supportEmail}
                    </a>
                  ),
                })}
              </li>
            ) : null}
            <li>
              <Link className={link} href="/accessibility" hrefLang="en" prefetch={false}>
                {labels.accessibility}
              </Link>
            </li>
            <li>
              <Link className={link} href="/privacy" hrefLang="en" prefetch={false}>
                {labels.privacy}
              </Link>
            </li>
            {termsUrl ? (
              <li>
                <a className={link} href={termsUrl}>
                  {labels.terms}
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
        <p className="mt-3 max-w-3xl">
          <DoughnutCredit text={labels.credit} />
        </p>
      </div>
    </footer>
  );
}
