import type { Metadata } from 'next';
import Link from 'next/link';
import { framework } from '@deep-fryer/contract';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { PortraitManagement } from '@/components/admin/PortraitManagement';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { portraitDimensionsForAdmin } from '@/lib/portrait-management';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{tenant:string}>}):Promise<Metadata>{return adminPageMetadata((await params).tenant,'Portrait content');}
export default async function Page({params}:{params:Promise<{tenant:string}>}){
 const {tenant}=await params; const ctx=await requireAdminPage(tenant,'owner',`/${tenant}/admin/manage`);
 const dimensions=await portraitDimensionsForAdmin(ctx.tenant.id);
 return <><SiteHeader variant="admin" tenant={{slug:ctx.tenant.slug,name:ctx.tenant.name}}/><main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6"><Link className="text-sm underline" href={`/${tenant}/admin`}>← Admin</Link><h1 className="mt-3 text-2xl font-bold">Portrait content</h1><p className="mt-2 text-sm text-[color:var(--color-muted)]">Manage the dimensions that make up this portrait. Content edits and publication remain versioned.</p><PortraitManagement tenantSlug={tenant} dimensions={dimensions.map(({id,slug,name,ring,canonicalSlug,archivedAt,indicatorCount,publishedVersionId})=>({id,slug,name,ring,canonicalSlug,archived:Boolean(archivedAt),indicatorCount,publishedVersionId}))} canonicalDimensions={framework.dimensions.map(({slug,name,ring})=>({slug,name,ring}))}/></main></>;
}
