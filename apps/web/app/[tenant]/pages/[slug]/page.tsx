import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { MarkdownContent } from '@/components/content/MarkdownContent';
import { publishedCustomPage } from '@/lib/custom-pages';
import { getPublicPortrait } from '@/lib/data';
import { getI18n } from '@/lib/i18n/server';
import { pageTitle } from '@/lib/page-meta';
import { requireFeature } from '@/lib/features';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ tenant: string; slug: string }> }): Promise<Metadata> {
  const { tenant, slug } = await params;
  const [portrait, page] = await Promise.all([getPublicPortrait(tenant), publishedCustomPage(tenant, slug)]);
  return { title: pageTitle(page?.title ?? 'Page', portrait?.tenant.name ?? '') };
}

export default async function CustomPage({ params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const { tenant, slug } = await params;
  await requireFeature(tenant, 'custom_pages');
  const [portrait, page, { href }] = await Promise.all([getPublicPortrait(tenant), publishedCustomPage(tenant, slug), getI18n()]);
  if (!portrait || !page) notFound();
  return <>
    <SiteHeader variant="tenant" tenant={{ slug: tenant, name: portrait.tenant.name }} />
    <main id="main" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Link className="underline" href={href(`/${tenant}/pages`)}>← {portrait.tenant.name}</Link>
      <article className="mt-5" lang="en">
        <h1 className="text-3xl font-bold">{page.title}</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">Version {page.versionNum} · Published {page.publishedAt?.toISOString().slice(0, 10)}</p>
        <div className="mt-6"><MarkdownContent body={page.mdxBody} /></div>
      </article>
    </main>
  </>;
}
