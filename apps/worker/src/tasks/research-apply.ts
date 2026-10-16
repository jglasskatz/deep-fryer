import { gzipSync } from 'node:zlib';
import type { Task } from 'graphile-worker';
import { and, eq, inArray } from 'drizzle-orm';
import type { ContentSupported, FindingPayload, RunTokenUsage } from '@deep-fryer/core';
import { keyHint } from '@deep-fryer/core/secrets';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenants,
  type DbExecutor,
  type ResearchRun,
} from '@deep-fryer/db';
import {
  deterministicChecks,
  mergeVerification,
  renderVerifierPrompt,
  REGION_BRIEF_PLACEHOLDER,
  VERIFIER_MAX_TURNS,
  VERIFIER_TOOLS,
  type ApplyJobPayload,
} from '@deep-fryer/research';
import { closeEvidenceBrowser } from '../evidence.js';
import { OrgKeyUnavailableError, orgApiKeyForTenant } from '../org-key.js';
import { extractJson, runSession, runSessionWithRetry } from '../session.js';
import { tenantStorage } from '../storage.js';
import { notifyRunFinished } from '../notify.js';
import { settledRunStatus } from './run-status.js';

/**
 * Apply (SPEC.md §8): phase-0 region-context session first, its brief
 * injected into every dimension session; findings gated by deterministic
 * checks plus an independent verifier session; failures surface as
 * red-flagged findings, never dropped. Failed runs stay failed — reruns are
 * user-directed from review, not automatic.
 *
 * Paying for it (SPEC-v7 §4): when the portrait's organization has its own
 * Anthropic API key on file, every session of the run — research and
 * verifier alike — runs on that key; otherwise on the deployment's
 * ANTHROPIC_API_KEY. The key is looked up once, before the first session, so
 * a run never mixes the two. A key that is on file but cannot be decrypted
 * fails the run (OrgKeyUnavailableError) rather than quietly spending the
 * deployment's key on a run the plan's allowance never covered.
 */
