export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold">Admin (auth coming)</h1>
      <p className="mt-2 text-[color:var(--color-muted)]">Tenant: {tenant}</p>
    </main>
  );
}
