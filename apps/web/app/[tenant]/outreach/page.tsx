import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getPortrait, publishedOutreachContacts } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function OutreachPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const [portrait, contacts] = await Promise.all([
    getPortrait(tenant),
    publishedOutreachContacts(tenant),
  ]);
  if (!portrait) notFound();

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}`}>
            ← {portrait.tenant.name}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">Get involved</h1>
        {contacts.length === 0 ? (
          <p className="mt-4 text-sm text-[color:var(--color-muted)]">
            Local organizations will be listed here as the portrait grows. In the meantime, each
            dimension page lists concrete actions.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {contacts.map((c, i) => (
              <li key={i} className="rounded border border-black/15 p-4">
                <h2 className="font-semibold">
                  {c.website ? (
                    <a className="underline" href={c.website} target="_blank" rel="noreferrer">
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
