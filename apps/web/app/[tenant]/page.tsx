import { Doughnut, type DoughnutDimension } from '@/components/doughnut/Doughnut';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { mockTenant } from '@/lib/mock-data';
import { notFound } from 'next/navigation';

export default async function TenantPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;

  if (tenant !== mockTenant.slug) {
    notFound();
  }

  const social: DoughnutDimension[] = mockTenant.dimensions
    .filter((d) => d.ring === 'social')
    .map((d) => ({ ring: d.ring, slug: d.slug, name: d.name, viz_level: d.viz_level }));

  const ecological: DoughnutDimension[] = mockTenant.dimensions
    .filter((d) => d.ring === 'ecological')
    .map((d) => ({ ring: d.ring, slug: d.slug, name: d.name, viz_level: d.viz_level }));

  return (
    <>
      <SiteHeader variant="tenant" tenant={{ slug: mockTenant.slug, name: mockTenant.name }} />
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header>
        <h1 className="text-3xl font-bold">{mockTenant.name}</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          {mockTenant.region} · pop. {mockTenant.population.toLocaleString()}
        </p>
        <p className="mt-4 max-w-2xl">{mockTenant.description}</p>
      </header>

      <section className="mt-10 flex justify-center">
        <Doughnut social={social} ecological={ecological} size={720} />
      </section>

      <p className="mt-6 text-center text-sm text-[color:var(--color-muted)]">
        Click a segment for details. Mock data — real data lands once Supabase is wired up.
      </p>
    </main>
    </>
  );
}
