import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { hasDatabase } from '@/lib/data';
import { publicBibliography } from '@/lib/source-data';

export const dynamic = 'force-dynamic';

/**
 * The public bibliography (SPEC.md §10): every source cited by the published
 * portrait, with its archived capture. Tier-1/2 sources open to full text;
 * others to a quote-anchored excerpt beside the snapshot.
 */
export default async function SourcesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  if (!hasDatabase()) notFound();
  const bib = await publicBibliography(tenant);
  if (!bib) notFound();

  const total = bib.groups.reduce((n, g) => n + g.sources.length, 0);

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: bib.portrait.tenant.slug, name: bib.portrait.tenant.name }} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}`}>
            ← {bib.portrait.tenant.name}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Source library</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          Every claim on this portrait cites a source that was archived at the moment it was read —
          {` ${total} source${total === 1 ? '' : 's'}`} across {bib.groups.length} dimensions.
          Government sources open to their full archived text; other sources show the cited passage
          in context. See also the{' '}
          <Link className="underline" href={`/${tenant}/methodology`}>
            methodology
          </Link>
          .
        </p>

        {bib.groups.map((g) => (
          <section key={g.dimensionSlug} className="mt-8">
            <h2 className="text-lg font-semibold">
              <Link className="hover:underline" href={`/${tenant}/dim/${g.dimensionSlug}`}>
                {g.dimensionName}
              </Link>
            </h2>
            <ul className="mt-2 space-y-2">
              {g.sources.map((s) => (
                <li key={s.id} className="rounded-lg border border-black/15 p-3 text-sm">
                  <p className="font-medium">
                    <Link className="underline" href={`/${tenant}/sources/${s.id}`}>
                      {s.title || s.url || 'Untitled source'}
                    </Link>
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                    {s.sourceTier ? `tier ${s.sourceTier} · ` : ''}
                    archived {s.capturedAt.toISOString().slice(0, 10)}
                    {s.text ? ' · text extracted' : ' · snapshot only'}
                    {s.url ? (
                      <>
                        {' · '}
                        <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                          live source
                        </a>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {bib.groups.length === 0 ? (
          <p className="mt-8 text-sm text-[color:var(--color-muted)]">
            No archived sources yet — they appear as research runs are approved and published.
          </p>
        ) : null}
      </main>
    </>
  );
}