export const researchApply: Task = async (rawPayload, helpers) => {
  const { runId } = rawPayload as ApplyJobPayload;
  const db = getDb();

  // Atomic claim: only the transition planned → running executes the plan.
  // A no-op claim means either a duplicate/stale job or a crash-interrupted
  // run redelivered by the queue — the latter is settled as failed below so
  // it can never sit in `running` forever.
  const [run] = await db
    .update(researchRuns)
    .set({ status: 'running' })
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, 'planned')))
    .returning();
  if (!run) {
    const [existing] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId));
    if (!existing) {
      helpers.logger.error(`run ${runId} not found`);
    } else if (existing.status === 'running') {
      helpers.logger.error(`run ${runId} was interrupted mid-run; marking failed`);
      await db
        .update(researchSessions)
        .set({ status: 'failed', completedAt: new Date() })
        .where(
          and(
            eq(researchSessions.runId, runId),
            inArray(researchSessions.status, ['queued', 'running']),
          ),
        );
      await db
        .update(researchRuns)
        .set({ status: 'failed', completedAt: new Date() })
        .where(and(eq(researchRuns.id, runId), eq(researchRuns.status, 'running')));
    } else {
      helpers.logger.warn(`run ${runId} is ${existing.status}; skipping`);
    }
    return;
  }

  const usage: RunTokenUsage = {};

  const finish = async (status: 'complete' | 'failed') => {
    await db
      .update(researchRuns)
      .set({ status, completedAt: new Date(), tokenUsage: usage })
      .where(eq(researchRuns.id, runId));
  };

  try {
    // First, before anything else can fail or spend: whose key this run uses.
    const apiKey = await orgApiKeyForTenant(db, run.tenantId);
    if (apiKey) {
      // The hint (last four characters) is what the billing page shows; never more.
      helpers.logger.info(`run ${runId}: running on the organization's own Anthropic API key (…${keyHint(apiKey)})`);
    }
    const keyOption = apiKey ? { apiKey } : {};

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, run.tenantId));
    if (!tenant) throw new Error(`tenant ${run.tenantId} missing`);

    const plan = run.plan;
    const config = run.configSnapshot;
    const storage = await tenantStorage(tenant.slug);

    const tenantDims = await db
      .select()
      .from(dimensions)
      .where(eq(dimensions.tenantId, tenant.id));
    const dimBySlug = new Map(tenantDims.map((d) => [d.slug, d]));

    // Phase 0: region context.
    const regionSpec = plan.sessions.find((s) => s.kind === 'region_context');
    let regionBrief = '(no region brief produced)';
    if (regionSpec) {
      const [row] = await db
        .insert(researchSessions)
        .values({ runId, kind: 'region_context', status: 'running', startedAt: new Date() })
        .returning();
      if (!row) throw new Error('session insert failed');
      const result = await runSessionWithRetry({
        prompt: regionSpec.prompt,
        allowedTools: regionSpec.tool_allowlist,
        ...keyOption,
      });
      usage[row.id] = result.usage;
      await db
        .update(researchSessions)
        .set({
          status: result.succeeded ? 'complete' : 'failed',
          transcript: result.transcript,
          completedAt: new Date(),
        })
        .where(eq(researchSessions.id, row.id));
      if (result.succeeded && result.resultText.trim()) {
        regionBrief = result.resultText;
      }
    }

    // Dimension sessions are independent once the region brief exists (each
    // has its own session row, insert-only findings, per-session usage keys,
    // and evidence captures run in isolated browser contexts), so they run
    // under a bounded pool. RESEARCH_SESSION_CONCURRENCY=1 restores the old
    // serial behavior; the practical ceiling is API throughput.
    const sessionConcurrency = Math.max(1, Number(process.env.RESEARCH_SESSION_CONCURRENCY ?? 3));
    const dimensionSpecs = plan.sessions.filter((s) => s.kind === 'dimension');

    const processDimension = async (spec: (typeof dimensionSpecs)[number]) => {
      const dimension = spec.dimension_slug ? dimBySlug.get(spec.dimension_slug) : undefined;
      if (!dimension) {
        helpers.logger.error(`dimension ${spec.dimension_slug} not found; skipping session`);
        return;
      }
      const [row] = await db
        .insert(researchSessions)
        .values({
          runId,
          dimensionId: dimension.id,
          kind: 'dimension',
          status: 'running',
          startedAt: new Date(),
        })
        .returning();
      if (!row) throw new Error('session insert failed');

      const prompt = spec.prompt.split(REGION_BRIEF_PLACEHOLDER).join(regionBrief);
      const result = await runSessionWithRetry({
        prompt,
        allowedTools: spec.tool_allowlist,
        storage,
        ...keyOption,
      });
      usage[row.id] = result.usage;

      let rawFindings: unknown[] = [];
      let parseOk = true;
      try {
        const parsed = extractJson(result.resultText);
        rawFindings = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        parseOk = false;
        helpers.logger.error(`session ${row.id}: output was not parseable JSON`);
      }

      const verifierUsage = { input_tokens: 0, output_tokens: 0 };
      for (const raw of rawFindings) {
        const { payload, checks } = await deterministicChecks(raw, config, dimension.slug);

        let verdict: { content_supported: ContentSupported; verifier_note?: string } | null;
        if (payload?.kind === 'indicator') {
          verdict = await runVerifier(payload, config.region.name, verifierUsage, apiKey);
        } else if (payload?.kind === 'gap') {
          verdict = {
            content_supported: 'uncertain',
            verifier_note: 'data gap — nothing to fetch; review the search trail',
          };
        } else {
          verdict = {
            content_supported: 'fail',
            verifier_note: 'output did not conform to the finding schema',
          };
        }

        const indicatorSlug =
          payload?.indicator_slug ??
          (typeof raw === 'object' && raw !== null && 'indicator_slug' in raw
            ? String((raw as { indicator_slug: unknown }).indicator_slug)
            : 'unknown');

        await db.insert(findings).values({
          sessionId: row.id,
          dimensionId: dimension.id,
          indicatorSlug,
          payload: (payload ?? raw) as FindingPayload,
          verification: mergeVerification(checks, verdict),
        });
      }
      usage[`verifier:${row.id}`] = verifierUsage;

      await db
        .update(researchSessions)
        .set({
          status: result.succeeded && parseOk ? 'complete' : 'failed',
          transcript: result.transcript,
          completedAt: new Date(),
        })
        .where(eq(researchSessions.id, row.id));
    };

    // Bounded pool: next session starts as soon as a slot frees.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(sessionConcurrency, dimensionSpecs.length) }, async () => {
        while (cursor < dimensionSpecs.length) {
          const spec = dimensionSpecs[cursor++]!;
          await processDimension(spec);
        }
      }),
    );

    const settled = settledRunStatus(
      (
        await db
          .select({ status: researchSessions.status })
          .from(researchSessions)
          .where(eq(researchSessions.runId, runId))
      ).map((r) => r.status),
    );
    await finish(settled);
    if (settled === 'complete') helpers.logger.info(`run ${runId} complete`);
    else helpers.logger.error(`run ${runId} failed: no session succeeded`);
  } catch (err) {
    helpers.logger.error(`run ${runId} failed: ${err instanceof Error ? err.message : err}`);
    if (err instanceof OrgKeyUnavailableError) await failPlannedSessions(db, run, err.message);
    await db
      .update(researchSessions)
      .set({ status: 'failed', completedAt: new Date() })
      .where(
        and(
          eq(researchSessions.runId, runId),
          inArray(researchSessions.status, ['queued', 'running']),
        ),
      );
    await finish('failed');
  } finally {
    await closeEvidenceBrowser().catch(() => {});
  }
  // Settled either way: tell the people who review it.
  await notifyRunFinished(runId);
};

