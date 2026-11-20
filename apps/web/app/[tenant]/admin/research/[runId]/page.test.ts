import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ResearchPlan } from '@deep-fryer/core';

/**
 * A run's page names the strategy and version its plan was rendered from,
 * with the models and turn limits that plan recorded; a plan made before
 * strategies had versions says the strategy was not recorded. The run and
 * the signed-in editor are stubbed; the page itself renders.
 *
 * The run page's cost section, read from the run's own rows: dollars for
 * region context, research, verification and audit, a row per dimension,
 * and a cost per verified finding. A dimension where nothing passed says so.
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
