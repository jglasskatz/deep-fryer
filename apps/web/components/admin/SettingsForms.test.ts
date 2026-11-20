import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import { tenantConfigSchemas, type TenantBranding } from '@deep-fryer/core';
import { BRAND_FONTS } from '@/components/site-header/branding';
import {
  SettingsForms,
  newOverrideDraft,
  overrideDrafts,
  scalePolicyDraft,
  scalePolicyValue,
  sourcePriorityValue,
  thresholdOverridesValue,
  tierDrafts,
  type ScalePolicy,
  type SourcePriority,
  type ThresholdOverrides,
} from './SettingsForms';

/**
 * The settings page's forms for source tiers, the geographic scale policy
 * and threshold overrides (which replaced three raw JSON boxes), and for the
 * portrait's logo, colour and font.
 *
 * There is no DOM here to type into, so a form is checked in two halves:
 * what it renders from a stored value, and what its Save turns its fields
 * back into (the draft helpers the form keeps its fields in). The database
 * tests then save through the real action and read the stored row back.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
let signedIn: string | null = null;
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => (await import('../../test/database-session')).databaseSession(signedIn)),
}));

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

type Props = Parameters<typeof SettingsForms>[0];

function render(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsForms, {
      tenantSlug: 'nyc',
      region: null,
      sourcePriority: null,
      recency: null,
      scalePolicy: null,
      thresholdOverrides: null,
      reviewPolicy: null,
      retention: null,
      notifications: null,
      progress: null,
      features: null,
      translationRequestDays: 30,
      ...props,
    }),
  );
}

/** One element's opening tag, found by an attribute value only it has. */
const tagWith = (html: string, attr: string) => html.match(new RegExp(`<[a-z]+[^>]*${attr}[^>]*>`))?.[0] ?? '';
/** The <section> under the given heading. */
const section = (html: string, title: string) => {
  const start = html.indexOf(`<h2 class="text-base font-semibold">${title}</h2>`);
  expect(start, title).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};

/*
 * Values the JSON boxes accepted: whatever the setting's schema accepts, as
 * the schema stores it. Odd but valid shapes are here on purpose: repeated
 * tier numbers, empty names, an empty example list, an example with a line
 * break, repeated scales, an empty exception list, a dimension and an
 * indicator outside the framework, every optional override field, -0, keys
 * named like an object's own properties ("constructor", "toString"), and
 * keys with spaces around them.
 * Not here: an empty or all-space dimension or indicator key, which no
 * dimension or indicator can have; the forms ask for one.
 */
const SOURCE_PRIORITIES: SourcePriority[] = [
  defaultPortraitConfig('Ithaca', 'City of Ithaca').source_priority,
  { tiers: [{ tier: 2, name: '', description: '', examples: [] }] },
  {
    tiers: [
      { tier: 1, name: 'City', description: 'Our own', examples: ['  spaced  ', 'line\nbreak', ''] },
      { tier: 1, name: 'Same number', description: '' },
      { tier: 1_000_000, name: 'Far', description: 'x' },
    ],
  },
];
const SCALE_POLICIES: ScalePolicy[] = [
  defaultPortraitConfig('Ithaca', 'City of Ithaca').scale_policy,
  { default_accepted: ['city'] },
  { default_accepted: ['global', 'city', 'city'], per_dimension: {} },
  { default_accepted: ['city', 'county'], per_dimension: { 'ocean-acidification': ['regional', 'global'], 'our-own-dimension': ['state'] } },
  { default_accepted: ['city'], per_dimension: { constructor: ['county' as const], toString: ['state' as const], hasOwnProperty: ['city' as const], ' padded ': ['global'] } },
];
const THRESHOLD_OVERRIDES: ThresholdOverrides[] = [
  {},
  { 'housing.cost-burdened-renters': { target: 25, rationale: 'City housing plan target.' } },
  {
    'our.own-indicator': { target: -0, rationale: ' ', scale: 0.5, function: 'band', low: -1.5, high: 1e21, target_year: 2040 },
    'climate-change.ghg-per-capita': { target: 0.1, rationale: 'Net zero by 2045.', function: 'lower_is_better', target_year: 2045 },
  },
  {
    constructor: { target: 1, rationale: 'a' },
    toString: { target: 2, rationale: 'b' },
    hasOwnProperty: { target: 3, rationale: 'c' },
    ' padded.key ': { target: 4, rationale: 'd' },
  },
];

