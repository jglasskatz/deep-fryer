import { rich } from '@/lib/i18n/format';

/** The Doughnut's license (docs/OPEN-SOURCE.md §3.1): the diagram is shared under CC BY-SA 4.0. */
export const DOUGHNUT_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

/**
 * The attribution every rendered doughnut owes (docs/OPEN-SOURCE.md
 * §3.2–3.3): Kate Raworth and Christian Guthier's diagram under CC BY-SA
 * 4.0, adapted with local data; the city-portrait method after DEAL's
 * Creating City Portraits; and that this site is neither affiliated with
 * nor endorsed by Doughnut Economics Action Lab. One component, so the site
 * footer (every page but embeds) and the embed (which has no footer) carry
 * the same words — a city that embeds its portrait complies by default.
 *
 * `text` is the catalog's m.footer.credit in the reader's language; the
 * license name and the two titles are filled in here, untranslated (proper
 * names, as the catalogs' conventions say). Renders inline, so the caller
 * chooses the paragraph and its size. No 'use client': it has no state and
 * renders the same on the server and inside the embed's client component.
 */
export function DoughnutCredit({ text, newTab = false }: { text: string; newTab?: boolean }) {
  return rich(text, {
    license: (
      <a
        className="underline"
        href={DOUGHNUT_LICENSE_URL}
        rel="license noreferrer"
        hrefLang="en"
        target={newTab ? '_blank' : undefined}
      >
        CC BY-SA 4.0
      </a>
    ),
    book: (
      <cite lang="en" className="not-italic">
        Doughnut Economics
      </cite>
    ),
    method: (
      <cite lang="en" className="not-italic">
        Creating City Portraits
      </cite>
    ),
  });
}
