import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { OutreachContactsEditor } from '@/components/admin/OutreachContactsEditor';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { outreachContactsForAdmin } from '@/lib/portrait-management';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{tenant:string}>}):Promise<Metadata>{return adminPageMetadata((await params).tenant,'Outreach contacts');}
export default async function Page({params}:{params:Promise<{tenant:string}>}){
 const {tenant}=await params; const ctx=await requireAdminPage(tenant,'editor',`/${tenant}/admin/outreach`);const contacts=await outreachContactsForAdmin(ctx.tenant.id);
 return <><SiteHeader variant="admin" tenant={{slug:ctx.tenant.slug,name:ctx.tenant.name}}/><main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6"><Link className="text-sm underline" href={`/${tenant}/admin`}>← Admin</Link><h1 className="mt-3 text-2xl font-bold">Outreach contacts</h1><p className="mt-2 text-sm text-[color:var(--color-muted)]">Maintain the organizations listed on the public Get involved page. Save drafts, publish a reviewed version, or archive a contact while preserving its history.</p><OutreachContactsEditor tenantSlug={tenant} contacts={contacts.map(c=>({id:c.id,archived:Boolean(c.archivedAt),publishedVersionId:c.publishedVersionId,versions:c.versions.map(v=>({id:v.id,versionNum:v.versionNum,data:v.data}))}))}/></main></>;
}
