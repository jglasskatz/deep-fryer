import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ResearchPlan } from '@deep-fryer/core';
import type { RunExecution } from '@deep-fryer/db';

/**
 * A run's page names the strategy and version its plan was rendered from,
 * with the models and turn limits that plan recorded; a plan made before
 * strategies had versions says the strategy was not recorded. The run and
 * the signed-in editor are stubbed; the page itself renders.
 *
 * The run page's cost section, read from the run's own rows: dollars for
 * region context, research, verification and audit, a row per dimension,
 * and a cost per verified finding. A dimension where nothing passed says so.
 *
 * The run page names where its research ran and which model answered each
 * session, from what the run recorded: its execution (written when it was
 * applied) and each session's usage (written when it ended).
 */
vi.stubGlobal('React', React);

const state = vi.hoisted(() => ({ plan: null as unknown as ResearchPlan, data: null as unknown }));

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/admin/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/components/admin/ActionButton', () => ({ ActionButton: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/research-actions', () => ({ applyResearchAction: { bind: () => async () => {} } }));
vi.mock('@/lib/admin-guard', () => ({
  requireAdminPage: vi.fn(async () => ({ tenant: { id: 't1', slug: 'santa-cruz', name: 'Santa Cruz' } })),
}));
vi.mock('@/lib/env', () => ({ supportEmail: () => null }));
vi.mock('@/lib/page-meta', () => ({ adminPageMetadata: vi.fn() }));
vi.mock('@/lib/review-data', () => ({
  runDimensionLabels: vi.fn(async () => ({
    slugById: new Map([['d1', 'housing'], ['dim-a', 'food'], ['dim-b', 'housing']]),
    nameBySlug: new Map([['food', 'Food'], ['housing', 'Housing']]),
  })),
  runFailureCauses: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/admin-data', () => ({
  runWithSessions: vi.fn(async () => state.data ?? ({
    run: {
      id: 'run-0001-aaaa',
      tenantId: 't1',
      status: 'planned',
      plan: state.plan,
      appliedAt: null,
      completedAt: null,
      funding: 'plan',
      tokenUsage: null,
    },
    sessions: [],
    findings: [],
  })),
}));

const sessions: ResearchPlan['sessions'] = [
  { kind: 'region_context', prompt: 'region', tool_allowlist: ['WebSearch'], output_schema_ref: 'markdown:region-brief', config_hash: 'h' },
  { kind: 'dimension', dimension_slug: 'housing', prompt: 'housing', tool_allowlist: ['WebSearch'], output_schema_ref: 'contract:finding.schema.json', config_hash: 'h' },
];

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function runPage(): Promise<string> {
  const { default: RunDetailPage } = await import('./page');
  const element = await RunDetailPage({ params: Promise.resolve({ tenant: 'santa-cruz', runId: 'run-0001-aaaa' }) });
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, element));
}

