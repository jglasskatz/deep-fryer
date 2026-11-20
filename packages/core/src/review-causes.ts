import type { ResearchModels, ResearchPlan, StrategyName } from './types.js';

/**
 * Why a reviewer decided what they did about a research finding. Every
 * decision on a finding is recorded once, with its cause, so the research
 * routine can later be judged by what reviewers found wrong with it.
 *
 * Approving records the one cause an approval can have, "correct as cited".
 * Editing, re-researching or rejecting (replacing it with a data gap) needs
 * one of the causes below, picked by the reviewer. The order is the order a
 * reviewer sees them in, every time, so a practised hand finds each one in
 * the same place.
 */

/** What a reviewer did with a finding. */
export const REVIEW_DECISIONS = ['approve', 'edit', 're_research', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** The cause every approval records. */
export const APPROVAL_CAUSE = 'correct_as_cited' as const;

/** The causes a reviewer picks from, in the order they are offered, with the words they see. */
export const REVIEW_CAUSES = [
  { id: 'wrong_geography', label: 'Wrong place or area' },
  { id: 'wrong_year', label: 'Wrong year' },
  { id: 'value_not_on_page', label: 'Value not on the cited page' },
  { id: 'home_page_link', label: 'Home-page link' },
  { id: 'wrong_measure', label: 'Wrong measure or total' },
  { id: 'out_of_date', label: 'Out of date' },
  { id: 'source_unreadable', label: "Source can't be read" },
  { id: 'better_source', label: 'A better source exists' },
  { id: 'unsupported', label: "Source doesn't support it" },
  { id: 'placeholder', label: 'Placeholder, not real data' },
  { id: 'other', label: 'Something else' },
] as const;

export type ReviewCause = (typeof REVIEW_CAUSES)[number]['id'];
/** Every cause a recorded decision can carry: the reviewer's choices and the approval's. */
export type ReviewLabelCause = ReviewCause | typeof APPROVAL_CAUSE;

/** Every recordable cause, as the database's check lists them (migration 0032). */
export const REVIEW_LABEL_CAUSES: readonly ReviewLabelCause[] = [APPROVAL_CAUSE, ...REVIEW_CAUSES.map((c) => c.id)];

/** The cause that needs the reviewer's own words. */
export const OTHER_CAUSE = 'other' satisfies ReviewCause;

/** The longest note a decision keeps (the re-research notes' own limit). */
export const REVIEW_NOTE_MAX = 4000;

/** Who may serve the model calls of a run whose findings are labelled; the database allows only these. */
export const REVIEW_LABEL_PROVIDERS = ['anthropic'] as const;
export type ReviewLabelProvider = (typeof REVIEW_LABEL_PROVIDERS)[number];

const causeIds: ReadonlySet<string> = new Set(REVIEW_CAUSES.map((c) => c.id));
const labels: ReadonlyMap<string, string> = new Map<string, string>([
  [APPROVAL_CAUSE, 'Correct as cited'],
  ...REVIEW_CAUSES.map((c) => [c.id, c.label] as [string, string]),
]);

/** True for a cause a reviewer can pick (not the approval's own). */
export function isReviewCause(value: unknown): value is ReviewCause {
  return typeof value === 'string' && causeIds.has(value);
}

/** The words a person sees for a cause, the approval's included. */
export function reviewCauseLabel(cause: ReviewLabelCause): string {
  return labels.get(cause) ?? cause;
}

/** What a decision says when no cause was picked. */
export const CAUSE_MISSING = 'Choose why first.';
/** What a decision says when "Something else" came without words. */
export const OTHER_NEEDS_WORDS = 'You chose "Something else": say in a few words what is wrong.';

export type CauseCheck = { ok: true; cause: ReviewCause } | { ok: false; problem: string };

/**
 * Whether a cause sent with an edit, a re-research or a rejection can be
 * recorded: it must be one of the reviewer's causes, and "Something else"
 * needs words of its own (the decision's note). Says why not, in plain words.
 */
export function checkReviewCause(cause: unknown, note?: string | null): CauseCheck {
  if (!isReviewCause(cause)) return { ok: false, problem: CAUSE_MISSING };
  if (cause === OTHER_CAUSE && !(typeof note === 'string' && note.trim())) return { ok: false, problem: OTHER_NEEDS_WORDS };
  return { ok: true, cause };
}

/** A note as it is kept: trimmed, cut to the limit, and absent when empty. */
export function reviewNote(note: string | null | undefined): string | null {
  const trimmed = typeof note === 'string' ? note.trim() : '';
  return trimmed ? trimmed.slice(0, REVIEW_NOTE_MAX) : null;
}

/**
 * Which of a dimension's machine-audit decisions a person must give a cause
 * for before applying them, by finding id. Applying sends the dimension back
 * to research when any decision is a re-research, and then only those
 * findings are decided; otherwise every edit and every rejection is. An
 * approval needs no cause.
 */
export function auditCausesNeeded(decisions: readonly { findingId: string; disposition: ReviewDecision }[]): string[] {
  const reruns = decisions.filter((d) => d.disposition === 're_research');
  const decided = reruns.length ? reruns : decisions.filter((d) => d.disposition === 'edit' || d.disposition === 'reject');
  return decided.map((d) => d.findingId);
}

/** One recorded decision, as the review_labels table stores it. */
export interface ReviewLabelRow {
  tenantId: string;
  /** Null only when the dimension had no findings in the run (a session that recorded none). */
  findingId: string | null;
  runId: string;
  dimensionId: string;
  decision: ReviewDecision;
  cause: ReviewLabelCause;
  note: string | null;
  strategy: StrategyName | null;
  strategyVersion: number | null;
  models: ResearchModels | null;
  provider: ReviewLabelProvider;
  reviewerId: string;
}

export interface ReviewLabelInput {
  tenantId: string;
  dimensionId: string;
  run: {
    id: string;
    plan: Pick<ResearchPlan, 'strategy' | 'strategy_version' | 'models'>;
    /** The run's recorded execution; older runs have none, and ran on the default provider. */
    execution: { provider: string } | null;
  };
  /** The findings the decision covers; none records one row for the dimension. */
  findingIds: readonly string[];
  decision: ReviewDecision;
  /** Ignored for an approval, which always records "correct as cited". */
  cause?: ReviewCause;
  note?: string | null;
  reviewerId: string;
}

/**
 * The rows one decision writes: one per finding it covers, each naming the
 * run's strategy, version, models and provider as the plan recorded them
 * (null where an older plan recorded none). The caller checks the cause
 * with checkReviewCause first, to tell the person; a cause that is still
 * missing here is a programming error.
 */
export function reviewLabelRows(input: ReviewLabelInput): ReviewLabelRow[] {
  const approve = input.decision === 'approve';
  if (!approve && !checkReviewCause(input.cause, input.note).ok) {
    throw new Error(`A ${input.decision} decision needs a complete cause.`);
  }
  const provider = input.run.execution?.provider ?? 'anthropic';
  if (!(REVIEW_LABEL_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`Review labels cannot record the provider "${provider}" yet.`);
  }
  const { plan } = input.run;
  const shared = {
    tenantId: input.tenantId,
    runId: input.run.id,
    dimensionId: input.dimensionId,
    decision: input.decision,
    cause: approve ? APPROVAL_CAUSE : input.cause!,
    note: approve ? null : reviewNote(input.note),
    strategy: plan.strategy ?? null,
    strategyVersion: plan.strategy_version ?? null,
    models: plan.models ?? null,
    provider: provider as ReviewLabelProvider,
    reviewerId: input.reviewerId,
  };
  const ids = input.findingIds.length ? [...new Set(input.findingIds)] : [null];
  return ids.map((findingId) => ({ ...shared, findingId }));
}
