import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminListSources, adminSearchSources } from '@/lib/source-data';

export const dynamic = 'force-dynamic';

/**
 * Admin source search: full-text over the whole corpus, all tiers (the
 * tiered redaction applies only to the public pages). websearch syntax:
 * quoted phrases, -exclusions, OR.
 */
export default async function AdminSourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenant } = await params;
  const { q } = await searchParams;
  const ctx = await requireAdminPage(tenant, 'viewer');

  const hits = q?.trim() ? await adminSearchSources(ctx.tenant.id, q.trim()) : null;
  const all = hits === null ? await adminListSources(ctx.tenant.id) : null;

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Source library</h1>
        <form className="mt-4 flex gap-2" action={`/${tenant}/admin/sources`} method="get">
          <input
            className="flex-1 rounded border border-black/20 px-3 py-1.5 text-sm"
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder={'Search the archived corpus — "exact phrase", -exclude, OR'}
          />
          <button className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white">
            Search
          </button>
        </form>

        {hits ? (
          <>
            <p className="mt-4 text-xs text-[color:var(--color-muted)]">
              {hits.length} result{hits.length === 1 ? '' : 's'} ranked by relevance.
            </p>
            <ul className="mt-2 space-y-3">
              {hits.map(({ source: s, headline }) => (
                <li key={s.id} className="rounded-lg border border-black/15 p-3 text-sm">
                  <p className="font-medium">
                    <Link className="underline" href={`/${tenant}/sources/${s.id}`}>
                      {s.title || s.url || 'Untitled source'}
                    </Link>
                  </p>
                  <p
                    className="mt-1 text-xs [&_mark]:bg-yellow-200"
                    // ts_headline output: source text with <mark> tags we configured.
                    dangerouslySetInnerHTML={{ __html: headline }}
                  />
                  <p className="mt-1 text-[11px] text-[color:var(--color-muted)]">
                    {s.sourceTier ? `tier ${s.sourceTier} · ` : 'uncited · '}
                    {s.mediaType} · archived {s.capturedAt.toISOString().slice(0, 10)} ·{' '}
                    {s.extraction}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mt-4 text-xs text-[color:var(--color-muted)]">
              {all!.length} archived source{all!.length === 1 ? '' : 's'} — captures become rows
              here automatically; tiers fill in when findings cite them.
            </p>
            <ul className="mt-2 space-y-2">
              {all!.map((s) => (
                <li key={s.id} className="rounded border border-black/15 p-2 text-sm">
                  <Link className="underline" href={`/${tenant}/sources/${s.id}`}>
                    {s.title || s.url || 'Untitled source'}
                  </Link>
                  <span className="ml-2 text-[11px] text-[color:var(--color-muted)]">
                    {s.sourceTier ? `tier ${s.sourceTier}` : 'uncited'} ·{' '}
                    {s.text ? 'text' : 'snapshot only'} · {s.capturedAt.toISOString().slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
