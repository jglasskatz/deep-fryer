import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BLANK_FACTS,
  portraitStage,
  STAGE_LABEL,
  stageFactsIn,
  startStepStates,
  type StageFacts,
  type StageRun,
} from './portrait-stage';

const t0 = new Date('2026-11-20T12:00:00Z');
const run = (id: string, status: string, applied = true): StageRun => ({ id, status, appliedAt: applied ? t0 : null });
const facts = (over: Partial<StageFacts>): StageFacts => ({ ...BLANK_FACTS, ...over });
const editor = { tenantSlug: 'ithaca', canEdit: true, addHref: '/start?portrait=ithaca' };
const viewer = { ...editor, canEdit: false };

describe('portraitStage: the stage and the next step', () => {
  // One row per state a portrait passes through, as the admin home and /start show it.
  const table: { name: string; facts: StageFacts; stage: string; next: string; href: string | null }[] = [
    {
      name: 'a blank portrait',
      facts: BLANK_FACTS,
      stage: 'draft',
      next: 'Add what you already have, or start the research',
      href: '/start?portrait=ithaca',
    },
    {
      name: 'a queued run',
      facts: facts({ runs: [run('r1', 'planned')] }),
      stage: 'researching',
      next: 'Follow the research',
      href: '/ithaca/admin/research/r1',
    },
    {
      name: 'a running run',
      facts: facts({ runs: [run('r1', 'running')] }),
      stage: 'researching',
      next: 'Follow the research',
      href: '/ithaca/admin/research/r1',
    },
    {
      name: 'a run planned but never started',
      facts: facts({ runs: [run('r1', 'planned', false)] }),
      stage: 'draft',
      next: 'Start the planned research',
      href: '/ithaca/admin/research/r1',
    },
    {
      name: 'a run that stopped with nothing found',
      facts: facts({ runs: [run('r1', 'failed')] }),
      stage: 'draft',
      next: 'See why the research stopped, and try again',
      href: '/ithaca/admin/research/r1',
    },
    {
      name: 'unreviewed findings',
      facts: facts({ runs: [run('r1', 'complete')], awaitingReview: 21 }),
      stage: 'review',
      next: 'Review the research findings',
      href: '/ithaca/admin/review',
    },
    {
      name: 'a human draft',
      facts: facts({ drafts: 1, addedByGroup: true }),
      stage: 'review',
      next: 'Review the draft and publish it',
      href: '/ithaca/admin/review',
    },
    {
      name: 'several drafts',
      facts: facts({ drafts: 3, addedByGroup: true }),
      stage: 'review',
      next: 'Review the 3 drafts and publish them',
      href: '/ithaca/admin/review',
    },
    {
      name: 'a published dimension with nothing newer',
      facts: facts({ isPublic: true, runs: [run('r1', 'complete')], addedByGroup: true }),
      stage: 'public',
      next: 'See the doughnut as visitors do',
      href: '/ithaca',
    },
    {
      name: 'a published portrait researched again',
      facts: facts({ isPublic: true, runs: [run('r2', 'running'), run('r1', 'complete')] }),
      stage: 'public',
      next: 'Follow the research',
      href: '/ithaca/admin/research/r2',
    },
    {
      name: 'a published portrait with new findings',
      facts: facts({ isPublic: true, runs: [run('r2', 'complete'), run('r1', 'complete')], awaitingReview: 2 }),
      stage: 'public',
      next: 'Review the new research findings',
      href: '/ithaca/admin/review',
    },
  ];

  for (const row of table) {
    it(`${row.name}: ${row.stage}, then "${row.next}"`, () => {
      const s = portraitStage(row.facts, editor);
      expect(s.stage).toBe(row.stage);
      expect(s.label).toBe(STAGE_LABEL[s.stage]);
      expect(s.next.text).toBe(row.next);
      expect(s.next.href).toBe(row.href);
      expect(s.summary.length).toBeGreaterThan(0);
    });
  }

  it('a published portrait with a newer draft reads "public", then "review the newer draft"', () => {
    const s = portraitStage(facts({ isPublic: true, runs: [run('r1', 'complete')], drafts: 1, addedByGroup: true }), editor);
    expect(s.stage).toBe('public');
    expect(s.label).toBe('Public');
    expect(s.next.text).toMatch(/^Review the newer draft\b/);
    expect(s.next.text).toBe('Review the newer draft and publish it');
    expect(s.next.href).toBe('/ithaca/admin/review');
    expect(s.summary).toContain('Anyone can see the published topics.');
    expect(s.summary).toContain('1 topic has a draft not yet published.');
  });

  it('findings to review come before following a run that is still going', () => {
    const s = portraitStage(facts({ runs: [run('r2', 'running'), run('r1', 'complete')], awaitingReview: 4 }), editor);
    expect(s.stage).toBe('researching');
    expect(s.next.text).toBe('Review the research findings');
    expect(s.summary).toContain('4 topics have research findings to review.');
  });

  it('says what each stage means in plain words', () => {
    expect(portraitStage(BLANK_FACTS, editor).summary).toBe('Nothing has been added yet, and nothing is public.');
    expect(portraitStage(facts({ runs: [run('r1', 'planned')] }), editor).summary).toMatch(/^Research is queued and starts shortly\./);
    expect(portraitStage(facts({ runs: [run('r1', 'running')] }), editor).summary).toMatch(/^Research is under way\./);
    expect(portraitStage(facts({ runs: [run('r1', 'complete')] }), editor).summary).toMatch(/nothing from it is waiting for review/);
    expect(STAGE_LABEL).toEqual({ draft: 'Draft', researching: 'Being researched', review: 'Waiting for review', public: 'Public' });
  });

  it('without a self-serve start, a blank portrait begins on the research page', () => {
    const s = portraitStage(BLANK_FACTS, { ...editor, addHref: null });
    expect(s.next).toEqual({ kind: 'add-or-research', text: 'Plan the first research', href: '/ithaca/admin/research' });
  });

  it('tells someone below editor who does the next step, and links nothing they cannot open', () => {
    for (const row of table) {
      const s = portraitStage(row.facts, viewer);
      if (s.next.kind === 'see-public') {
        // The public page is open to anyone.
        expect(s.next.href).toBe('/ithaca');
      } else {
        expect(s.next.href).toBeNull();
        expect(s.next.text).toMatch(/^(Its editors and owners|Nothing to do until the research finishes\.)/);
      }
    }
    expect(portraitStage(facts({ drafts: 1 }), viewer).next.text).toBe('Its editors and owners review the draft and publish it.');
  });

  it('keeps an odd portrait address safe inside the links', () => {
    const s = portraitStage(facts({ runs: [run('a/b', 'running')] }), { ...editor, tenantSlug: 'x y' });
    expect(s.next.href).toBe('/x%20y/admin/research/a%2Fb');
  });
});

