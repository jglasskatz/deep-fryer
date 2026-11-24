import type { Metadata } from 'next';
import Link from 'next/link';
import { isResearchStrategy, summarizeRunCosts, type ResearchPlan } from '@deep-fryer/core';
import { RunCostSummary } from '@/components/admin/RunCostSummary';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ActionButton } from '@/components/admin/ActionButton';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { runWithSessions } from '@/lib/admin-data';
import { requireAdminPage } from '@/lib/admin-guard';
import { supportEmail } from '@/lib/env';
import { adminPageMetadata } from '@/lib/page-meta';
import { applyResearchAction } from '@/lib/research-actions';
import { runDimensionLabels, runFailureCauses } from '@/lib/review-data';
import { groupCauses, runStoppedCause, type FailureCause } from '@/lib/run-failure';
import {
  formatDuration,
  LONG_QUEUE_MS,
  remainingEstimateMs,
  runInProgress,
  runPhase,
  runProgress,
  sessionDurationMs,
} from '@/lib/run-progress';
import { RunPhaseBadge, SessionChipBadge } from '../RunBadges';
import { fallbackSentence, runProvenanceSentence, sessionModels } from '../provenance';
import { ReplanFailed } from './ReplanFailed';

export const dynamic = 'force-dynamic';

/**
 * The strategy a plan was rendered from, as the run page names it: name and
 * version ("standard v1"). Plans made before strategies had versions say so
 * instead of guessing one; a name they recorded is kept beside it.
 */
function strategyLabel(plan: ResearchPlan): { label: string; note: string | null } {
  if (!plan.strategy || plan.strategy_version === undefined) {
    return {
      label: 'strategy not recorded',
      note: plan.strategy ? `It was planned as ${plan.strategy}, before strategies had version numbers.` : null,
    };
  }
  const name = plan.strategy === 'operator-defaults' ? 'server defaults' : plan.strategy;
  return { label: `${name} v${plan.strategy_version}`, note: null };
}

/**
 * While a run is queued or running the page re-renders itself this often
 * (components/admin/AutoRefresh.tsx). Sessions take minutes; a few seconds
 * is enough to see "queued" turn into "running" without waiting.
 */
const REFRESH_MS = 5_000;

