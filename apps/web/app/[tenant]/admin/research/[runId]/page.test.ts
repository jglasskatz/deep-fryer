import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ResearchPlan } from '@deep-fryer/core';

/**
 * A run's page names the strategy and version its plan was rendered from,
 * with the models and turn limits that plan recorded; a plan made before
 * strategies had versions says the strategy was not recorded. The run and
 * the signed-in editor are stubbed; the page itself renders.
 */
vi.stubGlobal('React', React);

const state = vi.hoisted(() => ({ plan: null as unknown as ResearchPlan }));

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/admin/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/components/admin/ActionButton', () => ({ ActionButton: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/lib/research-actions', () => ({ applyResearchAction: { bind: () => async () => {} } }));
vi.mock('@/lib/admin-guard', () => ({
  requireAdminPage: vi.fn(async () => ({ tenant: { id: 't1', slug: 'santa-cruz', name: 'Santa Cruz' } })),
}));
vi.mock('@/lib/env', () => ({ supportEmail: () => null }));
vi.mock('@/lib/review-data', () => ({
  runDimensionLabels: vi.fn(async () => ({ slugById: new Map([['d1', 'housing']]), nameBySlug: new Map([['housing', 'Housing']]) })),
  runFailureCauses: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/admin-data', () => ({
  runWithSessions: vi.fn(async () => ({
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
