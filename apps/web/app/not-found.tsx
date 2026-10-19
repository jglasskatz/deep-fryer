import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getI18n, getRequestPath } from '@/lib/i18n/server';

/**
 * "Page not found", in the language of the URL that missed, rather than the
 * site's generic title. No canonical and no hreflang list: the root layout
 * names the requested path for a page that exists in every language, which
 * for a missing page would point search engines at the miss. (Next adds
 * noindex to every 404 itself.)
 */
export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.notFound.title, alternates: null };
}

/**
 * 404 in the language of the URL that missed (/es/… → Spanish), with the
 * site's header and — from the root layout — its footer, so a reader who
 * followed a dead link still has the way home, the contact address and the
 * rest of the site around them. The product header, not a portrait's: the
 * missing page may name no portrait at all, and a portrait's header would
 * offer to request a translation of one that does not exist. A missing
 * embed gets neither header nor footer: it is shown inside a city's page.
 */
export default async function NotFound() {
  const [{ m }, path] = await Promise.all([getI18n(), getRequestPath()]);
  return (
    <>
      {path.startsWith('/embed/') ? null : <SiteHeader variant="landing" />}
      <main id="main" className="mx-auto max-w-lg px-4 py-20 sm:px-6">
        <p aria-hidden className="text-4xl">
          🍩
        </p>
        <h1 className="mt-4 text-2xl font-bold">{m.notFound.title}</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">{m.notFound.body}</p>
        <p className="mt-6">
          <Link className="underline" href="/">
            {m.notFound.home}
          </Link>
        </p>
      </main>
    </>
  );
}
