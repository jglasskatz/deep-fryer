import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { dimensions, dimensionVersions, researchRuns, tenantIsPublic, tenants, type DbExecutor } from '@deep-fryer/db';
import type { StepState } from '@/components/onboarding/StartSteps';
import { userDb } from './db';
import { runInProgress, runPhase } from './run-progress';

/**
 * Where a portrait's doughnut stands, and the one thing to do next, as the
 * admin home (above its checklist) and /start (above its steps) show it. Four stages, in the
 * order a doughnut normally passes through them:
 *
 * - `draft`: nothing is waiting on anyone yet — a blank portrait, research
 *   planned but not started, or research that stopped with nothing found;
 * - `researching`: a research run is queued or running;
 * - `review`: research findings nobody has dealt with, or drafts a person
 *   made or approved that are not published yet;
 * - `public`: the portrait is live and has published at least once (the
 *   same rule as tenantIsPublic in packages/db), whatever else is going on —
 *   a published portrait with a newer draft is still public, and its next
 *   step is to review that draft.
 *
 * portraitStage() is pure over the facts stageFactsIn() reads, so the
 * pages and the tests share one set of rules.
 */
export type StageName = 'draft' | 'researching' | 'review' | 'public';

/** The stage in words, as the pages show it. */
export const STAGE_LABEL: Record<StageName, string> = {
  draft: 'Draft',
  researching: 'Being researched',
  review: 'Waiting for review',
  public: 'Public',
};

/** A research run, as far as the stage reads it. */
export interface StageRun {
  id: string;
  status: string;
  appliedAt: Date | null;
}

/** What the stage is worked out from (stageFactsIn reads it; tests write it by hand). */
export interface StageFacts {
  /** Live, and published at least once (tenantIsPublic). */
  isPublic: boolean;
  /** The portrait's research runs, newest first. */
  runs: readonly StageRun[];
  /**
   * Topics with research findings nobody has dealt with yet: not approved
   * from that run, not edited by a person since the run began, and not
   * researched again by a later run (the dispositions bulk approval counts,
   * lib/draft-portrait.ts). Stand-in measures are left out: they wait for a
   * decision of their own.
   */
  awaitingReview: number;
  /**
   * Topics whose newest version is a draft a person wrote or approved, not
   * yet published (the list the review page offers to publish). The blank
   * versions a new portrait starts with are not drafts anyone made.
   */
  drafts: number;
  /** Someone in the group has written a version of a topic themselves. */
  addedByGroup: boolean;
}

/** A portrait with nothing in it yet, as /start creates one. */
export const BLANK_FACTS: StageFacts = { isPublic: false, runs: [], awaitingReview: 0, drafts: 0, addedByGroup: false };

/** What the next step is about, which also decides which /start step is the one to do now. */
export type NextKind =
  | 'review-findings'
  | 'publish-drafts'
  | 'follow-research'
  | 'start-planned'
  | 'see-why-stopped'
  | 'add-or-research'
  | 'see-public';

export interface NextStep {
  kind: NextKind;
  /**
   * What to do, as the words of a link (`href` set), or, for someone who
   * cannot do it (below editor), who does it and nothing to follow.
   */
  text: string;
  /** Where to do it; null when this person cannot. */
  href: string | null;
}

export interface PortraitStage {
  stage: StageName;
  label: string;
  /** One or two plain sentences on what the stage means for this portrait now. */
  summary: string;
  next: NextStep;
}

export interface StageOptions {
  tenantSlug: string;
  /** Editors and owners act on the portrait; anyone below is told who can. */
  canEdit: boolean;
  /**
   * Where "add what you already have" is offered: /start's own step two
   * when the page is /start, /start for the portrait from elsewhere, or
   * null when this server has no self-serve start (the research page is
   * then the way to begin).
   */
  addHref: string | null;
}

const topics = (n: number) => `${n} topic${n === 1 ? '' : 's'}`;

/** Pure: the stage and the next thing to do, for one portrait. */
export function portraitStage(facts: StageFacts, options: StageOptions): PortraitStage {
  const stage = stageOf(facts);
  return { stage, label: STAGE_LABEL[stage], summary: summaryOf(stage, facts), next: nextStep(facts, options) };
}

function stageOf(facts: StageFacts): StageName {
  if (facts.isPublic) return 'public';
  if (facts.runs.some((r) => runInProgress(runPhase(r)))) return 'researching';
  if (facts.awaitingReview > 0 || facts.drafts > 0) return 'review';
  return 'draft';
}

