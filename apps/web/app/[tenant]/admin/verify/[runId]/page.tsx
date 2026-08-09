import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { GatePanel } from '@/components/admin/verify/GatePanel';
import { SpotCheckCallout } from '@/components/admin/verify/SpotCheckCallout';
import { TriageTable, type TriageDimensionContext } from '@/components/admin/verify/TriageTable';
import { ApprovalPanel, type ApprovalPanelState } from '@/components/admin/verify/ApprovalPanel';
import { RunNotes } from '@/components/admin/verify/RunNotes';
import { getAuth } from '@/lib/auth';
import { evidenceBase } from '@/lib/data';
import { requireVerifyPage } from '@/lib/verify-guard';
import { verifyRun } from '@/lib/verify-data';

export const dynamic = 'force-dynamic';

export default async function VerifyRunPage({
  params,
}: {
  params: Promise<{ tenant: string; runId: string }>;
}) {
  const { tenant, runId } = await params;
  const ctx = await requireVerifyPage(tenant);
  const data = await verifyRun(ctx.tenant.id, runId);
  if (!data) notFound();

  const { report } = data;
  const blocking = report.violations.filter(
    (v) => v.severity === 'critical' && v.stage !== 'confirmation',
  );
  const approvalState: ApprovalPanelState =
    report.approval.state === 'current'
      ? 'current'
      : blocking.length > 0
        ? 'blocked'
        : report.approval.state === 'stale'
          ? 'stale'
          : 'ready';

  const auth = await getAuth();
  const approverLabel = auth.email ?? (ctx.devMode ? 'dev-owner' : 'you');
  // Any disposition on a sampled finding counts as inspection.
  const inspectedSample = new Set(data.dispositions.map((d) => d.findingId));
  const contexts: Record<string, TriageDimensionContext> = Object.fromEntries(
    [...data.dimensionContexts.values()].map((c) => [
      c.slug,
      { ...c, acceptedScales: [...c.acceptedScales] },
    ]),
  );

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin/verify`}>
            ← Verify
          </Link>{' '}
          ·{' '}
          <Link className="underline" href={`/${tenant}/admin/review?run=${runId}`}>
            Review queue for this run
          </Link>{' '}
          ·{' '}
          <Link className="underline" href={`/${tenant}/admin/research/${runId}`}>
            Run detail
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          Verify run <span className="font-mono text-lg">{runId.slice(0, 8)}</span>
        </h1>
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          {data.run.createdAt.toISOString().slice(0, 10)} · plugin v{data.run.plan.plugin_version} ·
          config {data.run.plan.config_hash.slice(0, 8)} · content hash{' '}
          <span className="font-mono">{report.hash.slice(0, 16)}…</span>
        </p>

        <div className="mt-6 space-y-4">
          <GatePanel report={report} />
          <SpotCheckCallout sample={report.sample} dispositioned={inspectedSample} />
          <ApprovalPanel
            tenantSlug={tenant}
            runId={runId}
            state={approvalState}
            blockerCount={blocking.length}
            hash={report.hash}
            approvedBy={report.approval.approvedBy}
            approvedAt={report.approval.approvedAt?.toISOString()}
            approverLabel={approverLabel}
            sampleCount={report.sample.length}
            sampleVerified={report.sample.filter((s) => inspectedSample.has(s.findingId)).length}
          />
          <RunNotes tenantSlug={tenant} runId={runId} notes={data.runNotes} />
          <TriageTable
            tenantSlug={tenant}
            runId={runId}
            findings={data.findings}
            contexts={contexts}
            evidenceBase={evidenceBase(tenant)}
          />
        </div>
      </main>
    </>
  );
}
