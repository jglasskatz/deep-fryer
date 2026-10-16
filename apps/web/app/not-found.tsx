import type { Metadata } from 'next';
import Link from 'next/link';
import { getI18n } from '@/lib/i18n/server';

/** "Page not found", in the language of the URL that missed, rather than the site's generic title. */
export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.notFound.title };
}

/** 404 in the language of the URL that missed (/es/… → Spanish). */
export default async function NotFound() {
  const { m } = await getI18n();
  return (
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
  );
}
