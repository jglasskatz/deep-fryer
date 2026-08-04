import { and, eq, inArray, isNull } from 'drizzle-orm';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  dimensions,
  getDb,
  latestVersion,
  researchRuns,
} from '@deep-fryer/db';
import {
  enqueueResearchApply,
  renderPlan,
  type PlanDimensionSpec,
} from '@deep-fryer/research';
import { portraitConfigFromMap, tenantConfigMap } from './admin-data';

/**
 * Plan (SPEC.md §8): render the full session list — prompts, tool
 * allowlists, config hash — without spending tokens, and store it on the
 * run row for inspection before apply.
 */
export async function createPlannedRun(input: {
  tenantId: string;
  dimensionIds?: string[];
  reviewerNotes?: Record<string, string>;
  requestedBy?: string | null;
}) {
  const db = getDb();

  const configMap = await tenantConfigMap(input.tenantId);
  const config = portraitConfigFromMap(configMap);
  if (!config) {
    throw new Error(
      'portrait config is incomplete (region, source_priority, recency, scale_policy required) — fill it in Settings',
    );
  }

  const where = [eq(dimensions.tenantId, input.tenantId), isNull(dimensions.archivedAt)];
  if (input.dimensionIds?.length) {
    where.push(inArray(dimensions.id, input.dimensionIds));
  }
  const dims = await db
    .select()
    .from(dimensions)
    .where(and(...where))
    .orderBy(dimensions.displayOrder);
  if (dims.length === 0) throw new Error('no dimensions selected');

  const specs: PlanDimensionSpec[] = [];
  for (const dim of dims) {
    const frameworkDim = frameworkDimension(dim.slug, dim.canonicalSlug);
    let indicators = frameworkDim?.indicators ?? [];
    let name = frameworkDim?.name ?? dim.slug;

    if (!frameworkDim) {
      // Custom dimension: research whatever indicators its latest version names.
      const latest = await latestVersion(db, dim.id);
      name = latest?.data.name ?? dim.slug;
      indicators = (latest?.data.indicators ?? []).map((ind) => ({
        slug: ind.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: ind.name,
        unit: ind.unit,
        threshold_ref: ind.scoring?.threshold_ref ?? '',
      }));
    }

    specs.push({
      dimensionId: dim.id,
      slug: dim.slug,
      ring: dim.ring,
      name,
      indicators,
      reviewerNotes: input.reviewerNotes?.[dim.id],
    });
  }

  const plan = renderPlan({ config, dimensions: specs });

  const [run] = await db
    .insert(researchRuns)
    .values({
      tenantId: input.tenantId,
      status: 'planned',
      plan,
      configSnapshot: config,
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  if (!run) throw new Error('run insert failed');

  return { run, sessionCount: plan.sessions.length };
}

/** Apply: hand the planned run to the worker queue. */
export async function applyRun(tenantId: string, runId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.id, runId), eq(researchRuns.tenantId, tenantId)));
  if (!run) throw new Error('unknown run');
  if (run.status !== 'planned') throw new Error(`run is ${run.status}, not planned`);
  await enqueueResearchApply(runId);
  return run;
}
