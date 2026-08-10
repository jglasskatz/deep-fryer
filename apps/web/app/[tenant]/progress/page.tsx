import Link from 'next/link';
import { notFound } from 'next/navigation';
import { diffPortraits } from '@deep-fryer/core';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { DeltaTable } from '@/components/progress/DeltaTable';
import { hasDatabase } from '@/lib/data';
import { progressEras } from '@/lib/progress-data';

export const dynamic = 'force-dynamic';

/**
 * The doughnut evolving over time (SPEC.md §10): reconstructed snapshots of
 * the published portrait side by side, with a vintage-honest delta table —
 * progress claims come from new data, revisions are labeled as revisions.
 */
export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ at?: string }>;
}) {
  const { tenant } = await params;
  const { at } = await searchParams;
  if (!hasDatabase()) notFound();
  const eras = await progressEras(tenant, at);
  if (eras === null) notFound();

  const name = eras[0]?.portrait.tenant.name ?? tenant;
  const first = eras[0];
  const last = eras[eras.length - 1];
  const deltas =
    eras.length >= 2 ? diffPortraits(first!.portrait.dimensions, last!.portrait.dimensions) : [];

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: tenant, name }} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}`}>
            ← {name}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Progress</h1>
        <p className="mt-2 max-w-prose text-sm text-[color:var(--color-muted)]">
          The portrait as it was published at each point in time — every snapshot is
          reconstructed exactly from the immutable version history. Wedges outside the safe zone
          are counted under each doughnut.
        </p>

        {eras.length < 2 ? (
          <p className="mt-8 rounded-lg border border-dashed border-black/25 p-4 text-sm text-[color:var(--color-muted)]">
            History begins with the next publish — this portrait has {eras.length === 0 ? 'no' : 'one'}{' '}
            published snapshot so far. As research refreshes land, each era appears here side by
            side.
          </p>
        ) : (
          <>
            <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
              {eras.map((era) => {
                const outside = era.portrait.dimensions.filter((d) => (d.viz_level ?? 0) > 0).length;
                return (
                  <figure key={era.label} className="text-center">
                    <PortraitDoughnut
                      tenantSlug={tenant}
                      dimensions={era.portrait.dimensions}
                      size={210}
                    />
                    <figcaption className="mt-1 text-xs">
                      <span className="font-medium">{era.label}</span>
                      <span className="block text-[color:var(--color-muted)]">
                        {outside}/{era.portrait.dimensions.length} wedges outside the safe zone
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>

            <div className="mt-10">
              <DeltaTable deltas={deltas} fromLabel={first!.label} toLabel={last!.label} />
            </div>
          </>
        )}
      </main>
    </>
  );
}
