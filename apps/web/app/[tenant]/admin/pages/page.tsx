import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { CustomPagesEditor } from '@/components/admin/CustomPagesEditor';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { listCustomPagesForAdmin } from '@/lib/custom-pages';
import { requireFeature } from '@/lib/features';
export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Custom pages');
}
export default async function CustomPagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ctx = await requireAdminPage(tenant, 'editor');
  await requireFeature(tenant, 'custom_pages');
  const pages = await listCustomPagesForAdmin(ctx.tenant.id);
  return <><SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} /><main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
    <Link href={`/${tenant}/admin`} className="text-sm underline">← Admin</Link>
    <h1 className="mt-3 text-2xl font-bold">Custom pages</h1>
    <p className="mt-2 max-w-2xl text-sm text-[color:var(--color-muted)]">Share local plans, explain a project or add context to the portrait. Save a draft, review its content, then publish. Previous versions remain available for restoration.</p>
    <CustomPagesEditor tenantSlug={tenant} pages={pages.map(page => ({ ...page, versions: page.versions.map(version => ({ ...version, createdAt: version.createdAt.toISOString(), publishedAt: version.publishedAt?.toISOString() ?? null })) }))} />
  </main></>;
}
