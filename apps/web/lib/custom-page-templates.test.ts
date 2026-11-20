import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatIndicatorValue, type DimensionData, type Indicator } from '@deep-fryer/core';
import { MarkdownContent } from '@/components/content/MarkdownContent';
import { TEMPLATE_CHOICES } from '@/components/admin/CustomPagesEditor';
import { UserError } from './action-result';
import type { PublishedDimension, PublishedPortrait } from './portrait';

vi.stubGlobal('React', React);

let portrait: PublishedPortrait | null = null;
let allowed = true;
const requireRole = vi.fn(async (slug: string) => {
  if (!allowed) throw new UserError('You need editor access to this portrait.');
  return { tenant: { id: 't1', slug, name: 'City of Ithaca' } };
});
vi.mock('./features', () => ({ requireTenantRoleWithFeature: (...args: [string]) => requireRole(...args) }));
vi.mock('./data', () => ({ getPortrait: vi.fn(async () => portrait) }));
// The editor's own module is loaded for its list of choices; its server calls are stubbed.
vi.mock('@/lib/custom-page-actions', () => ({ saveCustomPage: vi.fn(), publishCustomPage: vi.fn(), unpublishCustomPage: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

const { customPageTemplates } = await import('./custom-page-templates');

const indicator = (over: Partial<Indicator>): Indicator => ({
  name: 'Median energy burden of low-income households',
  value: 8.25,
  unit: '% of household income',
  year: 2023,
  target: 6,
  source: 'DOE LEAD Tool',
  source_url: 'https://www.energy.gov/scep/lead-tool',
  confidence: 'medium',
  geographic_scale: 'county',
  ...over,
});

function dimension(slug: string, data: Partial<DimensionData>, over: Partial<PublishedDimension> = {}): PublishedDimension {
  return {
    slug,
    ring: 'social',
    canonical_slug: slug,
    display_order: 5,
    viz_level: 40,
    published_at: '2026-10-01T12:00:00.000Z',
    version_num: 3,
    data: { name: slug, icon: '', description: '', context: '', indicators: [], actions: [], ...data },
    ...over,
  };
}

const withEnergy = (energy: PublishedDimension): PublishedPortrait => ({
  tenant: { slug: 'ithaca', name: 'City of Ithaca', region: null, population: null, description: null, branding: null },
  dimensions: [
    dimension('housing', { indicators: [indicator({ name: 'Rent-burdened households', value: 46, unit: '%', source: 'ACS' })] }),
    energy,
  ],
});

async function energyTemplate() {
  const result = await customPageTemplates({ tenantSlug: 'ithaca' });
  if (!result.ok) throw new Error(result.error);
  const template = result.data.find((t) => t.id === 'energy-deep-dive');
  if (!template) throw new Error('no energy template');
  return template;
}

describe('custom page templates', () => {
  beforeEach(() => {
    allowed = true;
    portrait = null;
    requireRole.mockClear();
  });

  it('writes each published Energy figure exactly as the public page formats it, with year, scale, target and source', async () => {
    const renewable = indicator({ name: 'Renewable share of electricity', value: 51, unit: '%', year: 2025, target: 100, source: 'CA Energy Commission', source_url: 'https://www.energy.ca.gov/', geographic_scale: 'state' });
    const burden = indicator({});
    portrait = withEnergy(dimension('energy', {
      context: 'Energy costs weigh most on renters.',
      indicators: [burden, renewable],
      actions: ['Sign up for the bill discount'],
      action_sources: [{ text: 'Sign up for the bill discount', source_url: 'https://example.gov/care', evidence: { snapshot_path: 's.png', captured_at: '2026-01-01' } }],
    }));
    const t = await energyTemplate();
    expect(requireRole).toHaveBeenCalledWith('ithaca', 'editor', 'custom_pages');
    expect(t).toMatchObject({ title: 'Energy deep-dive', slug: 'energy-deep-dive' });
    expect(t.body).toContain(`- Median energy burden of low-income households: ${formatIndicatorValue(8.25, '% of household income')} (2023, county data). Target: ${formatIndicatorValue(6, '% of household income')}. Source: [DOE LEAD Tool](https://www.energy.gov/scep/lead-tool)`);
    expect(t.body).toContain(`- Renewable share of electricity: ${formatIndicatorValue(51, '%')} (2025, state data). Target: 100%. Source: [CA Energy Commission](https://www.energy.ca.gov/)`);
    expect(t.body).toContain('Energy costs weigh most on renters.');
    expect(t.body).toContain('These are the Energy figures published for City of Ithaca on October 1, 2026.');
    // Advice for staff stays in the editor's note, out of the page residents read.
    expect(t.body).not.toMatch(/check|before you publish/i);
    expect(t.note).toContain('Check the figures against the doughnut');
    expect(t.body).toContain('- Sign up for the bill discount ([source](https://example.gov/care))');
    // Another dimension's figures never leak in.
    expect(t.body).not.toContain('Rent-burdened');
    expect(t.note).toContain('published on October 1, 2026');

    // Rendered as a custom page renders it: every figure and source link is there.
    const html = renderToStaticMarkup(createElement(MarkdownContent, { body: t.body }));
    expect(html).toContain('8.25% of household income');
    expect(html).toContain('href="https://www.energy.gov/scep/lead-tool"');
    expect(html).toContain('<h3 class="pt-3 text-xl font-semibold">The figures</h3>');
  });

  it('writes "no data yet" and the gap’s reason for an Energy figure with no value, and for a gap of its own', async () => {
    portrait = withEnergy(dimension('energy', {
      indicators: [indicator({ value: null, year: null, source: '', source_url: '' })],
      gaps: [
        { indicator: 'Median energy burden of low-income households', reason: 'No city-level estimate is published', scales_tried: ['city', 'county'], searched_at: '2026-09-01' },
        { indicator: 'Households with a heat pump', reason: 'The utility does not release this.', scales_tried: ['city'], searched_at: '2026-09-01' },
      ],
    }));
    const t = await energyTemplate();
    expect(t.body).toContain('- Median energy burden of low-income households: no data yet. No city-level estimate is published.');
    expect(t.body).toContain('- Households with a heat pump: no data yet. The utility does not release this.');
    // The gap matched to its indicator is written once.
    expect(t.body.match(/No city-level estimate/g)).toHaveLength(1);
  });

  it('writes a gap named by a figure that has a value on that figure’s line, never as "no data yet"', async () => {
    portrait = withEnergy(dimension('energy', {
      indicators: [indicator({ name: 'Has value and gap', value: 3, unit: '%', year: 2024, target: null, geographic_scale: 'city' })],
      gaps: [{ indicator: 'Has value and gap', reason: 'Older year missing', scales_tried: ['city'], searched_at: '2026-09-01' }],
    }));
    const t = await energyTemplate();
    expect(t.body).toContain(`- Has value and gap: ${formatIndicatorValue(3, '%')} (2024, city data). Data gap: Older year missing. Source: [DOE LEAD Tool](https://www.energy.gov/scep/lead-tool)`);
    expect(t.body).not.toContain('Has value and gap: no data yet');
    expect(t.body.match(/Older year missing/g)).toHaveLength(1);
  });

  it('leaves the date out when the publication time is missing or not a time', async () => {
    portrait = withEnergy(dimension('energy', { indicators: [indicator({})] }, { published_at: 'not a date' }));
    const t = await energyTemplate();
    expect(t.body).toContain('These are the Energy figures published for City of Ithaca.');
    expect(t.note).toContain('Filled in from the Energy figures published. Check');
  });

  it('says "no data yet" when the portrait has published no Energy dimension', async () => {
    portrait = withEnergy(dimension('housing-2', {}));
    portrait.dimensions = portrait.dimensions.filter((d) => d.slug !== 'housing-2');
    const t = await energyTemplate();
    expect(t.body).toContain('- Energy: no data yet. No Energy figures have been published for City of Ithaca.');
    expect(t.body).toContain('City of Ithaca has no published Energy figures yet');
    expect(t.note).toContain('No Energy figures are published yet');

    portrait = null;
    expect((await energyTemplate()).body).toContain('- Energy: no data yet.');
  });

  it('finds a renamed Energy dimension by its framework dimension', async () => {
    portrait = withEnergy(dimension('power-and-heat', { indicators: [indicator({})] }, { canonical_slug: 'energy' }));
    expect((await energyTemplate()).body).toContain(formatIndicatorValue(8.25, '% of household income'));
  });

  it('keeps portrait text from breaking the page: one line per figure, no links but http(s)', async () => {
    portrait = withEnergy(dimension('energy', {
      context: '# Not a heading\nsecond line',
      indicators: [indicator({ name: 'Share\n## injected [x](https://evil.example)', source: 'Utility [report]', source_url: 'javascript:alert(1)' })],
    }));
    const t = await energyTemplate();
    const line = t.body.split('\n').find((l) => l.startsWith('- Share'));
    expect(line).toBe(`- Share ## injected (x)(https://evil.example): ${formatIndicatorValue(8.25, '% of household income')} (2023, county data). Target: ${formatIndicatorValue(6, '% of household income')}. Source: Utility (report)`);
    expect(t.body).not.toContain('javascript:');
    expect(t.body.startsWith('Not a heading second line')).toBe(true);
    const html = renderToStaticMarkup(createElement(MarkdownContent, { body: t.body }));
    expect(html).not.toContain('evil.example"');
  });

  it('offers every template the editor lists, under the same name', async () => {
    portrait = withEnergy(dimension('energy', {}));
    const result = await customPageTemplates({ tenantSlug: 'ithaca' });
    if (!result.ok) throw new Error(result.error);
    for (const choice of TEMPLATE_CHOICES) {
      expect(result.data.find((t) => t.id === choice.id)?.name).toBe(choice.name);
    }
  });

  it('is refused, with nothing read, to someone who may not edit pages', async () => {
    allowed = false;
    const { getPortrait } = await import('./data');
    vi.mocked(getPortrait).mockClear();
    expect(await customPageTemplates({ tenantSlug: 'ithaca' })).toEqual({ ok: false, error: 'You need editor access to this portrait.' });
    expect(getPortrait).not.toHaveBeenCalled();
  });
});
