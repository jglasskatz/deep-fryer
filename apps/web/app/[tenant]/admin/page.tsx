import { SiteHeader } from '@/components/site-header/SiteHeader';
import { getPortrait } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const portrait = await getPortrait(tenant);
  const name = portrait?.tenant.name ?? tenant;
  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: tenant, name }} />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">
          Review queue, versions, and settings land with M1/M4. Tenant: <code>{tenant}</code>
        </p>
      </main>
    </>
  );
}
