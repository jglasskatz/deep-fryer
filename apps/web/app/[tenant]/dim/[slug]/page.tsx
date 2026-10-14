import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { Thread } from '@/components/discussion/Thread';
import { evidenceUrl, getPortrait, hasDatabase } from '@/lib/data';
import { dimensionForPublicSlug, dimensionThread } from '@/lib/discussion';
import { getAuth, getRole, roleAtLeast } from '@/lib/auth';
import { safeHref } from '@/lib/safe-url';
import { formatIndicatorValue } from '@deep-fryer/core';

export const dynamic = 'force-dynamic';

/**
 * The public drilldown (SPEC.md §10): value, target, plain-language context,
 * evidence snapshot beside each claim, actions, and the dimension's
 * discussion thread. No AI chrome anywhere.
 */
export default async function DimensionDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; slug: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { tenant, slug } = await params;
  const { sort: sortRaw } = await searchParams;
  const sort = sortRaw === 'new' ? 'new' : 'top';

  const [portrait, resolved, auth] = await Promise.all([
    getPortrait(tenant),
    hasDatabase() ? dimensionForPublicSlug(tenant, slug) : Promise.resolve(null),
    getAuth(),
  ]);
  if (!portrait) notFound();
  const dim = portrait.dimensions.find((d) => d.slug === slug);
  if (!dim) notFound();
  const data = dim.data;

  let thread = null;
  let isModerator = false;
  const viewerId = auth.userId;
  const canPost = Boolean(auth.userId) || auth.devMode;
  const dimensionId = resolved?.dimension.id ?? null;
  if (resolved) {
    const [role, threadResult] = await Promise.all([
      getRole(resolved.tenant.id),
      dimensionThread(resolved.tenant.id, resolved.dimension.id, viewerId, sort),
    ]);
    isModerator = roleAtLeast(role, 'moderator');
    thread = threadResult;
  }

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main id="main" className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}`}>
            ← {portrait.tenant.name}
          </Link>
        </p>
        <h1 className="mt-2 text-3xl font-bold">{data.name}</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          {dim.ring === 'social' ? 'Social foundation' : 'Ecological ceiling'}
          {dim.published_at ? ` · updated ${dim.published_at.slice(0, 10)}` : ''}
        </p>

        {data.context ? <p className="mt-5 max-w-prose">{data.context}</p> : null}

        <section className="mt-8 space-y-5">
          {data.indicators.map((ind, i) => (
            <div key={i} className="rounded-lg border border-black/15 p-4">
              <h2 className="font-semibold">{ind.name}</h2>
              <p className="mt-2 text-2xl font-bold">
                {ind.value === null || ind.value === '' ? (
                  <span className="text-base font-normal">No data</span>
                ) : (
                  formatIndicatorValue(ind.value, ind.unit)
                )}
              </p>
              <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                {ind.year ? `${ind.year} · ` : ''}
                {ind.target !== null ? `target: ${formatIndicatorValue(ind.target, ind.unit)}` : 'no target set'}
                {ind.geographic_scale ? ` · ${ind.geographic_scale} data` : ''}
              </p>
              {ind.source ? (
                <p className="mt-2 text-sm">
                  Source:{' '}
                  {safeHref(ind.source_url) ? (
                    <a className="underline" href={safeHref(ind.source_url)} target="_blank" rel="noreferrer">
                      {ind.source}
                    </a>
                  ) : (
                    ind.source
                  )}
                </p>
              ) : null}
              {ind.evidence ? (
                <figure className="mt-3">
                  <a
                    href={evidenceUrl(tenant, ind.evidence.snapshot_path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={evidenceUrl(tenant, ind.evidence.snapshot_path)}
                      alt={`Snapshot of the source for ${ind.name}, captured ${ind.evidence.captured_at.slice(0, 10)}`}
                      className="max-h-56 rounded border border-black/15"
                    />
                  </a>
                  <figcaption className="mt-1 text-xs text-[color:var(--color-muted)]">
                    Source snapshot captured {ind.evidence.captured_at.slice(0, 10)}
                    {ind.evidence.pdf_path ? (
                      <>
                        {' · '}
                        <a
                          className="underline"
                          href={evidenceUrl(tenant, ind.evidence.pdf_path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          original document
                        </a>
                      </>
                    ) : null}
                  </figcaption>
                </figure>
              ) : null}
            </div>
          ))}

          {(data.gaps ?? []).map((gap, i) => (
            <div
              key={`gap-${i}`}
              className="rounded-lg border border-dashed border-black/25 bg-black/[0.02] p-4"
            >
              <h2 className="font-semibold">Data gap</h2>
              <p className="mt-1 text-sm">{gap.reason}</p>
              {gap.scales_tried.length ? (
                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                  Searched at: {gap.scales_tried.join(', ')} scale
                </p>
              ) : null}
            </div>
          ))}
        </section>

        {data.actions.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">What you can do</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {data.actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {dimensionId && thread !== null ? (
          <Thread
            tenantSlug={tenant}
            dimensionId={dimensionId}
            comments={thread}
            viewerId={viewerId}
            canPost={canPost}
            isModerator={isModerator}
            sort={sort}
          />
        ) : null}
      </main>
    </>
  );
}