function summaryOf(stage: StageName, facts: StageFacts): string {
  const going = facts.runs.find((r) => runInProgress(runPhase(r)));
  const have = (n: number) => `${topics(n)} ${n === 1 ? 'has' : 'have'}`;
  const waitingLine = [
    facts.awaitingReview > 0 ? ` ${have(facts.awaitingReview)} research findings to review.` : '',
    facts.drafts > 0 ? ` ${have(facts.drafts)} a draft not yet published.` : '',
  ].join('');
  switch (stage) {
    case 'public':
      return `Anyone can see the published topics.${going ? ' New research is under way.' : ''}${waitingLine}`;
    case 'researching':
      return `${
        going && runPhase(going) === 'queued' ? 'Research is queued and starts shortly.' : 'Research is under way. It takes a while.'
      } Nothing is public until your group publishes it.${waitingLine}`;
    case 'review':
      return `Nothing is public yet.${waitingLine}`;
    case 'draft': {
      // In the order nextStep() looks, so the sentence and the next step agree.
      const newest = facts.runs[0];
      if (facts.runs.some((r) => runPhase(r) === 'unapplied')) return 'Research is planned but has not started. Nothing is public yet.';
      if (newest && runPhase(newest) === 'failed') return 'The last research stopped before it found anything to review. Nothing is public yet.';
      if (newest) return 'The last research finished, and nothing from it is waiting for review. Nothing is public yet.';
      if (facts.addedByGroup) return 'Nothing is waiting for review, and nothing is public yet.';
      return 'Nothing has been added yet, and nothing is public.';
    }
  }
}

function nextStep(facts: StageFacts, { tenantSlug, canEdit, addHref }: StageOptions): NextStep {
  const base = `/${encodeURIComponent(tenantSlug)}`;
  const runHref = (id: string) => `${base}/admin/research/${encodeURIComponent(id)}`;
  const editors = 'Its editors and owners';
  const act = (kind: NextKind, todo: string, href: string, byOthers: string): NextStep =>
    canEdit ? { kind, text: todo, href } : { kind, text: byOthers, href: null };

  if (facts.awaitingReview > 0) {
    const todo = facts.isPublic ? 'Review the new research findings' : 'Review the research findings';
    return act('review-findings', todo, `${base}/admin/review`, `${editors} review the research findings.`);
  }
  if (facts.drafts > 0) {
    const what = facts.isPublic
      ? facts.drafts === 1
        ? 'the newer draft'
        : `the ${facts.drafts} newer drafts`
      : facts.drafts === 1
        ? 'the draft'
        : `the ${facts.drafts} drafts`;
    const it = facts.drafts === 1 ? 'it' : 'them';
    return act('publish-drafts', `Review ${what} and publish ${it}`, `${base}/admin/review`, `${editors} review ${what} and publish ${it}.`);
  }
  const going = facts.runs.find((r) => runInProgress(runPhase(r)));
  if (going) {
    return act('follow-research', 'Follow the research', runHref(going.id), 'Nothing to do until the research finishes.');
  }
  if (facts.isPublic) {
    // The public page is open to everyone, so anyone may follow this link.
    return { kind: 'see-public', text: 'See the doughnut as visitors do', href: base };
  }
  const planned = facts.runs.find((r) => runPhase(r) === 'unapplied');
  if (planned) {
    return act('start-planned', 'Start the planned research', runHref(planned.id), `${editors} can start the planned research.`);
  }
  const newest = facts.runs[0];
  if (newest && runPhase(newest) === 'failed') {
    return act(
      'see-why-stopped',
      'See why the research stopped, and try again',
      runHref(newest.id),
      `${editors} can see why the research stopped and try again.`,
    );
  }
  return addHref
    ? act('add-or-research', 'Add what you already have, or start the research', addHref, `${editors} can add what the group already has, or start the research.`)
    : act('add-or-research', 'Plan the first research', `${base}/admin/research`, `${editors} can plan the first research.`);
}

/**
 * Pure: each of /start's four steps (components/onboarding/StartSteps.tsx
 * START_STEPS) for this portrait, so the markers follow the doughnut along.
 * The place is named, so step one is done. Step two is done once the group
 * has added something or research has been started; step three once a run
 * has finished; step four once the portrait is public with nothing newer
 * waiting. The step to do now is the one the next step belongs to — none
 * when the doughnut is public and nothing is waiting.
 */