describe('startStepStates: the /start markers follow the doughnut', () => {
  const states = (f: StageFacts) => startStepStates(f);
  it('a blank portrait: the place is named, adding what you have is next', () => {
    expect(states(BLANK_FACTS)).toEqual(['done', 'current', 'upcoming', 'upcoming']);
  });
  it('research queued or running: step three is the one under way', () => {
    expect(states(facts({ runs: [run('r1', 'planned')] }))).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(states(facts({ runs: [run('r1', 'running')] }))).toEqual(['done', 'done', 'current', 'upcoming']);
  });
  it('a run planned but not started: step three, with step two still open', () => {
    expect(states(facts({ runs: [run('r1', 'planned', false)] }))).toEqual(['done', 'upcoming', 'current', 'upcoming']);
  });
  it('findings to review: research done, looking it over is now', () => {
    expect(states(facts({ runs: [run('r1', 'complete')], awaitingReview: 3 }))).toEqual(['done', 'done', 'done', 'current']);
  });
  it('the group’s own draft and no research: looking it over is now, research still to come', () => {
    expect(states(facts({ drafts: 1, addedByGroup: true }))).toEqual(['done', 'done', 'upcoming', 'current']);
  });
  it('public with nothing waiting: every step done, none current', () => {
    expect(states(facts({ isPublic: true, runs: [run('r1', 'complete')] }))).toEqual(['done', 'done', 'done', 'done']);
  });
  it('public with a newer draft: back to looking it over', () => {
    expect(states(facts({ isPublic: true, runs: [run('r1', 'complete')], drafts: 1 }))).toEqual(['done', 'done', 'done', 'current']);
  });
  it('never more than one step to do now', () => {
    const all: StageFacts[] = [
      BLANK_FACTS,
      facts({ runs: [run('r2', 'running'), run('r1', 'complete')], awaitingReview: 1, drafts: 2 }),
      facts({ isPublic: true, runs: [run('r1', 'failed')] }),
    ];
    for (const f of all) expect(states(f).filter((s) => s === 'current').length).toBeLessThanOrEqual(1);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * stageFactsIn against real Postgres, read as a viewer of the portrait under
 * row-level security: the same facts, in order, that the table above turns
 * into stages — a blank portrait, a queued run, its findings once it
 * finishes, an approved draft, a published dimension (which makes the
 * portrait public) and a newer human draft after it.
 */
describe.skipIf(!hasDb)('stageFactsIn on a real portrait', () => {
  const ids: { tenantId?: string; organizationId?: string; viewer?: string; sessions: string[] } = { sessions: [] };
  let dims: { dimensionId: string; slug: string }[] = [];

  beforeAll(async () => {
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Stage City' });
    ids.tenantId = provisioned.tenant.id;
    ids.organizationId = provisioned.tenant.organizationId;
    dims = provisioned.dimensions;
    const [viewerRow] = await db.insert(m.users).values({ email: `${uniq()}@viewer.example.org` }).returning();
    ids.viewer = viewerRow!.id;
    await db.insert(m.tenantMembers).values({ tenantId: provisioned.tenant.id, userId: viewerRow!.id, role: 'viewer' });
  }, 60_000);

  afterAll(async () => {
    const m = await import('@deep-fryer/db');
    const { eq, inArray, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // Findings are immutable (a trigger refuses even the owner): lift it for this test's own rows only.
    if (ids.sessions.length) {
      await db.transaction(async (t) => {
        await t.execute(sql`alter table findings disable trigger findings_immutable`);
        await t.delete(m.findings).where(inArray(m.findings.sessionId, ids.sessions));
        await t.execute(sql`alter table findings enable trigger findings_immutable`);
      });
    }
    if (ids.tenantId) {
      // Versions approved from a run point at it: they go with their topics, before the runs.
      const runIds = (await db.select({ id: m.researchRuns.id }).from(m.researchRuns).where(eq(m.researchRuns.tenantId, ids.tenantId))).map((r) => r.id);
      if (runIds.length) await db.delete(m.dimensionVersions).where(inArray(m.dimensionVersions.researchRunId, runIds));
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, ids.tenantId));
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, ids.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, ids.tenantId));
    }
    if (ids.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, ids.organizationId));
    if (ids.viewer) await db.delete(m.users).where(eq(m.users.id, ids.viewer));
  });

  /** The facts as the viewer reads them, through row-level security. */
  const asViewer = async () => {
    const m = await import('@deep-fryer/db');
    return m.withAuthContext(m.getDb(), ids.viewer!, (db) => stageFactsIn(db, ids.tenantId!));
  };
  const stageNow = async () => portraitStage(await asViewer(), { ...editor, canEdit: true });

  it('walks through every stage as the portrait is researched, reviewed and published', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const [a, b] = dims;

    // A blank portrait: its starting versions are nobody's drafts.
    expect(await asViewer()).toEqual(BLANK_FACTS);
    expect((await stageNow()).stage).toBe('draft');

    // A queued run.
    const spec = (slug: string) => ({ kind: 'dimension' as const, dimension_slug: slug, prompt: 'p', tool_allowlist: [], output_schema_ref: 'r', config_hash: 'h' });
    const [r1] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: ids.tenantId!,
        status: 'planned',
        plan: { sessions: [spec(a!.slug), spec(b!.slug)], config_hash: 'h', plugin_version: 'v' },
        configSnapshot: {} as never,
        appliedAt: new Date(),
      })
      .returning();
    let f = await asViewer();
    expect(f.runs).toEqual([{ id: r1!.id, status: 'planned', appliedAt: expect.any(Date) }]);
    expect((await stageNow()).stage).toBe('researching');

    // It finishes with findings for two topics, and a stand-in for a third that waits for its own decision.
    await db.update(m.researchRuns).set({ status: 'complete' }).where(eq(m.researchRuns.id, r1!.id));
    const sessions = await db
      .insert(m.researchSessions)
      .values([
        { runId: r1!.id, kind: 'dimension', dimensionId: a!.dimensionId, status: 'complete' },
        { runId: r1!.id, kind: 'dimension', dimensionId: b!.dimensionId, status: 'complete' },
        { runId: r1!.id, kind: 'dimension', dimensionId: dims[2]!.dimensionId, status: 'complete' },
      ])
      .returning();
    ids.sessions = sessions.map((s) => s.id);
    const gap = (slug: string) => ({ kind: 'gap' as const, indicator_slug: slug, reason: 'None published.', scales_tried: ['city' as const], searched_at: t0.toISOString() });
    await db.insert(m.findings).values([
      { sessionId: sessions[0]!.id, dimensionId: a!.dimensionId, indicatorSlug: 'x', payload: gap('x') },
      { sessionId: sessions[0]!.id, dimensionId: a!.dimensionId, indicatorSlug: 'y', payload: gap('y') },
      { sessionId: sessions[1]!.id, dimensionId: b!.dimensionId, indicatorSlug: 'z', payload: gap('z') },
      {
        sessionId: sessions[2]!.id,
        dimensionId: dims[2]!.dimensionId,
        indicatorSlug: 'w',
        payload: { kind: 'proxy' } as never,
        verification: { schema_ok: true } as never,
      },
    ]);
    f = await asViewer();
    expect(f.awaitingReview).toBe(2);
    expect(f.drafts).toBe(0);
    let s = await stageNow();
    expect(s.stage).toBe('review');
    expect(s.next.text).toBe('Review the research findings');

    // One topic approved from the run: a draft waiting to be published, one topic still to review.
    const latestA = await m.latestVersion(db, a!.dimensionId);
    const approved = await m.appendDimensionVersion(db, {
      dimensionId: a!.dimensionId,
      status: 'draft',
      data: latestA!.data,
      origin: 'research',
      researchRunId: r1!.id,
      createdBy: ids.viewer!,
    });
    f = await asViewer();
    expect(f).toMatchObject({ awaitingReview: 1, drafts: 1, addedByGroup: false, isPublic: false });

    // The other topic edited by a person since the run began: dealt with, and a draft of its own.
    const latestB = await m.latestVersion(db, b!.dimensionId);
    await m.appendDimensionVersion(db, { dimensionId: b!.dimensionId, status: 'draft', data: latestB!.data, origin: 'human', changeNote: 'Typed in by the group', createdBy: ids.viewer! });
    f = await asViewer();
    expect(f).toMatchObject({ awaitingReview: 0, drafts: 2, addedByGroup: true, isPublic: false });
    s = await stageNow();
    expect(s.stage).toBe('review');
    expect(s.next.text).toBe('Review the 2 drafts and publish them');

    // Publishing the approved draft makes the portrait public; the human draft is still waiting.
    await db.update(m.dimensionVersions).set({ status: 'published', publishedAt: new Date() }).where(eq(m.dimensionVersions.id, approved.id));
    await db.update(m.dimensions).set({ publishedVersionId: approved.id }).where(eq(m.dimensions.id, a!.dimensionId));
    f = await asViewer();
    expect(f).toMatchObject({ isPublic: true, awaitingReview: 0, drafts: 1 });
    s = await stageNow();
    expect(s.stage).toBe('public');
    expect(s.next.text).toBe('Review the newer draft and publish it');

    // A second run finds something for a fourth topic: waiting for review again, on a public portrait.
    const d = dims[3]!;
    const minuteLater = (n: number) => new Date(Date.now() + n * 60_000);
    const [r2] = await db
      .insert(m.researchRuns)
      .values({
        tenantId: ids.tenantId!,
        status: 'complete',
        plan: { sessions: [spec(d.slug)], config_hash: 'h', plugin_version: 'v' },
        configSnapshot: {} as never,
        appliedAt: minuteLater(1),
        createdAt: minuteLater(1),
      })
      .returning();
    const [s2] = await db
      .insert(m.researchSessions)
      .values({ runId: r2!.id, kind: 'dimension', dimensionId: d.dimensionId, status: 'complete' })
      .returning();
    ids.sessions.push(s2!.id);
    await db.insert(m.findings).values({ sessionId: s2!.id, dimensionId: d.dimensionId, indicatorSlug: 'v', payload: gap('v') });
    f = await asViewer();
    expect(f.awaitingReview).toBe(1);
    s = await stageNow();
    expect(s.stage).toBe('public');
    expect(s.next.text).toBe('Review the new research findings');

    // A later run that plans that topic again supersedes those findings; it is planned, not started.
    await db.insert(m.researchRuns).values({
      tenantId: ids.tenantId!,
      status: 'planned',
      plan: { sessions: [spec(d.slug)], config_hash: 'h', plugin_version: 'v' },
      configSnapshot: {} as never,
      createdAt: minuteLater(2),
    });
    f = await asViewer();
    expect(f.runs.map((r) => r.status)).toEqual(['planned', 'complete', 'complete']);
    expect(f.awaitingReview).toBe(0);
    s = await stageNow();
    expect(s.stage).toBe('public');
    expect(s.next.text).toBe('Review the newer draft and publish it');
  });

  it('tells nothing to someone who is not a member', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const [stranger] = await db.insert(m.users).values({ email: `${uniq()}@stranger.example.org` }).returning();
    try {
      const f = await m.withAuthContext(db, stranger!.id, (tx) => stageFactsIn(tx, ids.tenantId!));
      // The portrait is public by now, so the public may know that much; nothing about its work in progress.
      expect(f).toMatchObject({ runs: [], awaitingReview: 0, drafts: 0, addedByGroup: false });
    } finally {
      await db.delete(m.users).where(eq(m.users.id, stranger!.id));
    }
  });
});
