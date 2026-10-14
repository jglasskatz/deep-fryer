import Link from 'next/link';
import { notFound } from 'next/navigation';
import { framework, getThreshold } from '@deep-fryer/contract';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { adminTenant, tenantConfigMap } from '@/lib/admin-data';
import { getPortrait, hasDatabase } from '@/lib/data';
import { dimensionLabel } from '@/lib/i18n/content';
import { fmt, fmtPlural, rich } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';

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
  const [portrait, { m, locale, href }] = await Promise.all([getPortrait(tenant), getI18n()]);
  if (!portrait) notFound();

  let config: Awaited<ReturnType<typeof tenantConfigMap>> = {};
  if (hasDatabase()) {
    const t = await adminTenant(tenant);
    if (t) config = await tenantConfigMap(t.id);
  }

  const overrides = config.threshold_overrides ?? {};
  const refreshed = portrait.dimensions
    .filter((d) => d.published_at)
    .map((d) => ({ name: dimensionLabel(m, d.slug, d.data.name), at: d.published_at!.slice(0, 10) }));

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
        <h1 className="mt-2 text-3xl font-bold">{m.methodology.title}</h1>
        <p className="mt-3 max-w-prose text-sm">{m.methodology.intro}</p>

        {config.region ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">{m.methodology.geography}</h2>
            <p lang="en" className="mt-2 text-sm">
              {config.region.definition}
            </p>
          </section>
        ) : null}

        {config.source_priority ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">{m.methodology.sourcePriority}</h2>
            <p className="mt-1 text-sm text-[color:var(--color-muted)]">{m.methodology.sourcePriorityIntro}</p>
            <ol lang="en" className="mt-3 list-decimal space-y-1 ps-5 text-sm">
              {config.source_priority.tiers.map((t) => (
                <li key={t.tier}>
                  <span className="font-medium">{t.name}</span> — {t.description}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {config.recency ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">{m.methodology.recency}</h2>
            <p className="mt-2 text-sm">
              {fmtPlural(locale, m.methodology.recencyText, config.recency.default_max_age_years)}
            </p>
          </section>
        ) : null}

        <section className="mt-8">
          <h2 className="text-lg font-semibold">{m.methodology.targets}</h2>
          {locale !== 'en' ? (
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">{m.methodology.contentInEnglish}</p>
          ) : null}
          <div className="mt-3 space-y-4">
            {framework.dimensions.map((dim) => (
              <div key={dim.slug}>
                <h3 className="text-sm font-semibold">{dimensionLabel(m, dim.slug, dim.name)}</h3>
                <ul className="mt-1 space-y-2 text-sm">
                  {dim.indicators.map((ind) => {
                    const base = getThreshold(ind.threshold_ref);
                    const override = overrides[ind.threshold_ref];
                    if (!base && !override) return null;
                    return (
                      <li key={ind.slug} className="rounded border border-black/10 p-2">
                        <span lang="en" className="font-medium">
                          {ind.name}
                        </span>
                        {' — '}
                        {rich(m.methodology.target, {
                          value: <bdi lang="en">{`${override?.target ?? base?.target} ${ind.unit}`}</bdi>,
                        })}
                        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                          {override ? (
                            rich(m.methodology.localTarget, { rationale: <span lang="en">{override.rationale}</span> })
                          ) : (
                            <span lang="en">{base?.rationale}</span>
                          )}
                        </p>
                        {override && base ? (
                          <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                            {rich(m.methodology.frameworkDefault, {
                              target: <bdi>{base.target}</bdi>,
                              rationale: <span lang="en">{base.rationale}</span>,
                            })}
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
            <h2 className="text-lg font-semibold">{m.methodology.lastRefreshed}</h2>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
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
