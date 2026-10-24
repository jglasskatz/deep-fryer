import { describe, expect, it } from 'vitest';
import { ALL_PORTRAIT_FEATURES_ON, PORTRAIT_FEATURES, type PortraitFeature } from '@deep-fryer/core';
import { adminNavLinks, familyViews, tenantNavLinks, type PortraitFeatures } from './nav-links';

/**
 * SPEC-v7 §3.3–3.4: with a feature off its links are gone from the header,
 * the admin nav, and the family nav; with it on they are back. The core
 * links never move.
 */
const allOn: PortraitFeatures = { ...ALL_PORTRAIT_FEATURES_ON };
const allOff = Object.fromEntries(PORTRAIT_FEATURES.map((f) => [f, false])) as PortraitFeatures;
const only = (f: PortraitFeature): PortraitFeatures => ({ ...allOff, [f]: true });

const labels = { progress: 'Progress', methodology: 'Methodology', getInvolved: 'Get involved', emergency: 'Emergencies' };
const href = (p: string) => p;
const counts = { heldComments: 2, newSubmissions: 5 };

describe('tenantNavLinks', () => {
  it('keeps the core links with every feature off, and adds Emergencies only with its feature', () => {
    expect(tenantNavLinks('nyc', allOff, labels, href).map((l) => l.href)).toEqual([
      '/nyc/progress',
      '/nyc/methodology',
      '/nyc/outreach',
    ]);
    expect(tenantNavLinks('nyc', only('emergency'), labels, href).map((l) => l.href)).toContain('/nyc/emergency');
  });

  it('localizes through the given href builder', () => {
    expect(tenantNavLinks('nyc', allOn, labels, (p) => `/es${p}`)[0]!.href).toBe('/es/nyc/progress');
  });
});

describe('adminNavLinks', () => {
  const featureLinks: [PortraitFeature, string][] = [
    ['discussion', '/nyc/admin/discussion'],
    ['policy_analysis', '/nyc/admin/policy'],
    ['emergency', '/nyc/admin/emergency'],
    ['involvement', '/nyc/admin/involvement'],
    ['custom_pages', '/nyc/admin/pages'],
  ];

  it('shows only the core staff pages with every feature off', () => {
    expect(adminNavLinks({ tenantSlug: 'nyc', orgSlug: 'nyc', features: allOff, counts }).map((l) => l.label)).toEqual([
      'Overview',
      'Review',
      'Research',
      'Portrait content',
      'Outreach contacts',
      'Members',
      'Settings',
      'Billing',
      'Public site ↗',
    ]);
  });

  it.each(featureLinks)('adds the %s page only when that feature is on', (feature, path) => {
    const off = adminNavLinks({ tenantSlug: 'nyc', orgSlug: null, features: { ...allOn, [feature]: false }, counts });
    expect(off.map((l) => l.href)).not.toContain(path);
    const on = adminNavLinks({ tenantSlug: 'nyc', orgSlug: null, features: only(feature), counts });
    expect(on.map((l) => l.href)).toContain(path);
  });

  it('keeps the queue badges with their links, in the documented order', () => {
    const links = adminNavLinks({ tenantSlug: 'nyc', orgSlug: 'nyc', features: allOn, counts });
    expect(links.map((l) => l.label)).toEqual([
      'Overview',
      'Review',
      'Discussion',
      'Research',
      'Portrait content',
      'Outreach contacts',
      'Policy',
      'Emergency',
      'Get involved',
      'Pages',
      'Members',
      'Settings',
      'Billing',
      'Public site ↗',
    ]);
    expect(links.find((l) => l.label === 'Discussion')).toMatchObject({ count: 2, countLabel: 'awaiting approval' });
    expect(links.find((l) => l.label === 'Get involved')).toMatchObject({ count: 5, countLabel: 'new submissions' });
  });

  it('leaves Billing out when the portrait has no organization page to link', () => {
    expect(adminNavLinks({ tenantSlug: 'nyc', orgSlug: null, features: allOn, counts }).map((l) => l.label)).not.toContain(
      'Billing',
    );
  });
});

describe('familyViews', () => {
  it('offers Compare and Insights only with family_compare on; progress always', () => {
    expect(familyViews(allOff)).toEqual(['progress']);
    expect(familyViews(only('family_compare'))).toEqual(['compare', 'insights', 'progress']);
  });
});
