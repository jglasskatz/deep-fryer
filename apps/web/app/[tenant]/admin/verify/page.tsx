import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { requireVerifyPage } from '@/lib/verify-guard';
import { verifyRuns } from '@/lib/verify-data';

export const dynamic = 'force-dynamic';

const APPROVAL_LABEL = {
  current: { text: 'approved', cls: 'bg-green-100 text-green-900' },
  stale: { text: 'approval stale', cls: 'bg-red-100 text-red-900' },
  none: { text: 'unapproved', cls: 'bg-black/10' },
} as const;

export default async function VerifyIndexPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  const ctx = await requireVerifyPage(tenant);
  const runs = await verifyRuns(ctx.tenant.id);

  if (runs.length === 1) redirect(`/${tenant}/admin/verify/${runs[0]!.run.id}`);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Verify</h1>
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">
          The expert view of each research run: the same staged gate the research-verify CLI
          computes — deterministic checks, verifier verdicts, human review, hash-bound
          confirmation — with every finding explorable beside its archived evidence.
        </p>

        {runs.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--color-muted)]">
            No completed research runs yet.{' '}
            <Link className="underline" href={`/${tenant}/admin/research`}>
              Plan one
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-6 space-y-2">
            {runs.map(({ run, findingCount, flaggedCount, dispositionCount, approvalState }) => {
              const approval = APPROVAL_LABEL[approvalState];
              return (
                <li key={run.id}>
                  <Link
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-black/15 p-3 text-sm hover:bg-black/5"
                    href={`/${tenant}/admin/verify/${run.id}`}
                  >
                    <span className="font-mono text-xs">{run.id.slice(0, 8)}</span>
                    <span className="text-xs text-[color:var(--color-muted)]">
                      {run.createdAt.toISOString().slice(0, 10)}
                    </span>
                    <span className="flex-1" />
                    <span className="text-xs">{findingCount} findings</span>
                    {flaggedCount > 0 ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900">
                        {flaggedCount} flagged
                      </span>
                    ) : null}
                    {dispositionCount > 0 ? (
                      <span className="rounded bg-black/10 px-2 py-0.5 text-xs">
                        {dispositionCount} dispositions
                      </span>
                    ) : null}
                    <span className={`rounded px-2 py-0.5 text-xs ${approval.cls}`}>
                      {approval.text}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
