'use client';
import { useId, useState } from 'react';
import { MarkdownContent } from '@/components/content/MarkdownContent';
import { saveCustomPage, publishCustomPage, unpublishCustomPage } from '@/lib/custom-page-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';

export interface CustomPageForEditor {
  id: string;
  slug: string;
  publishedVersionId: string | null;
  versions: { id: string; versionNum: number; status: string; title: string; mdxBody: string; createdAt: string; publishedAt: string | null }[];
}
const button = 'min-h-11 rounded border border-black/20 px-3 py-2 text-sm hover:bg-black/5 disabled:opacity-50';

function PageEditor({ tenantSlug, page }: { tenantSlug: string; page?: CustomPageForEditor }) {
  const id = useId();
  const latest = page?.versions[0];
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [title, setTitle] = useState(latest?.title ?? '');
  const [body, setBody] = useState(latest?.mdxBody ?? '');
  const [notice, setNotice] = useState('');
  const { run, pending, error } = useAction();
  return <section className="rounded-lg border border-black/15 p-4 sm:p-6" aria-labelledby={`${id}-heading`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">{page ? latest?.title || page.slug : 'Create a page'}</h2>
      {page ? <span className="rounded bg-black/5 px-2 py-1 text-xs">{page.publishedVersionId ? 'Published' : 'Draft only'}</span> : null}
    </div>
    {page?.publishedVersionId ? <p className="mt-2 text-sm"><a className="underline" href={`/${tenantSlug}/pages/${page.slug}`}>View public page ↗</a></p> : null}
    <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); setNotice(''); run(async () => {
      unwrap(await saveCustomPage({ tenantSlug, pageId: page?.id, slug, title, body }));
      setNotice('Draft saved. Publish a version below when it is ready for residents.');
      if (!page) { setSlug(''); setTitle(''); setBody(''); }
    }); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="block text-sm font-medium" htmlFor={`${id}-title`}>Page title</label><input id={`${id}-title`} value={title} onChange={event => setTitle(event.target.value)} required maxLength={200} disabled={pending} className="mt-1 min-h-11 w-full rounded border border-field-border px-3 py-2 text-sm" /></div>
        <div><label className="block text-sm font-medium" htmlFor={`${id}-slug`}>URL name</label><input id={`${id}-slug`} value={slug} onChange={event => setSlug(event.target.value)} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" readOnly={Boolean(page)} disabled={pending} aria-describedby={`${id}-url-hint`} className={`mt-1 min-h-11 w-full rounded border border-field-border px-3 py-2 font-mono text-sm ${page ? 'bg-black/5' : ''}`} /><p id={`${id}-url-hint`} className="mt-1 text-xs text-[color:var(--color-muted)]">{page ? 'The existing address stays the same across versions.' : 'Lowercase words separated by hyphens, for example climate-plan.'}</p></div>
      </div>
      <div><label className="block text-sm font-medium" htmlFor={`${id}-body`}>Page content</label><textarea id={`${id}-body`} value={body} onChange={event => setBody(event.target.value)} required disabled={pending} rows={10} aria-describedby={`${id}-format-hint`} className="mt-1 w-full rounded border border-field-border px-3 py-2 font-mono text-sm" /><p id={`${id}-format-hint`} className="mt-1 text-xs text-[color:var(--color-muted)]">Use Markdown headings, paragraphs, bullet lists and links. Executable code and embedded HTML are not supported.</p></div>
      <details><summary className="cursor-pointer text-sm font-medium">Preview draft</summary><div className="mt-3 rounded border border-black/10 p-4"><h3 className="mb-3 text-xl font-semibold">{title || 'Untitled page'}</h3><MarkdownContent body={body} /></div></details>
      <button type="submit" disabled={pending || !slug.trim() || !title.trim() || !body.trim()} className="min-h-11 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? 'Saving…' : page ? 'Save a new draft version' : 'Save draft'}</button>
    </form>
    <p role="status" className="mt-3 text-sm">{notice}</p>
    {error ? <p role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}
    {page ? <div className="mt-6 border-t border-black/10 pt-4">
      <h3 className="font-semibold">Version history</h3>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">Saving preserves older versions. Publish an earlier version to restore its content.</p>
      <ul className="mt-3 space-y-3">{page.versions.map(version => <li key={version.id} className="rounded border border-black/10 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">Version {version.versionNum} · {version.title}</p><span className="text-xs text-[color:var(--color-muted)]">{version.id === page.publishedVersionId ? 'Currently published' : version.status === 'published' ? 'Previously published' : 'Draft'} · {version.createdAt.slice(0, 10)}</span></div>
        <details className="mt-2"><summary className="cursor-pointer text-sm">Read this version</summary><div className="mt-2 rounded bg-black/[0.03] p-3"><MarkdownContent body={version.mdxBody} /></div></details>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} className={button} onClick={() => { setTitle(version.title); setBody(version.mdxBody); setNotice(`Version ${version.versionNum} loaded into the editor. Saving creates a new draft.`); document.getElementById(`${id}-title`)?.focus(); }}>Edit a copy</button>
          {version.id !== page.publishedVersionId ? <button type="button" disabled={pending} className={button} onClick={() => { setNotice(''); run(async () => { unwrap(await publishCustomPage({ tenantSlug, pageId: page.id, versionId: version.id })); setNotice(`Version ${version.versionNum} is now published.`); }); }}>{version.versionNum < (latest?.versionNum ?? 0) ? 'Restore and publish this version' : 'Publish this version'}</button> : null}</div>
      </li>)}</ul>
      {page.publishedVersionId ? <button type="button" disabled={pending} className={`${button} mt-4`} onClick={() => { setNotice(''); run(async () => { unwrap(await unpublishCustomPage({ tenantSlug, pageId: page.id })); setNotice('Removed from the public site. All versions remain available here.'); }); }}>Remove from public site</button> : null}
    </div> : null}
  </section>;
}

export function CustomPagesEditor({ tenantSlug, pages }: { tenantSlug: string; pages: CustomPageForEditor[] }) {
  return <div className="mt-6 space-y-6"><PageEditor tenantSlug={tenantSlug} />{pages.map(page => <PageEditor key={page.id} tenantSlug={tenantSlug} page={page} />)}</div>;
}
