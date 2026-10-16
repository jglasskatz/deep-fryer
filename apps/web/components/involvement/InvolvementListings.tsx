import { telHref, type InvolvementKind, type InvolvementListingView } from '@deep-fryer/core';
import { rich } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/locales';
import type { Messages } from '@/lib/i18n/messages/en';
import { safeHref } from '@/lib/safe-url';

/**
 * "How to get involved" listings (SPEC-v6 §4.1), as a plain server
 * component shared by the dimension pages and the Get involved page.
 * Conventions, as on the emergency page (components/emergency/EmergencySections.tsx):
 *
 * - Chrome comes from `m.involvement` (the reader's language); what staff
 *   entered — a listing's name and description — is shown as entered and
 *   marked `lang="en"`, so screen readers pronounce it correctly and
 *   right-to-left pages isolate it.
 * - The kind ("Volunteer", "Have your say", …) is always written out; its
 *   tint only repeats what the words say (WCAG 1.4.1).
 * - Layout uses logical properties, so Arabic and Urdu mirror correctly.
 * - Links pass through safeHref (only http(s) renders — and the database
 *   only stores https for listings); phone numbers are tel: links laid out
 *   left-to-right so their digits never reorder.
 * - The "link checked" date is formatted for the reader's language on the
 *   portrait's clock, with an all-numeric fallback where the runtime has no
 *   date data for the language (Haitian Creole): never English month names
 *   inside a translated sentence.
 */

const badge = 'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium';

/** A tint per kind; the kind's name is always written beside it. */
const KIND_STYLE: Record<InvolvementKind, string> = {
  volunteer: 'bg-green-100 text-green-900',
  services: 'bg-sky-100 text-sky-900',
  civic: 'bg-amber-100 text-amber-900',
  organize: 'bg-teal-100 text-teal-900',
  other: 'bg-black/5',
};

/** Text staff wrote: long URLs and names must wrap rather than widen the page on a phone. */
const PROSE = 'break-words [overflow-wrap:anywhere]';

/**
 * "Oct 16, 2026" in the reader's language, on the portrait's clock; where
 * Intl has no data for the language, "2026-10-16".
 */
export function formatCheckedDate(iso: string, locale: Locale, timeZone: string): string {
  const date = new Date(iso);
  if (Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0) {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone }).format(date);
  }
  const part = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${part.year}-${part.month}-${part.day}`;
}

/**
 * The note that listings are in English, for readers of any other language
 * (once per page, above the first list).
 */
export function InvolvementLanguageNote({ m, locale }: { m: Messages; locale: Locale }) {
  if (locale === 'en') return null;
  return <p className="mt-2 text-xs text-[color:var(--color-muted)]">{m.involvement.contentInEnglish}</p>;
}

export function InvolvementListings({
  m,
  locale,
  timeZone,
  listings,
  markGeneral = false,
  empty = null,
}: {
  m: Messages;
  locale: Locale;
  /** The portrait's time zone, for the "Link checked" date. */
  timeZone: string;
  listings: InvolvementListingView[];
  /**
   * Label listings that serve every dimension "For every dimension" — on a
   * dimension page, where they follow the dimension's own listings and a
   * reader should not take them for something specific to it.
   */
  markGeneral?: boolean;
  /** What to say when there is nothing to list; null renders nothing. */
  empty?: string | null;
}) {
  const t = m.involvement;
  if (listings.length === 0) {
    return empty ? <p className="mt-3 text-sm text-[color:var(--color-muted)]">{empty}</p> : null;
  }
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {listings.map((l) => {
        const site = safeHref(l.url);
        const tel = telHref(l.phone);
        return (
          <li key={l.id} className="flex flex-col rounded border border-black/10 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${badge} ${KIND_STYLE[l.kind]}`}>{t.kind[l.kind]}</span>
              {markGeneral && l.dimension_slugs.length === 0 ? (
                <span className={`${badge} border border-black/15`}>{t.forEveryDimension}</span>
              ) : null}
            </div>
            <h3 lang="en" className={`mt-2 font-semibold ${PROSE}`}>
              {site ? (
                // A new tab: the reader is usually partway down a dimension
                // page and should not lose their place. noopener so the
                // other site cannot script this page; noreferrer so it does
                // not learn which page (and language) the reader came from.
                <a className="underline" href={site} target="_blank" rel="noopener noreferrer">
                  {l.name}
                </a>
              ) : (
                l.name
              )}
            </h3>
            <p lang="en" className={`mt-1 text-sm ${PROSE}`}>
              {l.description}
            </p>
            {tel || site ? (
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {tel && l.phone ? (
                  <a className="font-medium underline" href={tel}>
                    {rich(t.call, { phone: <span dir="ltr">{l.phone}</span> })}
                  </a>
                ) : null}
                {site ? (
                  <a className="underline" href={site} target="_blank" rel="noopener noreferrer">
                    {t.website}
                  </a>
                ) : null}
              </p>
            ) : null}
            {l.link_checked_at ? (
              <p className="mt-auto pt-2 text-xs text-[color:var(--color-muted)]">
                {rich(t.checked, {
                  date: <time dateTime={l.link_checked_at}>{formatCheckedDate(l.link_checked_at, locale, timeZone)}</time>,
                })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
