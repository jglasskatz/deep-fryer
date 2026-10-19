import { afterEach, describe, expect, it } from 'vitest';
import robots from './robots';

/**
 * /robots.txt: the public plane open to crawlers, staff and account pages,
 * sign-in, start, invitations, embeds and the private API closed — without
 * the bare prefixes that would also hide portraits whose slugs happen to
 * start with "login" or "start".
 */

/** Google's matching for robots.txt paths: `*` is any run of characters, a trailing `$` anchors the end. */
function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map((p) => p.replace(/[.?+^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${body.join('.*')}${anchored ? '$' : ''}`).test(path);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
function allowed(path: string): boolean {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0]! : rules;
  const allow = [rule.allow ?? []].flat().filter((r) => matches(r, path));
  const disallow = [rule.disallow ?? []].flat().filter((r) => matches(r, path));
  const longest = (rs: string[]) => Math.max(-1, ...rs.map((r) => r.length));
  return longest(allow) >= longest(disallow);
}

describe('robots.txt', () => {
  const saved = process.env.APP_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  });

  it('lets crawlers read the public plane and the open-data API', () => {
    for (const path of [
      '/',
      '/pricing',
      '/accessibility',
      '/privacy',
      '/nyc',
      '/es/nyc/dim/housing',
      '/o/nyc/compare',
      '/api/v1/portraits/nyc',
      '/api/v1/portraits/nyc/progress.csv',
      // Portraits whose slugs begin like a closed section's name.
      '/loginville',
      '/startown',
      '/accounting-office',
    ]) {
      expect(allowed(path), path).toBe(true);
    }
  });

  it('keeps out staff, account, billing, sign-in, start, invitation, private API and embed pages', () => {
    for (const path of [
      '/nyc/admin',
      '/nyc/admin/review',
      '/es/nyc/admin',
      '/account',
      '/o/nyc/billing',
      '/api/health',
      '/api/auth/signin',
      '/start',
      '/start?portrait=ithaca',
      '/login',
      '/login/check-email',
      '/login?next=%2Fnyc',
      '/invite/abc123',
      '/embed/nyc',
    ]) {
      expect(allowed(path), path).toBe(false);
    }
  });

  it('points to the sitemap on this deployment’s own address', () => {
    process.env.APP_URL = 'https://doughnut.example.gov/';
    expect(robots().sitemap).toBe('https://doughnut.example.gov/sitemap.xml');
  });
});
