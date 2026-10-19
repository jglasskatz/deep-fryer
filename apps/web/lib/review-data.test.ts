import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { onOneConnection } from '../test/one-connection';

/**
 * Failed runs on the staff pages: why each session failed (read from its
 * transcript in the system context, returned only as a plain-words cause),
 * and the review queue listing failed runs — and offering a failed run's
 * findings for review — instead of "No completed research runs yet". As a
 * signed-in editor of a portrait that has not published yet (members still
 * see theirs, migration 0015).
 */

let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `rd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const tx = (...frames: unknown[]) => gzipSync(frames.map((f) => JSON.stringify(f)).join('\n'));

describe.skipIf(!hasDb)('failed runs on the run page and in the review queue', () => {
  const saved = { auth: process.env.AUTH_SECRET, key: process.env.DF_RESEARCH_KEY_CONFIGURED };
  const ids: {
    tenantId?: string;
    organizationId?: string;
    editor?: string;
    keyless?: string;
    withFindings?: string;
    complete?: string;
    findingSession?: string;
    sessions: { region: string; refused: string; silent: string };
  } = { sessions: { region: '', refused: '', silent: '' } };

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant, dimensions } = await m.provisionTenant(db, { slug: uniq(), name: 'Failure City' });
    ids.tenantId = tenant.id;
    ids.organizationId = tenant.organizationId;
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    ids.editor = editor!.id;
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: editor!.id, role: 'editor' });

    const spec = (dimension_slug?: string) => ({
      kind: dimension_slug ? ('dimension' as const) : ('region_context' as const),
      ...(dimension_slug ? { dimension_slug } : {}),
      prompt: 'p',
      tool_allowlist: [],
      output_schema_ref: 'r',
      config_hash: 'h',
    });
    const newRun = async (status: 'failed' | 'complete', minutesAgo: number) => {
      const [run] = await db
        .insert(m.researchRuns)
        .values({
          tenantId: tenant.id,
          status,
          plan: { sessions: [spec(), spec(dimensions[0]!.slug), spec(dimensions[1]!.slug), spec(dimensions[2]!.slug)], config_hash: 'h', plugin_version: 'v' },
          configSnapshot: {} as never,
          createdAt: new Date(Date.now() - minutesAgo * 60_000),
          appliedAt: new Date(Date.now() - minutesAgo * 60_000),
        })
        .returning();
      return run!.id;
    };

    // A plan-funded run on a server with no research key: the CLI exited (the
    // only thing a thrown session records), one stream names the refused key,
    // one session was failed with nothing recorded, one never started.
    ids.keyless = await newRun('failed', 30);
    const rows = await db
      .insert(m.researchSessions)
      .values([
        { runId: ids.keyless, kind: 'region_context', status: 'failed', transcript: tx({ type: 'session_error', message: 'Claude Code process exited with code 1' }) },
        {
          runId: ids.keyless,
          kind: 'dimension',
          dimensionId: dimensions[0]!.dimensionId,
          status: 'failed',
          transcript: tx(
            { type: 'system', subtype: 'init' },
            { type: 'assistant', message: { content: [{ type: 'text', text: 'Invalid API key · Please run /login' }] }, parent_tool_use_id: null, error: 'authentication_failed' },
            { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key' },
          ),
        },
        { runId: ids.keyless, kind: 'dimension', dimensionId: dimensions[1]!.dimensionId, status: 'failed' },
      ])
      .returning();
    ids.sessions = { region: rows[0]!.id, refused: rows[1]!.id, silent: rows[2]!.id };

    // A failed run that recorded a finding before it stopped, and a complete one.
    ids.withFindings = await newRun('failed', 20);
    const [session] = await db
      .insert(m.researchSessions)
      .values({ runId: ids.withFindings, kind: 'dimension', dimensionId: dimensions[0]!.dimensionId, status: 'failed', transcript: tx({ type: 'session_error', message: 'Connection closed mid-response' }) })
      .returning();
    ids.findingSession = session!.id;
    await db.insert(m.findings).values({
      sessionId: session!.id,
      dimensionId: dimensions[0]!.dimensionId,
      indicatorSlug: 'water-access',
      payload: { kind: 'gap', indicator_slug: 'water-access', reason: 'None published.', scales_tried: ['city'], searched_at: new Date().toISOString() },
    });
    ids.complete = await newRun('complete', 10);
  });

  afterAll(async () => {
    signedIn = null;
    for (const [k, v] of [['AUTH_SECRET', saved.auth], ['DF_RESEARCH_KEY_CONFIGURED', saved.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const db = m.getDb();
    // Findings are immutable (migration 0001's trigger refuses even the
    // owner): this test's one finding goes in a transaction that lifts the
    // trigger for that delete only (DDL is transactional).
    if (ids.findingSession) {
      await db.transaction(async (t) => {
        await t.execute(sql`alter table findings disable trigger findings_immutable`);
        await t.delete(m.findings).where(eq(m.findings.sessionId, ids.findingSession!));
        await t.execute(sql`alter table findings enable trigger findings_immutable`);
      });
    }
    if (ids.tenantId) {
      await db.delete(m.researchRuns).where(eq(m.researchRuns.tenantId, ids.tenantId));
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, ids.tenantId));
      await db.delete(m.tenants).where(eq(m.tenants.id, ids.tenantId));
    }
    if (ids.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, ids.organizationId));
    if (ids.editor) await db.delete(m.users).where(eq(m.users.id, ids.editor));
  });

  it('names each failed session’s cause in plain words, from its transcript', async () => {
    const { runFailureCauses } = await import('./review-data');
    delete process.env.DF_RESEARCH_KEY_CONFIGURED;
    const causes = await runFailureCauses(ids.tenantId!, ids.keyless!);
    expect(causes.size).toBe(3);
    // No research key on the server: a session that only says the CLI exited is that.
    expect(causes.get(ids.sessions.region)!.kind).toBe('service_not_configured');
    expect(causes.get(ids.sessions.refused)!.message).toMatch(/^The research service isn't configured on this server/);
    expect(causes.get(ids.sessions.silent)!.kind).toBe('interrupted');

    // The transcript's reading is kept, the cause is not: a key configured
    // since leaves the uninformative session "stopped unexpectedly".
    process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
    const again = await runFailureCauses(ids.tenantId!, ids.keyless!);
    expect(again.get(ids.sessions.region)!.kind).toBe('stopped_unexpectedly');
    expect(again.get(ids.sessions.refused)!.kind).toBe('service_not_configured');

    // Another portrait's id answers nothing: the run is checked against it in the query.
    expect((await runFailureCauses(ids.organizationId!, ids.keyless!)).size).toBe(0);
  });

  it('lists failed runs with their main cause, and offers a failed run’s findings for review', async () => {
    delete process.env.DF_RESEARCH_KEY_CONFIGURED;
    signedIn = ids.editor!;
    // One connection: the transcripts are read after the user transaction, never inside it.
    const queue = await onOneConnection(async () => (await import('./review-data')).reviewQueue(ids.tenantId!));
    expect(queue.reviewableRuns.map((r) => r.id)).toEqual([ids.complete, ids.withFindings]);
    // Every planned session that did not complete counts, started or not (4 planned in each).
    expect(queue.failedRuns.map((f) => [f.run.id, f.incompleteSessions, f.findings, f.cause.kind])).toEqual([
      [ids.withFindings, 4, 1, 'provider_unavailable'],
      [ids.keyless, 4, 0, 'service_not_configured'],
    ]);

    // The failed run with a finding opens as a review card.
    const failedSelected = await (await import('./review-data')).reviewQueue(ids.tenantId!, ids.withFindings);
    expect(failedSelected.selectedRun?.id).toBe(ids.withFindings);
    expect(failedSelected.cards.map((c) => c.findings.length)).toEqual([1]);
    // A failed run with nothing recorded is never "selected" for review.
    expect((await (await import('./review-data')).reviewQueue(ids.tenantId!, ids.keyless)).selectedRun).toBeNull();
  });

  it('names the portrait’s dimensions for the run page', async () => {
    signedIn = ids.editor!;
    const { slugById, nameBySlug } = await (await import('./review-data')).runDimensionLabels(ids.tenantId!);
    expect(slugById.size).toBeGreaterThan(0);
    const [slug] = [...slugById.values()];
    expect(nameBySlug.get(slug!)).toBeTruthy();
  });
});
