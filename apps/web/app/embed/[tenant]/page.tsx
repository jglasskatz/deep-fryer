export default async function EmbedPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold">Embed view</h1>
      <p className="text-sm text-[color:var(--color-muted)]">Tenant: {tenant}</p>
    </main>
  );
}
