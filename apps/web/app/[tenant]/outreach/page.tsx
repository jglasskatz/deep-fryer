import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getPortrait, publishedOutreachContacts } from '@/lib/data';
import { fmt } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

export default async function OutreachPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const [portrait, contacts, { m, href }] = await Promise.all([
    getPortrait(tenant),
    publishedOutreachContacts(tenant),
    getI18n(),
  ]);
  if (!portrait) notFound();

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main id="main" className="mx-auto max-w-3xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={href(`/${tenant}`)}>
            {fmt(m.common.back, { name: portrait.tenant.name })}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{m.outreach.title}</h1>
        {contacts.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--color-muted)]">{m.outreach.empty}</p>
        ) : (
          <ul lang="en" className="mt-6 space-y-4">
            {contacts.map((c, i) => (
              <li key={i} className="rounded border border-black/15 p-4">
                <h2 className="font-semibold">
                  {/* Published outreach comes from research and staff edits: only
                      http(s) links render (safeHref), never javascript: or data:. */}
                  {safeHref(c.website) ? (
                    <a className="underline" href={safeHref(c.website)} target="_blank" rel="noreferrer">
                      {c.org}
                    </a>
                  ) : (
                    c.org
                  )}
                </h2>
                {c.why ? <p className="mt-1 text-sm">{c.why}</p> : null}
                {c.tags.length ? (
                  <p className="mt-2 text-xs text-[color:var(--color-muted)]">
                    {c.tags.join(' · ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
