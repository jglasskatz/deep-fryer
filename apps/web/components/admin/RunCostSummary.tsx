import type { CostStage, RunCostSummary as Summary } from '@deep-fryer/core';

const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
}).format(value);

/** What each stage is called on the page and in the CSV. */
export const STAGE_LABEL: Record<CostStage, string> = {
  region_context: 'Region context',
  research: 'Research',
  verification: 'Independent verification',
  audit: 'Machine audits',
};

/** The words for a dimension's (or the run's) cost per verified finding. */
export function perVerifiedLabel(row: { verified_findings: number | null; cost_per_verified_finding_usd: number | null }): string {
  if (row.verified_findings === 0) return 'No verified findings';
  if (row.cost_per_verified_finding_usd === null) return 'Not known: part of the cost is missing';
  return money(row.cost_per_verified_finding_usd);
}

const th = 'p-2 font-medium';
const num = 'p-2 tabular-nums';

/**
 * Recorded costs are estimates; partial telemetry never becomes a total.
 * `dimensionNames` maps a dimension id to the name the page shows for it.
 */
export function RunCostSummary({ summary, runId, dimensionNames = {} }: { summary: Summary; runId: string; dimensionNames?: Readonly<Record<string, string>> }) {
  const partial = summary.coverage === 'partial';
  const unavailable = summary.coverage === 'unavailable';
  const unpricedOnly = summary.known_estimated_usd === 0 && summary.unpriced_models.length > 0;
  const known = partial ? ' · known portion' : '';
  const hasRegion = summary.sessions.some(session => session.role === 'region_context');
  const hasAudit = summary.sessions.some(session => session.role === 'audit');
  const stages: { stage: CostStage; value: number | null }[] = [
    ...(hasRegion ? [{ stage: 'region_context' as const, value: summary.region_context_estimated_usd }] : []),
    { stage: 'research', value: summary.research_estimated_usd },
    { stage: 'verification', value: summary.verification_estimated_usd },
    ...(hasAudit ? [{ stage: 'audit' as const, value: summary.audit_estimated_usd }] : []),
  ];
  const nameOf = (id: string) => dimensionNames[id] ?? 'A dimension no longer on this portrait';
  return (
    <section className="mt-8 rounded-lg border border-black/15 p-4 sm:p-6" aria-labelledby="run-cost-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="run-cost-heading" className="text-lg font-semibold">Research cost estimate</h2>
        <a className="text-sm underline" href={`/api/research/runs/${encodeURIComponent(runId)}/costs?format=csv`}>Download cost details (CSV)</a>
      </div>
      <p className="mt-2 text-sm font-medium">
        {unavailable ? 'Usage unavailable' : partial ? 'Partial usage — total unavailable' : 'Recorded usage priced'}
      </p>
      {unavailable ? (
        <p className="mt-2 text-sm text-[color:var(--color-muted)]">No token usage has been recorded for this run. Its cost is unknown.</p>
      ) : (
        <>
          <p className="mt-3 text-2xl font-semibold tabular-nums">
            {unpricedOnly ? 'No priced usage available' : money(partial ? summary.known_estimated_usd : summary.estimated_usd)}
            {!unpricedOnly ? <span className="ml-2 text-sm font-normal">{partial ? 'known priced subtotal' : 'estimated USD'}</span> : null}
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {stages.map(({ stage, value }) => (
              <div key={stage}><dt className="text-[color:var(--color-muted)]">{STAGE_LABEL[stage]}{known}</dt><dd className="font-semibold tabular-nums">{unpricedOnly ? 'Unavailable' : money(value)}</dd></div>
            ))}
            {summary.verified_findings !== null ? (
              <div>
                <dt className="text-[color:var(--color-muted)]">Cost per verified finding</dt>
                <dd className="font-semibold tabular-nums">{perVerifiedLabel(summary)}</dd>
                <dd className="text-xs text-[color:var(--color-muted)]">{summary.verified_findings === 1 ? '1 finding' : `${summary.verified_findings} findings`} passed independent verification</dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
      <p className="mt-3 max-w-3xl text-xs text-[color:var(--color-muted)]">{summary.basis}</p>
      {summary.missing_sessions.length > 0 ? <p className="mt-2 text-sm">{summary.missing_sessions.length} {summary.missing_sessions.length === 1 ? 'session has' : 'sessions have'} no recorded usage.</p> : null}
      {summary.unpriced_models.length > 0 ? <p className="mt-2 break-words text-sm">Models without a price: {summary.unpriced_models.join(', ')}. Their charges are excluded from the subtotal.</p> : null}
      {!unavailable && !unpricedOnly && summary.dimensions.length > 0 ? (
        <div className="mt-6">
          <h3 id="run-cost-dimensions" className="text-base font-semibold">Cost by dimension</h3>
          <p className="mt-1 max-w-3xl text-xs text-[color:var(--color-muted)]">
            Each dimension&apos;s research, the independent check of its findings{hasAudit ? ' and any machine audits of them' : ''}. A verified finding is one the independent check passed.
          </p>
          <div tabIndex={0} role="region" aria-labelledby="run-cost-dimensions" className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead><tr className="border-b text-[color:var(--color-muted)]">
                <th scope="col" className={th}>Dimension</th>
                <th scope="col" className={th}>Research</th>
                <th scope="col" className={th}>Verification</th>
                {hasAudit ? <th scope="col" className={th}>Machine audits</th> : null}
                <th scope="col" className={th}>Total</th>
                <th scope="col" className={th}>Verified findings</th>
                <th scope="col" className={th}>Per verified finding</th>
              </tr></thead>
              <tbody>
                {summary.dimensions.map(row => (
                  <tr key={row.dimension_id} className="border-b align-top">
                    <th scope="row" className="p-2 text-left font-normal">{nameOf(row.dimension_id)}</th>
                    <td className={num}>{money(row.research_estimated_usd)}</td>
                    <td className={num}>{money(row.verification_estimated_usd)}</td>
                    {hasAudit ? <td className={num}>{money(row.audit_estimated_usd)}</td> : null}
                    <td className={num}>{money(row.known_estimated_usd)}{row.coverage === 'partial' ? <span className="block text-xs">Known portion</span> : null}</td>
                    <td className={num}>{row.verified_findings}</td>
                    <td className={num}>{perVerifiedLabel(row)}</td>
                  </tr>
                ))}
                {hasRegion ? (
                  <tr className="border-b align-top">
                    <th scope="row" className="p-2 text-left font-normal">Region context (shared by every dimension)</th>
                    <td className={num} colSpan={hasAudit ? 3 : 2}></td>
                    <td className={num}>{money(summary.region_context_estimated_usd)}</td>
                    <td className={num} colSpan={2}></td>
                  </tr>
                ) : null}
                {summary.unattributed_estimated_usd !== null ? (
                  <tr className="border-b align-top">
                    <th scope="row" className="p-2 text-left font-normal">Not matched to a dimension</th>
                    <td className={num} colSpan={hasAudit ? 3 : 2}></td>
                    <td className={num}>{money(summary.unattributed_estimated_usd)}</td>
                    <td className={num} colSpan={2}></td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot><tr className="font-semibold">
                <th scope="row" className="p-2 text-left">Run total{known}</th>
                <td className={num} colSpan={hasAudit ? 3 : 2}></td>
                <td className={num}>{money(summary.known_estimated_usd)}</td>
                <td className={num}>{summary.verified_findings ?? ''}</td>
                <td className={num}>{summary.verified_findings === null ? '' : perVerifiedLabel(summary)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      ) : null}
      {summary.sessions.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Usage and estimated cost by session ({summary.sessions.length})</summary>
          <div tabIndex={0} role="region" aria-label="Session usage and estimated costs" className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]">
            <table className="w-full min-w-[740px] border-collapse text-left text-xs">
              <thead><tr className="border-b"><th scope="col" className="p-2">Session</th><th scope="col" className="p-2">Input</th><th scope="col" className="p-2">Output</th><th scope="col" className="p-2">Cache read</th><th scope="col" className="p-2">Cache write</th><th scope="col" className="p-2">Estimated USD</th></tr></thead>
              <tbody>{summary.sessions.map(session => <tr key={session.session} className="border-b align-top">
                <th scope="row" className="max-w-xs break-words p-2 text-left font-normal"><span className="font-medium">{session.role === 'audit' ? 'Machine audit' : session.role === 'verification' ? 'Verification' : STAGE_LABEL[session.role]}</span>{session.dimension_id ? <span> · {nameOf(session.dimension_id)}</span> : null}<br /><span className="font-mono">{session.session}</span>{session.limitations.map(note => <p key={note} className="mt-1 text-[color:var(--color-muted)]">{note}</p>)}</th>
                {[session.input_tokens, session.output_tokens, session.cache_read_tokens, session.cache_write_tokens].map((value, i) => <td key={i} className="p-2 tabular-nums">{value.toLocaleString('en-US')}</td>)}
                <td className="p-2 tabular-nums">{session.known_estimated_usd === 0 && session.unpriced_models.length > 0 ? 'Unpriced' : money(session.known_estimated_usd)}{session.coverage === 'partial' ? <span className="block">Known portion</span> : null}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * A run's dollars in one cell of the run list: the estimate when every
 * charge is known, the known part labelled as such, or a dash when no usage
 * was recorded.
 */
export function RunCostCell({ summary }: { summary: Pick<Summary, 'coverage' | 'estimated_usd' | 'known_estimated_usd'> }) {
  if (summary.coverage === 'unavailable' || summary.known_estimated_usd === null) return <>—</>;
  if (summary.coverage === 'complete') return <>{money(summary.estimated_usd)}</>;
  return <>{money(summary.known_estimated_usd)} <span className="text-xs text-[color:var(--color-muted)]">known so far</span></>;
}

/** The portrait's research spend: every run that was applied or recorded usage, added up (core summarizePortraitCosts). */
export function PortraitCostTotal({ total }: { total: { runs_counted: number; runs_incomplete: number; known_estimated_usd: number; estimated_usd: number | null } }) {
  if (total.runs_counted === 0) {
    return <p className="text-sm">No research has run yet, so nothing has been spent.</p>;
  }
  const runs = total.runs_counted === 1 ? '1 run' : `${total.runs_counted} runs`;
  return (
    <>
      <p className="text-sm">
        Estimated research cost for this portrait so far:{' '}
        <span className="font-semibold tabular-nums">{money(total.estimated_usd ?? total.known_estimated_usd)}</span>
        {total.estimated_usd === null ? ' known so far' : ''} across {runs}.
      </p>
      {total.runs_incomplete > 0 ? (
        <p className="mt-1 text-xs text-[color:var(--color-muted)]">
          {total.runs_incomplete === 1 ? '1 run has' : `${total.runs_incomplete} runs have`} usage that is missing or not fully priced, so the full total is not known.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">An estimate from recorded usage, not a bill.</p>
    </>
  );
}