describe('the settings forms give back every value the JSON boxes accepted', () => {
  it('source tiers', () => {
    for (const stored of SOURCE_PRIORITIES.map((v) => tenantConfigSchemas.source_priority.parse(v))) {
      expect(sourcePriorityValue(tierDrafts(stored))).toEqual({ ok: true, value: stored });
    }
  });

  it('the geographic scale policy', () => {
    for (const stored of SCALE_POLICIES.map((v) => tenantConfigSchemas.scale_policy.parse(v))) {
      expect(scalePolicyValue(scalePolicyDraft(stored))).toEqual({ ok: true, value: stored });
    }
  });

  it('threshold overrides', () => {
    for (const stored of THRESHOLD_OVERRIDES.map((v) => tenantConfigSchemas.threshold_overrides.parse(v))) {
      const back = thresholdOverridesValue(overrideDrafts(stored));
      expect(back).toEqual({ ok: true, value: stored });
      // -0 keeps its sign.
      if (back.ok && 'our.own-indicator' in stored) expect(Object.is(back.value['our.own-indicator']!.target, -0)).toBe(true);
    }
  });

  it('refuses an override without a reason, saying why', () => {
    const draft = { ...newOverrideDraft([]), target: '25', rationale: '' };
    expect(draft.ref).toBe('food.food-insecurity-rate');
    expect(thresholdOverridesValue([draft])).toEqual({
      ok: false,
      error: 'Food: Food insecurity rate needs a reason for its target. The reason is shown on your public methodology page.',
    });
    expect(thresholdOverridesValue([{ ...draft, rationale: 'Adopted plan.' }]).ok).toBe(true);
  });

  it('refuses what the settings cannot hold, in plain words', () => {
    expect(sourcePriorityValue([])).toEqual({ ok: false, error: 'Add at least one tier.' });
    expect(sourcePriorityValue([{ ...tierDrafts(SOURCE_PRIORITIES[1]!)[0]!, tier: '1.5' }])).toEqual({
      ok: false,
      error: 'Tier 1 needs a whole number of 1 or more.',
    });
    expect(scalePolicyValue({ defaults: [], exceptions: [], hadPerDimension: false })).toEqual({ ok: false, error: 'Choose at least one accepted scale.' });
    expect(
      scalePolicyValue({ defaults: ['city'], exceptions: [{ dimension: 'water-sanitation', other: false, scales: [] }], hadPerDimension: false }),
    ).toEqual({ ok: false, error: 'Choose at least one scale for Water & Sanitation.' });
    const ghg = overrideDrafts({ 'climate-change.ghg-per-capita': { target: 1, rationale: 'r' } })[0]!;
    const name = 'Climate Change: Community greenhouse gas emissions per capita';
    expect(thresholdOverridesValue([ghg, ghg])).toEqual({ ok: false, error: `${name} has two targets. Keep one.` });
    expect(thresholdOverridesValue([{ ...ghg, target: '' }])).toEqual({ ok: false, error: `${name} needs a target number.` });
    expect(thresholdOverridesValue([{ ...ghg, targetYear: '2040.5' }]).ok).toBe(false);
    const own = overrideDrafts({ constructor: { target: 1, rationale: 'r' } })[0]!;
    expect(thresholdOverridesValue([own, own])).toEqual({ ok: false, error: 'constructor has two targets. Keep one.' });
    const exception = scalePolicyDraft({ default_accepted: ['city'], per_dimension: { toString: ['state' as const] } }).exceptions[0]!;
    expect(scalePolicyValue({ defaults: ['city'], exceptions: [exception, exception], hadPerDimension: true })).toEqual({
      ok: false,
      error: 'toString has two exceptions. Keep one.',
    });
  });

  it('trims the spaces around a key the owner typed, and keeps a stored one exactly', () => {
    const typed = { ...newOverrideDraft([]), other: true, ref: '  our.own-indicator ', target: '5', rationale: 'r' };
    expect(thresholdOverridesValue([typed])).toEqual({ ok: true, value: { 'our.own-indicator': { target: 5, rationale: 'r' } } });
    const [stored] = overrideDrafts({ ' padded.key ': { target: 4, rationale: 'd' } });
    expect(thresholdOverridesValue([stored!])).toEqual({ ok: true, value: { ' padded.key ': { target: 4, rationale: 'd' } } });
    // Once the owner edits the key, it is theirs and is trimmed.
    expect(thresholdOverridesValue([{ ...stored!, ref: ' padded.key  ' }])).toEqual({ ok: true, value: { 'padded.key': { target: 4, rationale: 'd' } } });
    const typedDimension = { dimension: ' our-own-dimension ', other: true, scales: ['state' as const] };
    expect(scalePolicyValue({ defaults: ['city'], exceptions: [typedDimension], hadPerDimension: false })).toEqual({
      ok: true,
      value: { default_accepted: ['city'], per_dimension: { 'our-own-dimension': ['state'] } },
    });
    expect(thresholdOverridesValue([{ ...typed, ref: '   ' }])).toEqual({ ok: false, error: 'Choose the indicator for each target.' });
  });
});

