import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { DimensionEditor } from '@/components/admin/DimensionEditor';
import { dimensionById, versionTimeline } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { hasDatabase } from '@/lib/env';
import { en } from '@/lib/i18n/messages/en';
import { adminPageMetadata } from '@/lib/page-meta';
import { publishVersion } from '@/lib/actions';
import { ActionButton } from '@/components/admin/ActionButton';

export const dynamic = 'force-dynamic';

/**
 * "Housing · Admin · <portrait>" (WCAG 2.4.2), so a staff member editing
 * several dimensions can tell their tabs apart. The framework name from the
 * slug (the admin pages are English); a portrait's own dimension shows its
 * slug. dimensionById is a primary-key read under the reader's row security.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}): Promise<Metadata> {
  const { tenant, id } = await params;
  const dimension = hasDatabase() ? await dimensionById(id) : null;
  const name = dimension ? (en.dimensions[dimension.slug as keyof typeof en.dimensions] ?? dimension.slug) : 'Dimension';
  return adminPageMetadata(tenant, name);
}

export default async function DimensionAdminPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>;
}) {
  const { tenant, id } = await params;
  const ctx = await requireAdminPage(tenant, 'editor');

  const dimension = await dimensionById(id);
  if (!dimension || dimension.tenantId !== ctx.tenant.id) notFound();
  const versions = await versionTimeline(dimension.id);
  const latest = versions[0];
  if (!latest) notFound();

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          {latest.data.name}
          <span className="ml-2 text-sm font-normal text-[color:var(--color-muted)]">
            {dimension.ring} · {dimension.slug}
          </span>
        </h1>

        <div className="mt-8 grid grid-cols-[1fr_320px] gap-10">
          <section>
            <h2 className="text-lg font-semibold">Edit (creates a new version)</h2>
            <div className="mt-4">
              <DimensionEditor
                tenantSlug={tenant}
                dimensionId={dimension.id}
                initial={latest.data}
              />
            </div>
          </section>

          <aside>
            <h2 className="text-lg font-semibold">Version timeline</h2>
            <ul className="mt-4 space-y-3">
              {versions.map((v) => {
                const isPublished = dimension.publishedVersionId === v.id;
                return (
                  <li key={v.id} className="rounded border border-black/15 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">v{v.versionNum}</span>
                      <span
                        className={
                          isPublished
                            ? 'rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-900'
                            : 'rounded bg-black/5 px-1.5 py-0.5 text-xs'
                        }
                      >
                        {isPublished ? 'published' : v.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                      {v.origin}
                      {' · '}
                      {v.createdAt.toISOString().slice(0, 10)}
                      {v.vizLevel !== null ? ` · viz ${v.vizLevel}` : ''}
                    </p>
                    {v.changeNote ? <p className="mt-1 text-xs italic">“{v.changeNote}”</p> : null}
                    {!isPublished ? (
                      <div className="mt-2">
                        <ActionButton
                          action={publishVersion.bind(null, {
                            tenantSlug: tenant,
                            versionId: v.id,
                            revert: v.status === 'archived',
                          })}
                          pendingLabel="Publishing…"
                        >
                          {v.status === 'archived' ? 'Revert to this version' : 'Publish'}
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </main>
    </>
  );
}
