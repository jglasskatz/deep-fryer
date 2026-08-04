import { notFound } from 'next/navigation';
import { EmbedFrame } from '@/components/embed/EmbedFrame';
import { getPortrait, tenantEmbedOrigins } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Embed view (SPEC.md §10): iframe target for the loader script. The parent
 * origin (passed by the loader) is checked against the tenant's
 * embed_origins allowlist; disallowed origins get a notice, not the data.
 */
export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ origin?: string }>;
}) {
  const { tenant } = await params;
  const { origin } = await searchParams;

  const [portrait, allowedOrigins] = await Promise.all([
    getPortrait(tenant),
    tenantEmbedOrigins(tenant),
  ]);
  if (!portrait) notFound();

  const parentOrigin = origin ?? null;
  const originAllowed =
    !parentOrigin ||
    allowedOrigins.length === 0 ||
    allowedOrigins.includes(parentOrigin);

  if (!originAllowed) {
    return (
      <main className="p-6 text-center text-sm text-black/60">
        This site is not authorized to embed the {portrait.tenant.name} portrait.
      </main>
    );
  }

  const hostBase = process.env.NEXT_PUBLIC_APP_URL ?? '';

  return (
    <main>
      <EmbedFrame
        tenantSlug={tenant}
        dimensions={portrait.dimensions}
        parentOrigin={parentOrigin}
        hostBase={hostBase}
      />
    </main>
  );
}