describe('the settings page as an owner sees it', () => {
  it('has a form, not a JSON box, for each of the three list settings', () => {
    const html = render();
    expect(html).not.toMatch(/<textarea[^>]*font-mono/);
    for (const title of ['Source priority tiers', 'Geographic scale policy', 'Threshold overrides', 'Logo, colour and font']) {
      expect(section(html, title)).toContain('>Save</button>');
    }
  });

  it('shows each stored tier in its own fields, in order', () => {
    const html = section(render({ sourcePriority: SOURCE_PRIORITIES[0]! }), 'Source priority tiers');
    const tiers = SOURCE_PRIORITIES[0]!.tiers;
    expect(html.match(/data-tier-row/g)).toHaveLength(tiers.length);
    for (const [i, t] of tiers.entries()) {
      expect(tagWith(html, `name="tier-${i}-number"`)).toContain(`value="${t.tier}"`);
      expect(tagWith(html, `name="tier-${i}-name"`)).toContain(`value="${t.name}"`);
      expect(html).toContain(`name="tier-${i}-examples">${t.examples!.join('\n')}</textarea>`);
    }
  });

  it('shows the accepted scales best first, and each exception with its dimension', () => {
    const html = section(render({ scalePolicy: SCALE_POLICIES[3]! }), 'Geographic scale policy');
    const choice = (n: number) => html.slice(html.indexOf(`aria-label="Accepted scale, choice ${n}"`)).split('</select>')[0]!;
    expect(choice(1)).toContain('<option value="city" selected="">City</option>');
    expect(choice(2)).toContain('<option value="county" selected="">County</option>');
    expect(html).not.toContain('aria-label="Accepted scale, choice 3"');
    expect(html.match(/data-scale-exception/g)).toHaveLength(2);
    expect(html).toContain('<option value="ocean-acidification" selected="">Ocean Acidification</option>');
    // A dimension outside the list keeps its own name, typed by hand.
    expect(html).toContain('<option value="__other__" selected="">Another dimension (type its short name)</option>');
    expect(html).toMatch(/<input[^>]*required=""[^>]*value="our-own-dimension"/);
  });

  it('shows a stored override with its indicator, target and reason, and asks for a reason on every one', () => {
    const html = section(render({ thresholdOverrides: THRESHOLD_OVERRIDES[1]! }), 'Threshold overrides');
    expect(html).toContain('<option value="housing.cost-burdened-renters" selected="">');
    expect(tagWith(html, 'name="override-0-target"')).toContain('value="25"');
    const reason = tagWith(html, 'name="override-0-rationale"');
    expect(reason).toContain('required=""');
    const describedBy = /aria-describedby="([^"]+)"/.exec(reason)?.[1];
    expect(html).toContain(
      `<span id="${describedBy}" class="mt-1 block text-xs text-[color:var(--color-muted)]">Required. Shown word for word on your public methodology page.</span>`,
    );
    expect(html).toContain('>City housing plan target.</textarea>');
  });

  it('offers the listed fonts only, and shows the stored colour, font and logo', () => {
    const branding: TenantBranding = { primary_color: '#2f7d32', font: 'serif', logo_url: 'branding/logo-a.png' };
    const html = section(render({ branding, logoUrl: '/evidence/nyc/branding/logo-a.png' }), 'Logo, colour and font');
    const options = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(options).toEqual(BRAND_FONTS.map((f) => f.key));
    expect(html).toContain('<option value="serif" selected="">');
    expect(tagWith(html, 'type="color"')).toContain('value="#2f7d32"');
    expect(tagWith(html, 'type="color"')).not.toContain('disabled');
    expect(html).toContain('<img src="/evidence/nyc/branding/logo-a.png" alt="Your current logo"');
    expect(html).toContain('name="remove_logo"');
    expect(html).toContain('It has to show clearly on both the light and the dark page.');
  });

  it('starts with no colour strip and the standard font when nothing is stored', () => {
    const html = section(render(), 'Logo, colour and font');
    expect(tagWith(html, 'type="color"')).toContain('disabled=""');
    expect(html).toContain('<option value="inter" selected="">');
    expect(html).not.toContain('name="remove_logo"');
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const uniq = () => `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!hasDb)('saving the forms through the settings action', () => {
  const saved = process.env.AUTH_SECRET;
  const cleanup: { tenantId?: string; organizationId?: string; userIds: string[] } = { userIds: [] };
  let tenantSlug = '';
  let tenantId = '';

  beforeAll(async () => {
    process.env.AUTH_SECRET = 'test-secret';
    const m = await import('@deep-fryer/db');
    const db = m.getDb();
    const { tenant } = await m.provisionTenant(db, { slug: uniq(), name: 'Settings City' });
    tenantSlug = tenant.slug;
    tenantId = tenant.id;
    cleanup.tenantId = tenant.id;
    cleanup.organizationId = tenant.organizationId;
    const [user] = await db.insert(m.users).values({ email: `${uniq()}@owner.example.gov` }).returning();
    cleanup.userIds.push(user!.id);
    await db.insert(m.tenantMembers).values({ tenantId: tenant.id, userId: user!.id, role: 'owner' });
    signedIn = user!.id;
  });

  afterAll(async () => {
    signedIn = null;
    if (saved === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = saved;
    const m = await import('@deep-fryer/db');
    const { eq, inArray } = await import('drizzle-orm');
    const db = m.getDb();
    if (cleanup.tenantId) await db.delete(m.tenants).where(eq(m.tenants.id, cleanup.tenantId));
    if (cleanup.organizationId) await db.delete(m.organizations).where(eq(m.organizations.id, cleanup.organizationId));
    if (cleanup.userIds.length) await db.delete(m.users).where(inArray(m.users.id, cleanup.userIds));
  });

  async function stored(key: 'source_priority' | 'scale_policy' | 'threshold_overrides') {
    const m = await import('@deep-fryer/db');
    const { and, eq } = await import('drizzle-orm');
    const [row] = await m
      .getDb()
      .select()
      .from(m.tenantConfig)
      .where(and(eq(m.tenantConfig.tenantId, tenantId), eq(m.tenantConfig.key, key)));
    return row?.value;
  }

  it('stores each value, and the form made from the stored row saves it back unchanged', async () => {
    const { updateConfig } = await import('@/lib/actions');
    const cases = [
      ...SOURCE_PRIORITIES.map((v) => ['source_priority', v, (s: unknown) => sourcePriorityValue(tierDrafts(s as SourcePriority))] as const),
      ...SCALE_POLICIES.map((v) => ['scale_policy', v, (s: unknown) => scalePolicyValue(scalePolicyDraft(s as ScalePolicy))] as const),
      ...THRESHOLD_OVERRIDES.map(
        (v) => ['threshold_overrides', v, (s: unknown) => thresholdOverridesValue(overrideDrafts(s as ThresholdOverrides))] as const,
      ),
    ];
    for (const [key, value, formValue] of cases) {
      expect(await updateConfig({ tenantSlug, key, value }), key).toEqual({ ok: true, data: undefined });
      const first = await stored(key);
      const again = formValue(first);
      expect(again, key).toEqual({ ok: true, value: first });
      expect(await updateConfig({ tenantSlug, key, value: again.ok ? again.value : null })).toEqual({ ok: true, data: undefined });
      expect(await stored(key)).toEqual(first);
    }
  });

  it('refuses an override without a reason, and keeps the setting as it was', async () => {
    const { updateConfig } = await import('@/lib/actions');
    const before = await stored('threshold_overrides');
    for (const value of [
      { 'housing.cost-burdened-renters': { target: 25 } },
      { 'housing.cost-burdened-renters': { target: 25, rationale: '' } },
    ]) {
      const res = await updateConfig({ tenantSlug, key: 'threshold_overrides', value });
      expect(res.ok).toBe(false);
      expect(res.ok ? '' : res.error).toMatch(/^housing\.cost-burdened-renters\.rationale: /);
    }
    expect(await stored('threshold_overrides')).toEqual(before);
  });
});
