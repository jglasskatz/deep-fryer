import Link from 'next/link';
import { notFound } from 'next/navigation';
import { framework, getThreshold } from '@deep-fryer/contract';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { adminTenant, tenantConfigMap } from '@/lib/admin-data';
import { getPortrait, hasDatabase } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * The public methodology page (SPEC.md §10): auto-generated from config —
 * thresholds with rationales, overrides with their required rationales,
 * source-priority tiers, last-refreshed dates. Config *is* the methodology.
 */
export default async function MethodologyPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const portrait = await getPortrait(tenant);
  if (!portrait) notFound();

  let config: Awaited<ReturnType<typeof tenantConfigMap>> = {};
  if (hasDatabase()) {
    const t = await adminTenant(tenant);
    if (t) config = await tenantConfigMap(t.id);
  }

  const overrides = config.threshold_overrides ?? {};
  const refreshed = portrait.dimensions
    .filter((d) => d.published_at)
    .map((d) => ({ name: d.data.name, at: d.published_at!.slice(0, 10) }));

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
        <h1 className="mt-2 text-3xl font-bold">Methodology</h1>
        <p className="mt-3 max-w-prose text-sm">
          This portrait follows the Doughnut Economics downscaling approach: a social foundation
          (falling short is a shortfall, drawn toward the center) and an ecological ceiling
          (exceeding it is an overshoot, drawn outward). Every indicator has an explicit target
          with a written rationale, listed below. Where this portrait uses a target different
          from the framework default, the local rationale is shown.
        </p>

        {config.region ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Geography</h2>
            <p className="mt-2 text-sm">{config.region.definition}</p>
          </section>
        ) : null}

        {config.source_priority ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Source priority</h2>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">
              Data is accepted from the highest-priority tier available; a lower tier is used
              only when every higher tier has been exhausted.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {config.source_priority.tiers.map((t) => (
                <li key={t.tier}>
                  <span className="font-medium">{t.name}</span> — {t.description}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-sm">
              Every cited source is archived at the moment it was read — browse the{' '}
              <Link className="underline" href={`/${tenant}/sources`}>
                source library
              </Link>
              .
            </p>
          </section>
        ) : null}

        {config.recency ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Recency</h2>
            <p className="mt-2 text-sm">
              Data older than {config.recency.default_max_age_years} years is treated as a data
              gap rather than reported as current.
            </p>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">Targets & rationales</h2>
          <div className="mt-3 space-y-4">
            {framework.dimensions.map((dim) => (
              <div key={dim.slug}>
                <h3 className="text-sm font-semibold">{dim.name}</h3>
                <ul className="mt-1 space-y-2 text-sm">
                  {dim.indicators.map((ind) => {
                    const base = getThreshold(ind.threshold_ref);
                    const override = overrides[ind.threshold_ref];
                    if (!base && !override) return null;
                    return (
                      <li key={ind.slug} className="rounded border border-black/10 p-2">
                        <span className="font-medium">{ind.name}</span>
                        {' — target '}
                        {override?.target ?? base?.target} {ind.unit}
                        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                          {override
                            ? `Local target: ${override.rationale}`
                            : base?.rationale}
                        </p>
                        {override && base ? (
                          <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                            Framework default was {base.target}: {base.rationale}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {refreshed.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">Last refreshed</h2>
            <p className="mt-1 text-sm">
              See how the portrait has changed over time on the{' '}
              <Link className="underline" href={`/${tenant}/progress`}>
                progress page
              </Link>
              .
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {refreshed.map((r) => (
                <li key={r.name} className="flex justify-between">
                  <span>{r.name}</span>
                  <span className="text-[color:var(--color-muted)]">{r.at}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </>
  );
}
