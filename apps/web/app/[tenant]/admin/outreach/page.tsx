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
 // Printing gives the contact list alone: the site header (a display:
 // contents wrapper, so it stays sticky on screen), the way back and the
 // editing form are left out, and the editor opens every contact.
 return <><div className="contents print:hidden"><SiteHeader variant="admin" tenant={{slug:ctx.tenant.slug,name:ctx.tenant.name}}/></div><main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6 print:max-w-none print:px-0 print:py-0"><Link className="text-sm underline print:hidden" href={`/${tenant}/admin`}>← Admin</Link><h1 className="mt-3 text-2xl font-bold">Outreach contacts<span className="hidden print:inline"> · {ctx.tenant.name}</span></h1><p className="mt-2 text-sm text-[color:var(--color-muted)] print:hidden">Maintain the organizations listed on the public Get involved page. Save drafts, publish a reviewed version, or archive a contact while preserving its history.</p><OutreachContactsEditor tenantSlug={tenant} contacts={contacts.map(c=>({id:c.id,archived:Boolean(c.archivedAt),publishedVersionId:c.publishedVersionId,versions:c.versions.map(v=>({id:v.id,versionNum:v.versionNum,data:v.data}))}))}/></main></>;
}
