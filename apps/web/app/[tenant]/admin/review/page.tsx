import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ReviewCard } from '@/components/admin/ReviewCard';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import { evidenceBase } from '@/lib/data';
import { reviewQueue, type FailedRunSummary } from '@/lib/review-data';

export const dynamic = 'force-dynamic';

/** Review queue · Admin · <portrait> (WCAG 2.4.2): the generic site title named none of the staff pages. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Review queue');
}

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { tenant } = await params;
  const { run } = await searchParams;
  // This page's own address, ?run= included, so a signed-out editor following the review email comes back to it.
  const ctx = await requireAdminPage(
    tenant,
    'editor',
    `/${tenant}/admin/review${run ? `?run=${encodeURIComponent(run)}` : ''}`,
  );

  const { reviewableRuns, selectedRun, cards, failedRuns } = await reviewQueue(ctx.tenant.id, run);

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Review queue</h1>

        {reviewableRuns.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--color-muted)]">
            {failedRuns.length > 0 ? (
              'Nothing to review yet: no research run has finished with findings. The runs that failed are listed below, with why.'
            ) : (
              <>
                No completed research runs yet.{' '}
                <Link className="underline" href={`/${tenant}/admin/research`}>
                  Plan one
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {reviewableRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/${tenant}/admin/review?run=${r.id}`}
                  className={`rounded border px-2 py-1 ${
                    selectedRun?.id === r.id ? 'bg-black text-white' : 'hover:bg-black/5'
                  }`}
                >
                  {r.createdAt.toISOString().slice(0, 10)} · {r.id.slice(0, 8)}
                  {r.status === 'failed' ? ' · failed' : ''}
                </Link>
              ))}
            </div>

            <p className="mt-4 text-sm text-[color:var(--color-muted)]">
              One card per dimension. Verification failures are red-flagged with the verifier's
              reasoning, never dropped; gap cards are first-class findings. Approving creates a
              draft version — publishing is the separate human gate.
            </p>

            <div className="mt-6 space-y-6">
              {cards.map((card) => (
                <ReviewCard
                  key={card.dimension.id}
                  tenantSlug={tenant}
                  runId={selectedRun!.id}
                  dimensionId={card.dimension.id}
                  dimensionName={card.dimensionName}
                  ring={card.dimension.ring}
                  findings={card.findings.map((f) => ({
                    id: f.id,
                    indicatorSlug: f.indicatorSlug,
                    payload: f.payload,
                    verification: f.verification,
                  }))}
                  approvedVersionNum={card.approvedVersionNum}
                  sessionId={card.sessionId}
                  canReadTranscript={ctx.role === 'owner'}
                  evidenceBase={evidenceBase(tenant)}
                />
              ))}
              {cards.length === 0 && selectedRun ? (
                <p className="text-sm text-[color:var(--color-muted)]">
                  This run produced no findings.
                </p>
              ) : null}
            </div>
          </>
        )}

        <FailedRuns tenant={tenant} failedRuns={failedRuns} />
      </main>
    </>
  );
}

/**
 * Failed runs (newest first, a few at most): each with the reason that
 * stopped most of its sessions (lib/run-failure.ts) and a link to its run
 * page, which names the reason per session and offers to plan the failed
 * dimensions again. Without this, a portrait whose only run failed showed
 * "No completed research runs yet" — as if nothing had happened.
 */
function FailedRuns({ tenant, failedRuns }: { tenant: string; failedRuns: FailedRunSummary[] }) {
  if (failedRuns.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="failed-runs-heading">
      <h2 id="failed-runs-heading" className="text-lg font-semibold">
        Runs that failed
      </h2>
      <ul className="mt-3 space-y-3">
        {failedRuns.map((f) => (
          <li key={f.run.id} className="rounded border-s-4 border-red-700 bg-red-50 p-3 text-sm">
            <p className="font-medium">
              {f.run.createdAt.toISOString().slice(0, 10)} · {f.run.id.slice(0, 8)} —{' '}
              {f.incompleteSessions} of {f.run.plan.sessions.length} sessions did not complete
              {f.findings > 0
                ? ` · ${f.findings} finding${f.findings === 1 ? '' : 's'} recorded before it stopped (listed above)`
                : ''}
            </p>
            <p className="mt-1">{f.cause.message}</p>
            <p className="mt-1">
              <Link className="underline" href={`/${tenant}/admin/research/${f.run.id}`}>
                See what happened, and plan the failed dimensions again
              </Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
