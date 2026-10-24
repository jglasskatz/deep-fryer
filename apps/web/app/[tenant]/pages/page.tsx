import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { publishedCustomPages } from '@/lib/custom-pages';
import { getPublicPortrait } from '@/lib/data';
import { getI18n } from '@/lib/i18n/server';
import { pageTitle } from '@/lib/page-meta';
import { requireFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const portrait = await getPublicPortrait((await params).tenant);
  return { title: pageTitle('Pages', portrait?.tenant.name ?? '') };
}

export default async function PagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  await requireFeature(tenant, 'custom_pages');
  const [portrait, pages, { href }] = await Promise.all([getPublicPortrait(tenant), publishedCustomPages(tenant), getI18n()]);
  if (!portrait) notFound();
  return <>
    <SiteHeader variant="tenant" tenant={{ slug: tenant, name: portrait.tenant.name }} />
    <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link className="underline" href={href(`/${tenant}`)}>← {portrait.tenant.name}</Link>
      <h1 className="mt-3 text-3xl font-bold" lang="en">Pages</h1>
      {pages.length ? <ul className="mt-6" lang="en">{pages.map(page => <li key={page.slug} className="border-b border-black/10">
        <Link className="block min-h-11 py-4 text-lg underline" href={href(`/${tenant}/pages/${page.slug}`)}>{page.title}</Link>
      </li>)}</ul> : <p className="mt-6" lang="en">No additional pages have been published.</p>}
    </main>
  </>;
}
