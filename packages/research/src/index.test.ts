import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig, framework } from '@deep-fryer/contract';
import { MAX_INDICATORS_PER_SESSION, renderPlan, renderVerifierPrompt, researchModels, REGION_BRIEF_PLACEHOLDER } from './plan.js';
import { deterministicChecks, isFlagged, mergeVerification } from './verify.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const housing = framework.dimensions.find((d) => d.slug === 'housing')!;

describe('renderPlan', () => {
  const plan = renderPlan({
    config,
    dimensions: [
      {
        dimensionId: 'x',
        slug: housing.slug,
        ring: housing.ring,
        name: housing.name,
        indicators: housing.indicators,
        reviewerNotes: 'County PIT count was updated in January — use the new one.',
      },
    ],
  });

  it('renders phase-0 region context plus one session per dimension', () => {
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions[0]?.kind).toBe('region_context');
    expect(plan.sessions[1]?.kind).toBe('dimension');
    expect(plan.sessions[1]?.dimension_slug).toBe('housing');
  });

  it('injects config into prompts and keeps the region-brief placeholder', () => {
    const prompt = plan.sessions[1]!.prompt;
    expect(prompt).toContain('Tier 1 — Official local government');
    expect(prompt).toContain('last 5 years');
    expect(prompt).toContain('housing.cost-burdened-renters');
    expect(prompt).toContain(REGION_BRIEF_PLACEHOLDER);
    expect(prompt).toContain('County PIT count was updated in January');
  });

  it('applies threshold overrides to the thresholds block', () => {
    const overridden = renderPlan({
      config: {
        ...config,
        threshold_overrides: {
          'housing.cost-burdened-renters': { target: 25, rationale: 'adopted housing element goal' },
        },
      },
      dimensions: [
        {
          dimensionId: 'x',
          slug: housing.slug,
          ring: housing.ring,
          name: housing.name,
          indicators: housing.indicators,
        },
      ],
    });
    expect(overridden.sessions[1]!.prompt).toContain('target 25');
    expect(overridden.sessions[1]!.prompt).toContain('adopted housing element goal');
    expect(overridden.config_hash).not.toBe(plan.config_hash);
  });

  it('splits dense dimensions without losing or duplicating an indicator', () => {
    const indicators = Array.from({ length: 8 }, (_, i) => ({
      slug: `custom-indicator-${i}`, name: `Custom indicator ${i}`, unit: '%', threshold_ref: '',
    }));
    const split = renderPlan({ config, dimensions: [{ dimensionId: 'd', slug: 'custom', ring: 'social', name: 'Custom', indicators }] });
    expect(split.sessions).toHaveLength(4); // region + 3 + 3 + 2 indicators
    for (const [index, session] of split.sessions.slice(1).entries()) {
      expect(session.dimension_slug).toBe('custom');
      expect(session.prompt).toContain(`part ${index + 1} of 3`);
      const assigned = indicators.filter((indicator) => session.prompt.includes(`slug: ${indicator.slug},`));
      expect(assigned.map((indicator) => indicator.slug)).toEqual(
        indicators.slice(index * MAX_INDICATORS_PER_SESSION, (index + 1) * MAX_INDICATORS_PER_SESSION).map((i) => i.slug),
      );
    }
  });

  it('still plans a custom dimension whose indicators will be discovered by research', () => {
    expect(renderPlan({ config, dimensions: [{ dimensionId: 'd', slug: 'custom', ring: 'social', name: 'Custom', indicators: [] }] }).sessions).toHaveLength(2);
  });

  it('freezes the researcher/scout/verifier models in the inspectable plan', () => {
    const standard = renderPlan({ config, dimensions: [], strategy: 'standard', modelDefaults: { session_model: 'ignored-default', subagent_model: 'ignored-scout' } });
    expect(standard.strategy).toBe('standard');
    expect(standard.models).toEqual({ session_model: 'claude-sonnet-5', subagent_model: null, verifier_model: 'claude-opus-5' });
    expect(researchModels('deep')).toEqual({ session_model: 'claude-opus-5', subagent_model: 'claude-sonnet-5', verifier_model: 'claude-opus-5' });
    expect(researchModels(undefined, { session_model: 'operator-researcher', verifier_model: 'operator-verifier', subagent_model: 'operator-scout' })).toEqual({ session_model: 'operator-researcher', verifier_model: 'operator-verifier', subagent_model: 'operator-scout' });
  });

  it('tells the independent verifier to read the archive first and discloses missing exhibits', () => {
    const input = { indicator_name: 'Rent burden', claimed_value: '42', unit: '%', year: '2025', geography: 'City', source_name: 'ACS', source_url: 'https://example.gov/report' };
    const prompt = renderVerifierPrompt({ ...input, archived_exhibits: ['archived-source.pdf', 'archived-snapshot.png'] });
    expect(prompt).toContain('Read the archived exhibits yourself');
    expect(prompt).toContain('- archived-source.pdf');
    expect(prompt).toContain('A live-site access block does not invalidate a readable archive');
    expect(renderVerifierPrompt(input)).toContain('No archived exhibit could be loaded');
  });
});

