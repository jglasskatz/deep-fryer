import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitDoughnut } from '@/components/doughnut/PortraitDoughnut';
import { getPortrait, hasDatabase } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const portrait = await getPortrait(tenant);
  if (!portrait) notFound();

  return (
    <>
      <SiteHeader
        variant="tenant"
        tenant={{ slug: portrait.tenant.slug, name: portrait.tenant.name }}
      />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <header>
          <h1 className="text-3xl font-bold">{portrait.tenant.name}</h1>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {portrait.tenant.region}
            {portrait.tenant.population
              ? ` · pop. ${portrait.tenant.population.toLocaleString()}`
              : null}
          </p>
          {portrait.tenant.description ? (
            <p className="mt-4 max-w-2xl">{portrait.tenant.description}</p>
          ) : null}
        </header>

        <section className="mt-10 flex justify-center">
          <PortraitDoughnut
            tenantSlug={portrait.tenant.slug}
            dimensions={portrait.dimensions}
            size={720}
          />
        </section>

        <p className="mt-6 text-center text-sm text-[color:var(--color-muted)]">
          {hasDatabase()
            ? 'Click a segment for indicators, evidence, actions, and discussion.'
            : 'Demo data — set DATABASE_URL and publish versions for real content.'}
        </p>

        <nav className="mt-4 text-center text-sm">
          <a className="underline" href={`/${portrait.tenant.slug}/methodology`}>
            Methodology
          </a>
          <span className="mx-2 text-[color:var(--color-muted)]">·</span>
          <a className="underline" href={`/${portrait.tenant.slug}/sources`}>
            Sources
          </a>
          <span className="mx-2 text-[color:var(--color-muted)]">·</span>
          <a className="underline" href={`/${portrait.tenant.slug}/progress`}>
            Progress
          </a>
          <span className="mx-2 text-[color:var(--color-muted)]">·</span>
          <a className="underline" href={`/${portrait.tenant.slug}/outreach`}>
            Get involved
          </a>
        </nav>
      </main>
    </>
  );
}
