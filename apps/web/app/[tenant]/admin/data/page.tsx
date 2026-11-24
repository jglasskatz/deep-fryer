import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { gridStateFromParams, gridStateQuery } from '@/components/admin/grid/grid-state';
import { tenantDimensions } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { roleAtLeast } from '@/lib/auth';
import { evidenceUrl } from '@/lib/data';
import { dimensionsWithoutRows, gridRows } from '@/lib/grid-data';
import { adminPageMetadata } from '@/lib/page-meta';
import { DataGridClient } from './DataGridClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Data');
}

/**
 * Every indicator of the portrait in one table, for any member: each
 * dimension's latest version, draft or published, one row per indicator,
 * with search, filters, sorting and a CSV download (components/admin/grid).
 * The search, filters and sort come from the address, so a filtered view
 * survives a reload and can be shared with another member.
 */
export default async function DataPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'viewer', `/${tenant}/admin/data`);
  const [dims, query] = await Promise.all([tenantDimensions(ctx.tenant.id), searchParams]);
  const rows = gridRows(dims, { evidenceHref: (path) => evidenceUrl(ctx.tenant.slug, path) });
  const initial = gridStateFromParams(query);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Data</h1>
        <p className="mt-2 max-w-3xl text-sm text-[color:var(--color-muted)]">
          Every indicator in this portrait, as it stands in each dimension&apos;s latest version, published or not.
          Search, filter and sort the table, or download it to read in a spreadsheet.
        </p>
        <DataGridClient
          // A link to another view of this page (another filter or sort) starts the table afresh from it.
          key={gridStateQuery(initial)}
          tenantSlug={ctx.tenant.slug}
          rows={rows}
          emptyDimensions={dimensionsWithoutRows(dims, rows)}
          dimensionCount={dims.length}
          canEdit={roleAtLeast(ctx.role, 'editor')}
          initial={initial}
        />
      </main>
    </>
  );
}
