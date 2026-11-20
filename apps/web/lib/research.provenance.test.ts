import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MODEL_PRICES } from '@deep-fryer/core';
import { onOneConnection } from '../test/one-connection';

/**
 * Where a run executed is recorded when it is applied, beside who pays for
 * it, and is shown only to the people who review it: after approval, the
 * published data, the open-data JSON and the public dimension page name no
 * model and no provider.
 */

vi.stubGlobal('React', React);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@deep-fryer/research', async (orig) => ({
  ...(await orig<typeof import('@deep-fryer/research')>()),
  enqueueResearchApply: vi.fn(async () => {}),
}));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../test/database-session')).databaseSession(signedIn)),
}));
// The public page's request-scoped pieces: the header, and the reader's language.
vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/lib/i18n/server', async () => {
  const { localeInfo } = await import('@/lib/i18n/locales');
  const { en } = await import('@/lib/i18n/messages/en');
  const { localizeHref } = await import('@/lib/i18n/routing');
  return { getI18n: vi.fn(async () => ({ locale: 'en', info: localeInfo('en'), m: en, href: (path: string) => localizeHref('en', path) })) };
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe('what a run records about where it executes', () => {
  it('names the provider, the first-party host on an organization key, the shared worker, and an unknown host or region as unknown', async () => {
    const { runExecution } = await import('./research');
    expect(runExecution('organization_key', { ANTHROPIC_BASE_URL: 'https://gateway.example.net/v1' })).toEqual({
      provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null,
    });
    // The worker, not this process, reaches the model on the plan: with no host named here, none is recorded.
    expect(runExecution('plan', {})).toMatchObject({ endpoint_host: null });
    expect(runExecution('plan', { ANTHROPIC_BASE_URL: 'https://gateway.example.net/v1', DF_HOST_REGION: ' nyc3 ' }))
      .toMatchObject({ endpoint_host: 'gateway.example.net', host_region: 'nyc3' });
    expect(runExecution('plan', { ANTHROPIC_BASE_URL: 'not a url' })).toMatchObject({ endpoint_host: null });
  });
});