/** Research run · Admin · <portrait> (WCAG 2.4.2): the generic site title named none of the staff pages. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Research run');
}

/**
 * One research run (SPEC.md §8): before it is applied, the plan and the
 * Apply button; once applied, where it stands — queued, then "n of N
 * sessions finished" with a chip per session, refreshing itself until it
 * settles — and, when sessions fail, why, in plain words (lib/run-failure.ts)
 * and who can fix it. The exact prompts stay one disclosure away.
 */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ tenant: string; runId: string }>;
}) {
  const { tenant, runId } = await params;
  // This page's own address, so a signed-out editor following the run-finished email comes back to it.
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/research/${encodeURIComponent(runId)}`);

  const data = await runWithSessions(runId);
  if (!data || data.run.tenantId !== ctx.tenant.id) notFound();
  const { run, sessions, findings } = data;

  const anyFailed = sessions.some((s) => s.status === 'failed');
  const [{ slugById, nameBySlug }, causeBySession] = await Promise.all([
    runDimensionLabels(ctx.tenant.id),
    anyFailed ? runFailureCauses(ctx.tenant.id, run.id) : Promise.resolve(new Map<string, FailureCause>()),
  ]);

  const basePhase = runPhase(run);
  const now = new Date();
  const progress = runProgress(run.plan.sessions, sessions, slugById, basePhase);
  const phase = runPhase(run, {
    allSessionsFinished: progress.total > 0 && progress.finished >= progress.total,
  });
  const estimate = remainingEstimateMs(progress, phase, now);
  const nameOf = (key: string) => (key === 'region_context' ? 'Region context (phase 0)' : (nameBySlug.get(key) ?? key));
  const support = supportEmail();

  const failedItems = progress.items.filter((i) => i.chip === 'failed');
  const causeGroups = groupCauses(
    failedItems.flatMap((i) => {
      const cause = i.session ? causeBySession.get(i.session.id) : undefined;
      return cause ? [{ key: i.key, cause }] : [];
    }),
  );
  // A failed run none of whose sessions failed stopped before any started.
  const stoppedEarly = phase === 'failed' && failedItems.length === 0 ? runStoppedCause(support) : null;

  const idBySlug = new Map([...slugById].map(([id, slug]) => [slug, id]));
  const replanIds = progress.items.flatMap((i) =>
    i.spec.kind === 'dimension' && (i.chip === 'failed' || i.chip === 'not_run') ? (idBySlug.get(i.key) ?? []) : [],
  );
  const settled = phase === 'complete' || phase === 'failed';
  const pct = progress.total ? Math.round((progress.finished / progress.total) * 100) : 0;
  const sinceApply = run.appliedAt ? now.getTime() - run.appliedAt.getTime() : 0;
  const tookMs = run.appliedAt && run.completedAt ? run.completedAt.getTime() - run.appliedAt.getTime() : null;
  const ownKey = run.funding === 'organization_key';
  const strategy = strategyLabel(run.plan);
  const statusLine =
    phase === 'queued'
      ? 'Queued — starting shortly'
      : phase === 'auditing'
        ? `All ${progress.total} sessions finished — running automatic quality audits`
        : phase === 'running'
          ? `${progress.finished} of ${progress.total} sessions finished${progress.failed ? ` (${progress.failed} failed)` : ''}`
          : phase === 'complete'
            ? `Finished: ${progress.done} of ${progress.total} sessions completed${progress.failed ? `, ${progress.failed} failed` : ''}${progress.notRun ? `, ${progress.notRun} did not run` : ''}`
            : `This run failed: ${progress.failed + progress.notRun} of ${progress.total} sessions did not complete`;

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug: ctx.tenant.slug, name: ctx.tenant.name }} />
      <AutoRefresh everyMs={REFRESH_MS} active={runInProgress(phase)} />
      <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="text-sm">
          <Link className="underline" href={`/${tenant}/admin/research`}>
            ← Research runs
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Research run {run.id.slice(0, 8)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[color:var(--color-muted)]">
          <RunPhaseBadge phase={phase} />
          <span>
            {run.plan.sessions.length} sessions · {strategy.label} · plugin v{run.plan.plugin_version} · config {run.plan.config_hash}
            {run.appliedAt
              ? ownKey
                ? " · on your organization's own Anthropic API key"
                : " · on your plan's research sessions"
              : ''}
          </span>
        </p>
        {run.appliedAt ? (
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            {runProvenanceSentence(run, sessions.map((s) => s.id))}
          </p>
        ) : null}

        <section aria-label="Where this run stands" className="mt-6 rounded border border-black/15 p-4">
          {phase === 'unapplied' ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-xl text-sm">
                This plan hasn&apos;t been applied: nothing has run and nothing has been spent. Applying
                starts its {progress.total} sessions — check the exact plan below first if you like.
              </p>
              <ActionButton
                action={applyResearchAction.bind(null, { tenantSlug: tenant, runId })}
                className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                pendingLabel="Starting…"
              >
                Apply — start {progress.total} sessions
              </ActionButton>
            </div>
          ) : (
            <>
              {/* One live region for every applied state, so the change from queued to running to
                  finished is announced as the page refreshes itself (a region that appears is not). */}
              <p role="status" className="text-base font-semibold">
                {statusLine}
              </p>
              {phase === 'queued' ? (
                <>
                  <p className="mt-1 text-sm text-[color:var(--color-muted)]">
                    Applied {formatDuration(sinceApply)} ago. This page updates by itself.
                  </p>
                  {sinceApply > LONG_QUEUE_MS ? (
                    <p className="mt-2 max-w-2xl text-sm">
                      Still waiting after {formatDuration(sinceApply)}. Runs start one after another, so
                      this one may be waiting for another run to finish. If it doesn&apos;t start,{' '}
                      {support ? (
                        <>
                          contact <a className="underline" href={`mailto:${support}`}>{support}</a>
                        </>
                      ) : (
                        'tell whoever runs this server'
                      )}
                      .
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  {phase === 'running' || phase === 'auditing' ? (
                    <div
                      className="mt-2 h-2 max-w-xl rounded bg-black/10"
                      role="progressbar"
                      aria-label={phase === 'auditing' ? 'Quality audits in progress' : 'Sessions finished'}
                      aria-valuemin={0}
                      aria-valuemax={progress.total}
                      aria-valuenow={progress.finished}
                    >
                      <div className="h-2 rounded bg-[color:var(--color-accent)]" style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  <p className="mt-2 text-sm text-[color:var(--color-muted)]">
                    {phase === 'auditing' ? (
                      <>
                        Running for {formatDuration(sinceApply)}. All research sessions finished;
                        completing independent quality audits before opening the review queue. This
                        page updates by itself.
                      </>
                    ) : phase === 'running' ? (
                      <>
                        Running for {formatDuration(sinceApply)}.{' '}
                        {estimate !== null
                          ? `About ${formatDuration(estimate)} left at the current pace — estimated from how quickly this run's own sessions have finished so far.`
                          : 'An estimate of the time left appears once a few sessions have finished.'}{' '}
                        This page updates by itself.
                      </>
                    ) : tookMs !== null ? (
                      `Took ${formatDuration(tookMs)}.`
                    ) : null}
                    {settled && (progress.failed || progress.notRun)
                      ? ownKey
                        ? " This run used your organization's own Anthropic API key, so none of it was counted against your plan."
                        : ' Sessions that failed or did not run are not counted against your plan.'
                      : ''}
                  </p>
                </>
              )}
            </>
          )}

          {phase !== 'unapplied' ? (
            <p className="mt-4 flex flex-wrap gap-2 text-sm">
              {findings.length > 0 && settled ? (
                <Link
                  className="rounded bg-black px-4 py-2 font-medium text-white"
                  href={`/${tenant}/admin/review?run=${run.id}`}
                >
                  Review findings ({findings.length})
                </Link>
              ) : null}
              <Link className="rounded border px-4 py-2 hover:bg-black/5" href={`/${tenant}/admin/draft`}>
                See the draft doughnut
              </Link>
            </p>
          ) : null}
          {phase !== 'unapplied' ? (
            <p className="mt-1 text-xs text-[color:var(--color-muted)]">
              The draft doughnut is for staff only: nothing on it is public until a reviewer approves and
              publishes it.
            </p>
          ) : null}
        </section>

        <RunCostSummary
          summary={summarizeRunCosts(run.tokenUsage, { sessions, findings })}
          runId={run.id}
          dimensionNames={Object.fromEntries([...slugById].map(([id, slug]) => [id, nameBySlug.get(slug) ?? slug]))}
        />

        {causeGroups.length > 0 || stoppedEarly ? (
          <section className="mt-8" aria-labelledby="why-heading">
            <h2 id="why-heading" className="text-lg font-semibold">
              {stoppedEarly ? 'Why the run stopped' : 'Why sessions failed'}
            </h2>
            <ul className="mt-3 space-y-3">
              {stoppedEarly ? (
                <li className="rounded border-s-4 border-red-700 bg-red-50 p-3 text-sm">{stoppedEarly.message}</li>
              ) : null}
              {causeGroups.map((g) => (
                <li key={`${g.cause.kind}:${g.keys[0]}`} className="rounded border-s-4 border-red-700 bg-red-50 p-3 text-sm">
                  <p className="font-medium">
                    {g.keys.length === 1 ? '1 session' : `${g.keys.length} sessions`}: {g.keys.map(nameOf).join(', ')}
                  </p>
                  <p className="mt-1">{g.cause.message}</p>
                </li>
              ))}
            </ul>
            {settled && replanIds.length > 0 ? (
              <div className="mt-4">
                <ReplanFailed
                  tenantSlug={tenant}
                  dimensionIds={replanIds}
                  strategy={isResearchStrategy(run.plan.strategy) ? run.plan.strategy : undefined}
                />
                <p className="mt-1 text-xs text-[color:var(--color-muted)]">
                  Planning is free: you see the new plan before anything runs, and apply it there.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-8" aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className="text-lg font-semibold">
            Sessions
          </h2>
          <ul className="mt-3 border-t border-black/10">
            {progress.items.map((item, i) => {
              const took = sessionDurationMs(item.session);
              const cause = item.session ? causeBySession.get(item.session.id) : undefined;
              // Which model answered this session, once the worker has written its usage (at the run's end).
              const models = item.session ? sessionModels(run.tokenUsage?.[item.session.id]) : null;
              const fallback = fallbackSentence(models);
              return (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-black/10 py-2 text-sm">
                  <span>{nameOf(item.key)}</span>
                  {phase === 'unapplied' ? (
                    <span className="text-xs text-[color:var(--color-muted)]">planned</span>
                  ) : (
                    <span className="flex flex-wrap items-baseline gap-2 text-xs">
                      {cause ? <span>{cause.label}</span> : null}
                      {models?.model ? <span className="text-[color:var(--color-muted)]">{models.model}</span> : null}
                      {took !== null ? (
                        <span className="text-[color:var(--color-muted)]">{formatDuration(took)}</span>
                      ) : null}
                      <SessionChipBadge chip={item.chip} />
                    </span>
                  )}
                  {fallback ? <span className="basis-full text-xs">{fallback}.</span> : null}
                </li>
              );
            })}
          </ul>
          {progress.notRun > 0 ? (
            <p className="mt-2 text-xs text-[color:var(--color-muted)]">
              {phase === 'failed'
                ? 'Sessions marked “did not run” never started: the run stopped first.'
                : 'Sessions marked “did not run” were skipped: their dimension was no longer on the portrait when the run started.'}
            </p>
          ) : null}
        </section>

        <details className="mt-8 rounded border border-black/15 p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Show the exact plan ({run.plan.sessions.length} prompts)
          </summary>
          <p className="mt-2 text-sm text-[color:var(--color-muted)]">
            This is exactly what runs — every prompt rendered from the plugin&apos;s skills and the
            portrait&apos;s config when the run was planned, inspectable before any tokens are spent.{' '}
            {run.plan.cached_region_brief
              ? 'This targeted run reuses the portrait’s cached region brief instead of running a new phase-0 session.'
              : 'The region brief placeholder is filled by the phase-0 session when the run starts.'}
          </p>
          <div className="mt-3 rounded bg-black/[0.04] p-3 text-xs">
            <p className="font-medium">Research strategy: {strategy.label}</p>
            {strategy.note ? <p className="mt-1">{strategy.note}</p> : null}
            {run.plan.models ? <dl className="mt-2 grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              <div><dt>Researcher</dt><dd className="break-words font-mono">{run.plan.models.session_model}</dd></div>
              {run.plan.models.escalation_model ? <div><dt>Escalation researcher</dt><dd className="break-words font-mono">{run.plan.models.escalation_model}</dd></div> : null}
              <div><dt>Scout</dt><dd className="break-words font-mono">{run.plan.models.subagent_model ?? 'No separate scout'}</dd></div>
              <div><dt>Independent verifier</dt><dd className="break-words font-mono">{run.plan.models.verifier_model}</dd></div>
              <div><dt>Page reader</dt><dd className="break-words font-mono">{run.plan.models.page_reader_model ?? 'Not recorded: the worker’s own setting'}</dd></div>
            </dl> : <p className="mt-1">This older plan did not record model choices; it uses the worker defaults.</p>}
            {run.plan.caps ? <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              <div><dt>Turn limit, each research session</dt><dd>{run.plan.caps.session_max_turns}</dd></div>
              {run.plan.caps.escalation_max_turns !== undefined ? <div><dt>Turn limit, each escalation pass</dt><dd>{run.plan.caps.escalation_max_turns}</dd></div> : null}
              <div><dt>Turn limit, each verifier check</dt><dd>{run.plan.caps.verifier_max_turns}</dd></div>
              <div><dt>Turn limit, each audit check</dt><dd>{run.plan.caps.audit_max_turns}</dd></div>
            </dl> : <p className="mt-1">This older plan did not record turn limits; it uses the worker&apos;s current limits.</p>}
            <p className="mt-2">New plans keep these models and limits when they run, even if the defaults change later. Retrieved source text is archived when available so reviewers can inspect the evidence; retrieval or archival failures remain visible in verification results.</p>
          </div>
          <div className="mt-3 space-y-3">
            {run.plan.sessions.map((spec, i) => {
              const key = spec.kind === 'region_context' ? 'region_context' : (spec.dimension_slug ?? '');
              return (
                <details key={i} className="rounded border border-black/15 p-3">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">{nameOf(key)}</span>
                    <span className="ml-3 text-xs text-[color:var(--color-muted)]">
                      tools: {spec.tool_allowlist.join(', ')} · output: {spec.output_schema_ref}
                    </span>
                  </summary>
                  {/* Focusable and named so the keyboard can scroll a long prompt (Safari does not focus scroll containers itself). */}
                  <pre
                    tabIndex={0}
                    aria-label={`Prompt: ${nameOf(key)}`}
                    className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]"
                  >
                    {spec.prompt}
                  </pre>
                </details>
              );
            })}
          </div>
        </details>

      </main>
    </>
  );
}
