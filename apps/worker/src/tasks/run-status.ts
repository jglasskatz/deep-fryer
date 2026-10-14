/**
 * How a run settles once every session has finished. A run is partial
 * success by design — one failed dimension does not discard the others'
 * findings — but a run in which *no* session succeeded produced nothing to
 * review, and reporting it as complete tells staff research happened when it
 * did not (the usual cause is a missing or rejected API key, which fails
 * every session the same way). Such a run settles as failed, so the run page,
 * the failure email, and plan usage (failed sessions are not billed) agree.
 */
export function settledRunStatus(sessionStatuses: readonly string[]): 'complete' | 'failed' {
  return sessionStatuses.some((s) => s === 'complete') ? 'complete' : 'failed';
}