/**
 * A run that could not start — the organization's key is on file but
 * unreadable — still tells staff why. Each planned session gets a failed
 * row whose transcript is the reason, in the shape a session that errored
 * records (session.ts runSessionWithRetry: `{"type":"session_error",…}`).
 * So the run page lists every dimension as failed, the run-finished email
 * counts them, owners who download a transcript read the message, and —
 * failed sessions being free — nothing is counted against the plan.
 */
async function failPlannedSessions(db: DbExecutor, run: ResearchRun, message: string): Promise<void> {
  const dims = await db
    .select({ id: dimensions.id, slug: dimensions.slug })
    .from(dimensions)
    .where(eq(dimensions.tenantId, run.tenantId));
  const idBySlug = new Map(dims.map((d) => [d.slug, d.id]));
  const transcript = gzipSync(JSON.stringify({ type: 'session_error', message }));
  const now = new Date();
  const rows = run.plan.sessions.flatMap((spec) => {
    const dimensionId = spec.dimension_slug ? idBySlug.get(spec.dimension_slug) : undefined;
    if (spec.kind === 'dimension' && !dimensionId) return [];
    return [
      {
        runId: run.id,
        kind: spec.kind,
        dimensionId: dimensionId ?? null,
        status: 'failed' as const,
        transcript,
        startedAt: now,
        completedAt: now,
      },
    ];
  });
  if (rows.length) await db.insert(researchSessions).values(rows);
}

async function runVerifier(
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
  regionName: string,
  acc: { input_tokens: number; output_tokens: number },
  apiKey: string | null,
): Promise<{ content_supported: ContentSupported; verifier_note?: string } | null> {
  const prompt = renderVerifierPrompt({
    indicator_name: payload.name,
    claimed_value: String(payload.value),
    unit: payload.unit,
    year: String(payload.year),
    geography: `${regionName} (${payload.geographic_scale} scale)`,
    source_name: payload.source,
    source_url: payload.source_url,
  });
  try {
    const result = await runSession({
      prompt,
      allowedTools: VERIFIER_TOOLS,
      maxTurns: VERIFIER_MAX_TURNS,
      // The adversarial reviewer runs on the strongest model regardless of the
      // researcher's model — a constant, maximally-skeptical judge, so strategy
      // comparisons measure the researcher, never the leniency of its grader.
      model: process.env.VERIFIER_MODEL ?? 'claude-opus-5',
      // Verifiers are part of the run's spend: the same key as its researchers.
      ...(apiKey ? { apiKey } : {}),
    });
    acc.input_tokens += result.usage.input_tokens;
    acc.output_tokens += result.usage.output_tokens;
    const parsed = extractJson(result.resultText) as {
      content_supported?: string;
      verifier_note?: string;
    };
    if (
      parsed.content_supported === 'pass' ||
      parsed.content_supported === 'fail' ||
      parsed.content_supported === 'uncertain'
    ) {
      return {
        content_supported: parsed.content_supported,
        verifier_note: parsed.verifier_note,
      };
    }
    return null;
  } catch {
    return null;
  }
}