describe('deterministicChecks', () => {
  const goodFinding = {
    kind: 'indicator',
    indicator_slug: 'cost-burdened-renters',
    name: 'Renter households paying over 30% of income on housing',
    value: 58.4,
    unit: '% of renter households',
    year: new Date().getFullYear() - 1,
    target: 30,
    level_pct: 94.7,
    scoring: {
      threshold_ref: 'housing.cost-burdened-renters',
      function: 'lower_is_better',
      inputs: { value: 58.4, target: 30, scale: 30 },
      worked_math: 'level_pct = (58.4 − 30) ⁄ 30 × 100 = +94.7',
    },
    source: 'ACS',
    source_url: 'https://data.census.gov/table/x',
    source_tier: 2,
    evidence: { snapshot_path: 'evidence/x.png', captured_at: new Date().toISOString() },
    confidence: 'high',
    geographic_scale: 'city',
  };

  it('passes a compliant finding', async () => {
    const { payload, checks } = await deterministicChecks(goodFinding, config, 'housing', async () => true);
    expect(payload?.kind).toBe('indicator');
    expect(checks).toEqual({ schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true });
  });

  it('flags stale years and disallowed scales', async () => {
    const { checks } = await deterministicChecks(
      { ...goodFinding, year: 2005, geographic_scale: 'national' },
      config,
      'housing',
      async () => true,
    );
    expect(checks.recency_ok).toBe(false);
    expect(checks.scale_ok).toBe(false);
  });

  it('flags future observations and accepts the exact oldest permitted year', async () => {
    const year = new Date().getUTCFullYear();
    expect((await deterministicChecks({ ...goodFinding, year: year + 1 }, config, 'housing', async () => true)).checks.recency_ok).toBe(false);
    expect((await deterministicChecks({ ...goodFinding, year }, config, 'housing', async () => true)).checks.recency_ok).toBe(true);
    expect((await deterministicChecks({ ...goodFinding, year: year - 5 }, config, 'housing', async () => true)).checks.recency_ok).toBe(true);
    expect((await deterministicChecks({ ...goodFinding, year: year - 6 }, config, 'housing', async () => true)).checks.recency_ok).toBe(false);
  });

  it('validates sourced narrative drafts and never treats an uncertain narrative as an unflagged finding', async () => {
    const narrative = { context: 'Supported context.', actions: [{ text: 'Attend the hearing', source_url: 'https://city.example/hearing', evidence: { snapshot_path: 'evidence/action.png', captured_at: '2026-10-23T12:00:00Z' } }] };
    const parsed = await deterministicChecks({ ...goodFinding, narrative_draft: narrative }, config, 'housing', async () => true);
    expect(parsed.payload).toMatchObject({ narrative_draft: narrative });
    expect(isFlagged(mergeVerification(parsed.checks, { content_supported: 'pass', narrative_supported: 'uncertain' }))).toBe(true);
    expect(isFlagged(mergeVerification(parsed.checks, { content_supported: 'pass', narrative_supported: 'pass' }))).toBe(false);
    const bad = { ...narrative, actions: [{ ...narrative.actions[0]!, source_url: 'javascript:alert(1)' }] };
    expect((await deterministicChecks({ ...goodFinding, narrative_draft: bad }, config, 'housing', async () => true)).payload).toBeNull();
  });

  it('rejects malformed payloads at the schema gate', async () => {
    const { payload, checks } = await deterministicChecks({ kind: 'indicator' }, config, 'housing');
    expect(payload).toBeNull();
    expect(checks.schema_ok).toBe(false);
  });

  it('gap findings pass vacuously and still get flagged for review', async () => {
    const gap = {
      kind: 'gap',
      indicator_slug: 'aragonite-saturation',
      reason: 'no city-scale monitoring exists; MBARI series is regional',
      scales_tried: ['city', 'county'],
      searched_at: new Date().toISOString(),
    };
    const { payload, checks } = await deterministicChecks(gap, config, 'ocean-acidification');
    expect(payload?.kind).toBe('gap');
    const verification = mergeVerification(checks, { content_supported: 'uncertain', verifier_note: 'gap' });
    expect(isFlagged(verification)).toBe(true);
  });
});

describe('plugin loader', () => {
  it('fills known placeholders and preserves unknown ones', async () => {
    const { fillTemplate, pluginVersion } = await import('./plugin.js');
    expect(fillTemplate('a {{x}} and {{region_brief}}', { x: 'B' })).toBe('a B and {{region_brief}}');
    expect(pluginVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('tenant storage (local backend)', () => {
  it('writes under the fallback dir and returns the storage path', async () => {
    const { tenantStorage } = await import('./storage.js');
    const { mkdtempSync, readFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'df-storage-'));
    const storage = await tenantStorage('t1', { localFallbackDir: dir });
    const p = await storage.put('evidence/a.png', Buffer.from('png'), 'image/png');
    expect(p).toBe('evidence/a.png');
    expect(readFileSync(join(dir, 'evidence/a.png'), 'utf8')).toBe('png');
    expect(storage.describe()).toContain(dir);
  });
});
