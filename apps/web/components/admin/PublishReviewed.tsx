'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
import { publishReviewed } from '@/lib/machine-audit-actions';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';
export interface ReviewedDraft { id: string; dimensionId: string; name: string; versionNum: number }
export function PublishReviewed({ tenantSlug, drafts }: { tenantSlug: string; drafts: ReviewedDraft[] }) {
  const id = useId();
  const { run, pending, error } = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const current = drafts.filter(draft => selected.has(draft.id));
  if (!drafts.length && !result) return null;
  return <section className="mt-6 rounded-lg border border-black/15 p-4" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`} className="font-semibold">Publish reviewed drafts</h2>
    <p className="mt-1 text-sm text-[color:var(--color-muted)]">Select the exact draft versions to make public. Review each one first; any required second reviewer still applies.</p>
    <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Choose exact draft versions ({drafts.length})</summary>
    <ul className="mt-3 space-y-2">{drafts.map(draft => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={selected.has(draft.id)} disabled={pending} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(draft.id); else next.delete(draft.id); return next; })} />{draft.name} · version {draft.versionNum}</label><Link className="underline" href={`/${tenantSlug}/admin/dim/${draft.dimensionId}`}>Inspect draft</Link></li>)}</ul>
    {current.length ? <p className="mt-3 text-sm">Will publish: {current.map(draft => `${draft.name} v${draft.versionNum}`).join('; ')}.</p> : null}
    <button type="button" disabled={pending || !current.length} className="mt-3 min-h-11 rounded bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={() => run(async () => { const outcome = unwrap(await publishReviewed({ tenantSlug, versionIds: current.map(draft => draft.id) })); setSelected(new Set()); setResult(`${outcome.published} draft versions published.`); })}>{pending ? 'Publishing…' : `Publish selected versions (${current.length})`}</button></details>
    {error ? <p role="alert" className="mt-2 text-sm text-red-800">{error}</p> : null}
    <p role="status" className="mt-2 text-sm">{result}</p>
  </section>;
}
