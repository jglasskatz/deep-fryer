/**
 * How a run settles once every session has finished. A run is partial
 * success by design — one failed dimension does not discard the others'
 * findings — but a run in which *no* dimension session succeeded produced
 * nothing to review (even if Phase-0 `region_context` completed), and
 * reporting it as complete tells staff research happened when it did not
 * (the usual cause is a missing or rejected API key, or every dimension
 * failing). Such a run settles as failed, so the run page, the failure email,
 * and plan usage (failed sessions are not billed) agree.
 */
export function settledRunStatus(
  sessions: readonly { kind: string; status: string }[],
): 'complete' | 'failed' {
  return sessions.some((s) => s.kind === 'dimension' && s.status === 'complete')
    ? 'complete'
    : 'failed';
}
