import type { Task } from 'graphile-worker';
import { and, eq, inArray } from 'drizzle-orm';
import type { ContentSupported, FindingPayload, RunTokenUsage } from '@deep-fryer/core';
import {
  dimensions,
  findings,
  getDb,
  researchRuns,
  researchSessions,
  tenants,
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
import { extractJson, runSession, runSessionWithRetry } from '../session.js';
import { tenantStorage } from '../storage.js';

/**
 * Apply (SPEC.md §8): phase-0 region-context session first, its brief
 * injected into every dimension session; findings gated by deterministic
 * checks plus an independent verifier session; failures surface as
 * red-flagged findings, never dropped. Failed runs stay failed — reruns are
 * user-directed from review, not automatic.
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

    // Dimension sessions, sequentially (per-session container isolation is
    // the deploy layer's concern; concurrency here is a config knob later).
    for (const spec of plan.sessions.filter((s) => s.kind === 'dimension')) {
      const dimension = spec.dimension_slug ? dimBySlug.get(spec.dimension_slug) : undefined;
      if (!dimension) {
        helpers.logger.error(`dimension ${spec.dimension_slug} not found; skipping session`);
        continue;
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
          verdict = await runVerifier(payload, config.region.name, verifierUsage);
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
    }

    await finish('complete');
    helpers.logger.info(`run ${runId} complete`);
  } catch (err) {
    helpers.logger.error(`run ${runId} failed: ${err instanceof Error ? err.message : err}`);
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
};

async function runVerifier(
  payload: Extract<FindingPayload, { kind: 'indicator' }>,
  regionName: string,
  acc: { input_tokens: number; output_tokens: number },
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