export function startStepStates(facts: StageFacts): [StepState, StepState, StepState, StepState] {
  const done = [
    true,
    facts.addedByGroup || facts.isPublic || facts.runs.some((r) => r.appliedAt !== null),
    facts.runs.some((r) => runPhase(r) === 'complete'),
    facts.isPublic && facts.awaitingReview === 0 && facts.drafts === 0,
  ];
  const kind = nextStep(facts, { tenantSlug: '-', canEdit: true, addHref: null }).kind;
  const current =
    kind === 'review-findings' || kind === 'publish-drafts'
      ? 3
      : kind === 'follow-research' || kind === 'start-planned' || kind === 'see-why-stopped'
        ? 2
        : kind === 'add-or-research'
          ? 1
          : -1;
  return done.map((d, i): StepState => (i === current ? 'current' : d ? 'done' : 'upcoming')) as [
    StepState,
    StepState,
    StepState,
    StepState,
  ];
}

/** The facts for one portrait, as the signed-in person may see them, in a transaction of their own (for pages). */
export async function portraitStageFacts(tenantId: string): Promise<StageFacts> {
  return userDb((db) => stageFactsIn(db, tenantId));
}

/**
 * The facts for one portrait, read on the caller's transaction (a userDb
 * one, so row-level security shows only what this person may see: every
 * member, viewers included, reads runs, findings and versions). Four reads,
 * each bounded by the portrait's own rows.
 */
export async function stageFactsIn(db: DbExecutor, tenantId: string): Promise<StageFacts> {
  const [tenantRows, runs, waiting, latest, added] = await Promise.all([
    db.select({ isPublic: sql<boolean>`${tenantIsPublic()}` }).from(tenants).where(eq(tenants.id, tenantId)),
    db
      .select({ id: researchRuns.id, status: researchRuns.status, appliedAt: researchRuns.appliedAt })
      .from(researchRuns)
      .where(eq(researchRuns.tenantId, tenantId))
      .orderBy(desc(researchRuns.createdAt)),
    // Each topic with a finding from a settled run that nobody has dealt
    // with: no version approved from that run, no version a person made
    // since the run began, and no later run that plans the topic again.
    // Times compare inside the database, at its own precision.
    db.execute<{ n: number }>(sql`
      SELECT count(DISTINCT f.dimension_id)::int AS n
        FROM findings f
        JOIN research_sessions s ON s.id = f.session_id
        JOIN research_runs r ON r.id = s.run_id
        JOIN dimensions d ON d.id = f.dimension_id
       WHERE r.tenant_id = ${tenantId}::uuid
         AND r.status IN ('complete', 'failed')
         AND d.archived_at IS NULL
         AND NOT (f.payload->>'kind' = 'proxy' AND f.verification->>'schema_ok' = 'true')
         AND NOT EXISTS (
               SELECT 1 FROM dimension_versions v
                WHERE v.dimension_id = f.dimension_id AND v.research_run_id = r.id)
         AND NOT EXISTS (
               SELECT 1 FROM dimension_versions v
                WHERE v.dimension_id = f.dimension_id AND v.origin = 'human' AND v.created_at > r.created_at)
         AND NOT EXISTS (
               SELECT 1 FROM research_runs later, jsonb_array_elements(later.plan->'sessions') planned
                WHERE later.tenant_id = r.tenant_id
                  AND later.id <> r.id
                  AND later.created_at > r.created_at
                  AND planned->>'kind' = 'dimension'
                  AND planned->>'dimension_slug' = d.slug)`),
    db
      .selectDistinctOn([dimensionVersions.dimensionId], {
        status: dimensionVersions.status,
        origin: dimensionVersions.origin,
        createdBy: dimensionVersions.createdBy,
      })
      .from(dimensionVersions)
      .innerJoin(dimensions, eq(dimensions.id, dimensionVersions.dimensionId))
      .where(and(eq(dimensions.tenantId, tenantId), isNull(dimensions.archivedAt)))
      .orderBy(dimensionVersions.dimensionId, desc(dimensionVersions.versionNum)),
    db
      .select({ id: dimensionVersions.id })
      .from(dimensionVersions)
      .innerJoin(dimensions, eq(dimensions.id, dimensionVersions.dimensionId))
      .where(
        and(
          eq(dimensions.tenantId, tenantId),
          eq(dimensionVersions.origin, 'human'),
          sql`${dimensionVersions.createdBy} IS NOT NULL`,
        ),
      )
      .limit(1),
  ]);
  return {
    isPublic: tenantRows[0]?.isPublic === true,
    runs,
    awaitingReview: waiting[0]?.n ?? 0,
    drafts: latest.filter((v) => v.status === 'draft' && v.origin !== 'import' && v.createdBy !== null).length,
    addedByGroup: added.length > 0,
  };
}