/** The visible text, tags removed and whitespace collapsed. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

describe('the strategy a run page names', () => {
  beforeEach(() => {
    state.plan = { sessions, config_hash: 'h', plugin_version: '1.0.0' };
  });

  it('shows "standard v1" with its models and turn limits', async () => {
    const { renderPlan } = await import('@deep-fryer/research');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const planned = renderPlan({ config: defaultPortraitConfig('Santa Cruz', 'City limits'), dimensions: [], strategy: 'standard' });
    state.plan = { ...planned, sessions };
    const page = text(await runPage());
    expect(page).toContain('2 sessions · standard v1 · plugin');
    expect(page).toContain('Research strategy: standard v1');
    expect(page).toContain('Researcher claude-sonnet-5');
    expect(page).toContain('Scout No separate scout');
    expect(page).toContain('Independent verifier claude-opus-5');
    expect(page).toContain('Page reader claude-haiku-4-5-20251001');
    expect(page).toContain('Turn limit, each research session 60');
    expect(page).toContain('Turn limit, each verifier check 12');
    expect(page).toContain('Turn limit, each audit check 16');
    expect(page).not.toContain('not recorded');
  });

  it('shows "hybrid v1" with its escalation researcher model and turn limit', async () => {
    const { renderPlan } = await import('@deep-fryer/research');
    const { defaultPortraitConfig } = await import('@deep-fryer/contract');
    const planned = renderPlan({ config: defaultPortraitConfig('Santa Cruz', 'City limits'), dimensions: [], strategy: 'hybrid' });
    state.plan = { ...planned, sessions };
    const page = text(await runPage());
    expect(page).toContain('2 sessions · hybrid v1 · plugin');
    expect(page).toContain('Research strategy: hybrid v1');
    expect(page).toContain('Researcher claude-sonnet-5');
    expect(page).toContain('Escalation researcher claude-opus-5');
    expect(page).toContain('Scout claude-sonnet-5');
    expect(page).toContain('Turn limit, each escalation pass 40');
  });

  it('names the version of a plan made with no strategy chosen', async () => {
    state.plan = {
      sessions, config_hash: 'h', plugin_version: '1.0.0',
      strategy: 'operator-defaults', strategy_version: 1,
      models: { session_model: 'operator-researcher', subagent_model: null, verifier_model: 'claude-opus-5', page_reader_model: 'claude-haiku-4-5-20251001' },
      caps: { session_max_turns: 60, verifier_max_turns: 12, audit_max_turns: 16 },
    };
    const page = text(await runPage());
    expect(page).toContain('Research strategy: server defaults v1');
    expect(page).toContain('Researcher operator-researcher');
  });

  it('reads "strategy not recorded" for a historic plan, without guessing a version', async () => {
    const page = text(await runPage());
    expect(page).toContain('2 sessions · strategy not recorded · plugin');
    expect(page).toContain('Research strategy: strategy not recorded');
    expect(page).toContain('This older plan did not record model choices');
    expect(page).toContain('This older plan did not record turn limits');
    expect(page).not.toMatch(/(standard|deep|defaults) v\d/);
  });

  it('keeps the name a plan from before versions recorded, still without a version', async () => {
    state.plan = {
      sessions, config_hash: 'h', plugin_version: '1.0.0', strategy: 'deep',
      models: { session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5' },
    };
    const page = text(await runPage());
    expect(page).toContain('Research strategy: strategy not recorded');
    expect(page).toContain('It was planned as deep, before strategies had version numbers.');
    expect(page).toContain('Page reader Not recorded: the worker’s own setting');
    expect(page).not.toMatch(/deep v\d/);
  });
});

const runId = '11111111-1111-4111-8111-111111111111';
const at = new Date('2026-11-01T10:00:00Z');
const sonnet = { input_tokens: 1000, output_tokens: 100, by_model: { 'claude-sonnet-5': { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 5000, cache_write_tokens: 200, web_search_requests: 2 } } };
const session = (id: string, kind: string, dimensionId: string | null) => ({ id, runId, dimensionId, kind, status: 'complete', reviewerNotes: null, startedAt: at, completedAt: at });
const costData = {
  run: {
    id: runId, tenantId: 't1', status: 'complete', appliedAt: at, completedAt: at, createdAt: at, funding: 'plan',
    plan: {
      plugin_version: '1', config_hash: 'abc', strategy: 'standard', models: null,
      sessions: [
        { kind: 'region_context', prompt: 'p', tool_allowlist: [], output_schema_ref: 'brief' },
        { kind: 'dimension', dimension_slug: 'food', prompt: 'p', tool_allowlist: [], output_schema_ref: 'finding' },
        { kind: 'dimension', dimension_slug: 'housing', prompt: 'p', tool_allowlist: [], output_schema_ref: 'finding' },
      ],
    },
    tokenUsage: { r: sonnet, a: sonnet, 'verifier:a': sonnet, b: sonnet, 'audit:workflow:fb': sonnet },
  },
  sessions: [session('r', 'region_context', null), session('a', 'dimension', 'dim-a'), session('b', 'dimension', 'dim-b')],
  findings: [
    { id: 'fa', sessionId: 'a', dimensionId: 'dim-a', payload: { kind: 'indicator' }, verification: { content_supported: 'pass' } },
    { id: 'fb', sessionId: 'b', dimensionId: 'dim-b', payload: { kind: 'indicator' }, verification: { content_supported: 'fail' } },
  ],
};

describe('research run page costs', () => {
  beforeEach(() => {
    state.data = costData;
  });
  afterEach(() => {
    state.data = null;
  });

  it('shows dollars by stage, by dimension and per verified finding', async () => {
    const html = await runPage();
    const costs = html.slice(html.indexOf('Research cost estimate'));
    for (const label of ['Region context', 'Research', 'Independent verification', 'Machine audits', 'Cost per verified finding', 'Cost by dimension']) {
      expect(costs).toContain(label);
    }
    const row = (label: string) => costs.split('<tr').find((r) => r.includes(`>${label}</th>`)) ?? '';
    expect(row('Food')).toContain('$0.049');
    expect(row('Housing')).toMatch(/no verified findings/i);
    expect(row('Region context (shared by every dimension)')).toContain('$0.0245');
    // Five priced records, one verified finding.
    expect(costs).toContain('$0.1225');
    expect(costs).toContain('1 finding passed independent verification');
  });
});

const execution: RunExecution = { provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null };
const spec = (kind: 'region_context' | 'dimension', slug?: string) => ({
  kind, dimension_slug: slug, prompt: 'p', tool_allowlist: ['WebFetch'], output_schema_ref: 'finding',
});
const provenanceSession = (id: string, kind: 'region_context' | 'dimension', dimensionId: string | null) => ({
  id, runId: 'run-1', dimensionId, kind, status: 'complete', reviewerNotes: null,
  startedAt: new Date('2026-11-01T10:00:00Z'), completedAt: new Date('2026-11-01T10:05:00Z'),
});
const usage = (model: string, extra: object = {}) => ({ input_tokens: 10, output_tokens: 2, model, ...extra });

function finishedRun(over: { execution: RunExecution | null; tokenUsage: object | null }) {
  return {
    run: {
      id: '11111111-1111-4111-8111-111111111111', tenantId: 't1', status: 'complete', funding: 'plan',
      plan: { sessions: [spec('region_context'), spec('dimension', 'housing')], config_hash: 'h', plugin_version: '1' },
      createdAt: new Date('2026-11-01T09:59:00Z'), appliedAt: new Date('2026-11-01T10:00:00Z'), completedAt: new Date('2026-11-01T10:06:00Z'),
      ...over,
    },
    sessions: [provenanceSession('s-region', 'region_context', null), provenanceSession('s-housing', 'dimension', 'd1')],
    findings: [],
  };
}

describe('the run page says where its research ran', () => {
  afterEach(() => {
    state.data = null;
  });

  it('names the models, the provider and the shared server, and a model that answered after a refusal', async () => {
    state.data = finishedRun({
      execution,
      tokenUsage: {
        's-region': usage('claude-sonnet-5'),
        's-housing': usage('claude-sonnet-5', { refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: 'cyber' }] }),
        'verifier:s-housing': usage('claude-haiku-4-5'),
      },
    });
    const html = await runPage();
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server. When claude-sonnet-5 declined part of the work, claude-opus-5 answered.');
    // The verifier's own record is not research: its model is not named as a researcher.
    expect(html).not.toContain('Researched with claude-sonnet-5 and claude-haiku-4-5');
    // Each session row names the model that answered it, and the fallback where there was one.
    expect(html.match(/>claude-sonnet-5</g)).toHaveLength(2);
    expect(html.match(/When claude-sonnet-5 declined part of the work, claude-opus-5 answered\./g)).toHaveLength(2);
  });

  it('reads "provider not recorded" on an older run', async () => {
    state.data = finishedRun({ execution: null, tokenUsage: { 's-housing': usage('claude-sonnet-5') } });
    expect(await runPage()).toContain('Researched with claude-sonnet-5; provider not recorded');
  });

  it('says where a run goes before any session has reported', async () => {
    const queued = finishedRun({ execution, tokenUsage: null });
    state.data = { ...queued, run: { ...queued.run, status: 'planned', completedAt: null }, sessions: [] };
    expect(await runPage()).toContain('Runs on Anthropic, shared server');
  });

  it('surfaces the auditing phase once all planned sessions finish while run is still running (P0.4)', async () => {
    const running = finishedRun({ execution, tokenUsage: null });
    state.data = {
      ...running,
      run: { ...running.run, status: 'running', completedAt: null },
    };
    const page = text(await runPage());
    expect(page).toContain('auditing');
    expect(page).toContain('All 2 sessions finished — running automatic quality audits');
    expect(page).toContain('completing independent quality audits');
  });

  it('notes cached region brief reuse on targeted re-run plans (P1.3)', async () => {
    const base = finishedRun({ execution, tokenUsage: null });
    state.data = {
      ...base,
      run: {
        ...base.run,
        status: 'planned',
        appliedAt: null,
        completedAt: null,
        plan: {
          sessions: [spec('dimension', 'housing')],
          config_hash: 'h',
          plugin_version: '1',
          strategy: 'hybrid',
          strategy_version: 1,
          cached_region_brief: '# Cached Santa Cruz brief',
        },
      },
      sessions: [],
    };
    const page = text(await runPage());
    expect(page).toContain('reuses the portrait’s cached region brief instead of running a new phase-0 session');
  });
});
