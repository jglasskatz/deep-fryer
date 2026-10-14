import Link from 'next/link';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ReviewCard } from '@/components/admin/ReviewCard';
import { requireAdminPage } from '@/lib/admin-guard';
import { evidenceBase } from '@/lib/data';
import { reviewQueue } from '@/lib/review-data';

export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { tenant } = await params;
  const { run } = await searchParams;
  const ctx = await requireAdminPage(tenant, 'editor');

  const { completeRuns, selectedRun, cards } = await reviewQueue(ctx.tenant.id, run);

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

        {completeRuns.length === 0 ? (
          <p className="mt-6 text-sm text-[color:var(--color-muted)]">
            No completed research runs yet.{' '}
            <Link className="underline" href={`/${tenant}/admin/research`}>
              Plan one
            </Link>
            .
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {completeRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/${tenant}/admin/review?run=${r.id}`}
                  className={`rounded border px-2 py-1 ${
                    selectedRun?.id === r.id ? 'bg-black text-white' : 'hover:bg-black/5'
                  }`}
                >
                  {r.createdAt.toISOString().slice(0, 10)} · {r.id.slice(0, 8)}
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
      </main>
    </>
  );
}