describe.skipIf(!hasDb)('provenance on runs, and never on public pages (Postgres)', () => {
  const saved = {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DF_RESEARCH_KEY_CONFIGURED: process.env.DF_RESEARCH_KEY_CONFIGURED,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    DF_HOST_REGION: process.env.DF_HOST_REGION,
  };
  const cleanup: (() => Promise<unknown>)[] = [];
  beforeAll(() => {
    process.env.AUTH_SECRET = 'test-secret';
    process.env.DF_RESEARCH_KEY_CONFIGURED = 'true';
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.DF_HOST_REGION;
  });
  afterAll(async () => {
    signedIn = null;
    for (const fn of cleanup.reverse()) await fn();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function portrait() {
    const m = await import('@deep-fryer/db');
    const { eq, sql } = await import('drizzle-orm');
    const { givePlan } = await import('./test-plans');
    const db = m.getDb();
    const org = await m.provisionOrganization(db, { slug: uniq(), name: 'Provenance Town' });
    const provisioned = await m.provisionTenant(db, { slug: uniq(), name: 'Provenance Town', organizationId: org.id });
    await givePlan(org.id, { researchSessions: 50 });
    const [editor] = await db.insert(m.users).values({ email: `${uniq()}@editor.example.gov` }).returning();
    await db.insert(m.tenantMembers).values({ tenantId: provisioned.tenant.id, userId: editor!.id, role: 'editor' });
    cleanup.push(async () => {
      const sessions = await db.select({ id: m.researchSessions.id }).from(m.researchSessions)
        .innerJoin(m.researchRuns, eq(m.researchRuns.id, m.researchSessions.runId))
        .where(eq(m.researchRuns.tenantId, provisioned.tenant.id));
      // Findings are immutable (migration 0001's trigger): lifted for this one delete, in its own transaction.
      await db.transaction(async (tx) => {
        await tx.execute(sql`alter table findings disable trigger findings_immutable`);
        for (const s of sessions) await tx.delete(m.findings).where(eq(m.findings.sessionId, s.id));
        await tx.execute(sql`alter table findings enable trigger findings_immutable`);
      });
      for (const s of sessions) await db.delete(m.researchSessions).where(eq(m.researchSessions.id, s.id));
      await db.delete(m.dimensions).where(eq(m.dimensions.tenantId, provisioned.tenant.id));
      await db.delete(m.tenants).where(eq(m.tenants.id, provisioned.tenant.id));
      await db.delete(m.organizations).where(eq(m.organizations.id, org.id));
      await db.delete(m.users).where(eq(m.users.id, editor!.id));
    });
    return { ...provisioned, org, editor: editor! };
  }

  it('records the execution in the same update as funding when a run is applied', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const { applyRun } = await import('./research');
    const { tenant } = await portrait();
    const plan = { sessions: [{ kind: 'region_context' as const, prompt: 'p', tool_allowlist: [], output_schema_ref: 'region' }], config_hash: 'h', plugin_version: 'v' };
    const [run] = await m.getDb().insert(m.researchRuns).values({ tenantId: tenant.id, plan: plan as never, configSnapshot: {} as never }).returning();
    expect(run!.execution).toBeNull();
    await applyRun(tenant.id, run!.id);
    const [row] = await m.getDb().select().from(m.researchRuns).where(eq(m.researchRuns.id, run!.id));
    expect(row).toMatchObject({
      funding: 'plan',
      execution: { provider: 'anthropic', endpoint_host: null, executor: 'shared_worker', host_region: null },
    });
  });

  it('keeps the execution out of the app role’s reach', async () => {
    const m = await import('@deep-fryer/db');
    const { tenant, editor } = await portrait();
    const asEditor = <T>(fn: (tx: import('@deep-fryer/db').DbExecutor) => Promise<T>) => m.withAuthContext(m.getDb(), editor.id, fn);
    const values = { tenantId: tenant.id, plan: { sessions: [], config_hash: 'h', plugin_version: 'v' }, configSnapshot: {} as never };
    // A planned run inserted as the person is fine; one carrying its own execution record is not.
    await asEditor((tx) => tx.insert(m.researchRuns).values(values));
    const insert = asEditor((tx) => tx.insert(m.researchRuns).values({
      ...values, execution: { provider: 'anthropic', endpoint_host: 'elsewhere.example', executor: 'shared_worker', host_region: null },
    }));
    await expect(insert.catch((err: unknown) => { throw (err as { cause?: unknown }).cause ?? err; }))
      .rejects.toThrow(/row-level security/);
  });

  it('after approval, the published data, the open-data JSON and the public dimension page name no model and no provider', async () => {
    const m = await import('@deep-fryer/db');
    const { eq } = await import('drizzle-orm');
    const db = m.getDb();
    const { tenant, dimensions, editor } = await portrait();
    const dimension = dimensions[0]!;
    const models = Object.keys(MODEL_PRICES);
    const execution = { provider: 'anthropic' as const, endpoint_host: 'api.anthropic.com', executor: 'shared_worker' as const, host_region: null };

    // A finished run as the worker leaves it: one session whose research a fallback model partly answered.
    const [run] = await db.insert(m.researchRuns).values({
      tenantId: tenant.id, status: 'complete', plan: { sessions: [], config_hash: 'h', plugin_version: 'v' }, configSnapshot: {} as never,
      appliedAt: new Date(), completedAt: new Date(), execution,
    }).returning();
    const [session] = await db.insert(m.researchSessions)
      .values({ runId: run!.id, kind: 'dimension', dimensionId: dimension.dimensionId, status: 'complete' }).returning();
    await db.update(m.researchRuns).set({
      tokenUsage: {
        [session!.id]: { input_tokens: 100, output_tokens: 20, model: 'claude-sonnet-5', refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: 'cyber' }] },
        [`verifier:${session!.id}`]: { input_tokens: 10, output_tokens: 2, model: 'claude-opus-5' },
      },
    }).where(eq(m.researchRuns.id, run!.id));
    await db.insert(m.findings).values({
      sessionId: session!.id, dimensionId: dimension.dimensionId, indicatorSlug: 'rent-burden',
      payload: {
        kind: 'indicator', indicator_slug: 'rent-burden', name: 'Rent burden', value: 42, unit: '% of households', year: 2024, target: 30,
        source: 'City housing report', source_url: 'https://example.gov/housing', source_tier: 1, confidence: 'high', geographic_scale: 'city',
        evidence: { snapshot_path: 'evidence/housing.png', captured_at: '2026-10-23T00:00:00Z' },
        scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '42 against 30' }, level_pct: 40,
      },
      verification: { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' },
    });

    // Review names them…
    const { findingProvenance, provenanceSentence } = await import('@/app/[tenant]/admin/research/provenance');
    const [stored] = await db.select().from(m.researchRuns).where(eq(m.researchRuns.id, run!.id));
    expect(provenanceSentence(findingProvenance(stored!, session!.id)))
      .toBe('Researched with claude-sonnet-5 on Anthropic, shared server. When claude-sonnet-5 declined part of the work, claude-opus-5 answered.');

    // …and approving and publishing carries none of it into what the public reads.
    signedIn = editor.id;
    const res = await onOneConnection(async () =>
      (await import('./review-actions')).approveFindings({ tenantSlug: tenant.slug, runId: run!.id, dimensionId: dimension.dimensionId, publish: true }),
    );
    expect(res).toMatchObject({ ok: true });
    signedIn = null;
    const { versionId } = (res as { ok: true; data: { versionId: string } }).data;
    const [version] = await db.select().from(m.dimensionVersions).where(eq(m.dimensionVersions.id, versionId));
    expect(version!.data.indicators.map((i) => i.name)).toContain('Rent burden');

    const { GET } = await import('@/app/api/v1/portraits/[tenant]/route');
    const response = await GET(new Request(`https://example.org/api/v1/portraits/${tenant.slug}`), { params: Promise.resolve({ tenant: tenant.slug }) });
    expect(response.status).toBe(200);
    const json = await response.text();
    expect(json).toContain('Rent burden');

    const { default: DimensionPage } = await import('@/app/[tenant]/dim/[slug]/page');
    const html = renderToStaticMarkup(await DimensionPage({
      params: Promise.resolve({ tenant: tenant.slug, slug: dimension.slug }),
      searchParams: Promise.resolve({}),
    }));
    expect(html).toContain('Rent burden');

    for (const [where, text] of [['published version', JSON.stringify(version!.data)], ['open-data JSON', json], ['dimension page', html]] as const) {
      for (const model of models) expect(text, `${where} names ${model}`).not.toContain(model);
      expect(text, `${where} names a provider`).not.toMatch(/anthropic|openai|openrouter|ollama|claude/i);
      expect(text, `${where} says where research ran`).not.toMatch(/Researched with|shared server|provider not recorded/);
    }
  });
});
