import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header/SiteHeader';

/**
 * The frame of the site's own statements — the accessibility statement and
 * the privacy notice: the product header, one readable column, and a first
 * line saying who answers for the page and which software it describes. In
 * English, like the product's other pages; lang is set on the column as
 * well as on <html>, because these pages are linked from every translated
 * page's footer.
 */
export function LegalPage({ title, preface, children }: { title: string; preface: ReactNode; children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="landing" />
      <main id="main" lang="en" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-[color:var(--color-muted)]">{preface}</p>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
    </>
  );
}

/** One titled part of a statement; `id` makes it linkable (/privacy#cookies). */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} className="scroll-mt-20">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
        {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:ps-5">
        {children}
      </div>
    </section>
  );
}

/** The support address as a link, or the fallback words when the operator has not set one (development only). */
export function SupportLink({ email, fallback }: { email: string | null; fallback: string }) {
  return email ? (
    <a className="underline [overflow-wrap:anywhere]" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <>{fallback}</>
  );
}
