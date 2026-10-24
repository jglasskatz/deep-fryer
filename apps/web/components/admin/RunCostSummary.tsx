import type { RunCostSummary as Summary } from '@deep-fryer/core';

const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4,
}).format(value);

/** Recorded costs are estimates; partial telemetry never becomes a total. */
export function RunCostSummary({ summary, runId }: { summary: Summary; runId: string }) {
  const partial = summary.coverage === 'partial';
  const unavailable = summary.coverage === 'unavailable';
  const unpricedOnly = summary.known_estimated_usd === 0 && summary.unpriced_models.length > 0;
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
            <div><dt className="text-[color:var(--color-muted)]">Research{partial ? ' · known portion' : ''}</dt><dd className="font-semibold tabular-nums">{unpricedOnly ? 'Unavailable' : money(summary.research_estimated_usd)}</dd></div>
            <div><dt className="text-[color:var(--color-muted)]">Independent verification{partial ? ' · known portion' : ''}</dt><dd className="font-semibold tabular-nums">{unpricedOnly ? 'Unavailable' : money(summary.verification_estimated_usd)}</dd></div>
            {summary.sessions.some(session => session.role === 'audit') ? <div><dt className="text-[color:var(--color-muted)]">Machine audits{partial ? ' · known portion' : ''}</dt><dd className="font-semibold tabular-nums">{unpricedOnly ? 'Unavailable' : money(summary.audit_estimated_usd)}</dd></div> : null}
          </dl>
        </>
      )}
      <p className="mt-3 max-w-3xl text-xs text-[color:var(--color-muted)]">{summary.basis}</p>
      {summary.missing_sessions.length > 0 ? <p className="mt-2 text-sm">{summary.missing_sessions.length} {summary.missing_sessions.length === 1 ? 'session has' : 'sessions have'} no recorded usage.</p> : null}
      {summary.unpriced_models.length > 0 ? <p className="mt-2 break-words text-sm">Models without a price: {summary.unpriced_models.join(', ')}. Their charges are excluded from the subtotal.</p> : null}
      {summary.sessions.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium">Usage and estimated cost by session ({summary.sessions.length})</summary>
          <div tabIndex={0} role="region" aria-label="Session usage and estimated costs" className="mt-3 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-accent)]">
            <table className="w-full min-w-[740px] border-collapse text-left text-xs">
              <thead><tr className="border-b"><th scope="col" className="p-2">Session</th><th scope="col" className="p-2">Input</th><th scope="col" className="p-2">Output</th><th scope="col" className="p-2">Cache read</th><th scope="col" className="p-2">Cache write</th><th scope="col" className="p-2">Estimated USD</th></tr></thead>
              <tbody>{summary.sessions.map(session => <tr key={session.session} className="border-b align-top">
                <th scope="row" className="max-w-xs break-words p-2 text-left font-normal"><span className="font-medium">{session.role === 'audit' ? 'Machine audit' : session.role === 'verification' ? 'Verification' : 'Research'}</span><br /><span className="font-mono">{session.session}</span>{session.limitations.map(note => <p key={note} className="mt-1 text-[color:var(--color-muted)]">{note}</p>)}</th>
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
