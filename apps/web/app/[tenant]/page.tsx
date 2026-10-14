import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { getPortrait, hasDatabase } from '@/lib/data';
import { localizeDimensions } from '@/lib/i18n/content';
import { fmt } from '@/lib/i18n/format';
import { doughnutLabels } from '@/lib/i18n/doughnut';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const [portrait, { m, href }] = await Promise.all([getPortrait(tenant), getI18n()]);
  if (!portrait) notFound();

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-12">
        <header>
          <h1 className="text-3xl font-bold">{portrait.tenant.name}</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            <span lang="en">{portrait.tenant.region}</span>
            {portrait.tenant.population
              ? ` · ${fmt(m.portrait.population, { n: portrait.tenant.population.toLocaleString('en-US') })}`
              : null}
          </p>
          {portrait.tenant.description ? (
            <p lang="en" className="mt-4 max-w-2xl">
              {portrait.tenant.description}
            </p>
          ) : null}
        </header>

        <section className="mt-10 flex justify-center">
          <PortraitDoughnut
            tenantSlug={portrait.tenant.slug}
            tenantName={portrait.tenant.name}
            dimensions={localizeDimensions(m, portrait.dimensions)}
            labels={doughnutLabels(m)}
            linkBase={`${href(`/${portrait.tenant.slug}`)}/dim`}
            size={720}
          />
        </section>

        <p className="mt-6 text-center text-sm text-[color:var(--color-muted)]">
          {hasDatabase() ? m.portrait.clickHint : m.portrait.demoHint}
        </p>

        <nav className="mt-4 text-center text-sm">
          <a className="underline" href={href(`/${portrait.tenant.slug}/methodology`)}>
            {m.nav.methodology}
          </a>
          <span className="mx-2 text-[color:var(--color-muted)]">·</span>
          <a className="underline" href={href(`/${portrait.tenant.slug}/outreach`)}>
            {m.nav.getInvolved}
          </a>
        </nav>
      </main>
    </>
  );
}
