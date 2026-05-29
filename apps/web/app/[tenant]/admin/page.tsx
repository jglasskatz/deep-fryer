import { SiteHeader } from '@/components/site-header/SiteHeader';
import { mockTenant } from '@/lib/mock-data';

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const name = tenant === mockTenant.slug ? mockTenant.name : tenant;
  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: tenant, name }} />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-3xl font-bold">Admin</h1>
        <p className="mt-2 text-[color:var(--color-muted)]">
          Auth + draft/publish editing land in M1. Tenant: <code>{tenant}</code>
        </p>
      </main>
    </>
  );
}
