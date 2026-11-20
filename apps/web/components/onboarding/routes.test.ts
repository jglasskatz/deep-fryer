import { describe, expect, it } from 'vitest';
import { DOUGHNUT_ROUTES, routeHref, routesWithoutResearch, type DoughnutRoute } from './routes';

/**
 * The one list of ways in that /start offers. Each entry must be something
 * the start page can link and a test can find a page for (app/start/
 * route-pages.test.ts renders each for an editor); its words are read by a
 * volunteer, so they must be there and be sentences.
 */
describe('the ways in /start offers', () => {
  it('have unique, lower-case ids', () => {
    const ids = DOUGHNUT_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('each open a static page below the portrait: no query, fragment, other dynamic segment or leading slash', () => {
    for (const route of DOUGHNUT_ROUTES) {
      expect(route.path, route.id).toMatch(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
    }
  });

  it('each say what the group has and what happens next', () => {
    for (const route of DOUGHNUT_ROUTES) {
      expect(route.title.trim().length, route.id).toBeGreaterThan(2);
      expect(route.description, route.id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('include at least one that makes a doughnut without research, so a group that cannot pay has a way', () => {
    expect(routesWithoutResearch().length).toBeGreaterThan(0);
  });

  it('link to the portrait they belong to, its address escaped', () => {
    const route: DoughnutRoute = { id: 'x', title: 'X', description: 'X.', path: 'admin/add/sheet', needsResearch: false };
    expect(routeHref(route, 'ithaca')).toBe('/ithaca/admin/add/sheet');
    expect(routeHref(route, 'a b')).toBe('/a%20b/admin/add/sheet');
  });

  it('filter out the ones that need research', () => {
    const routes: DoughnutRoute[] = [
      { id: 'a', title: 'A', description: 'A.', path: 'a', needsResearch: true },
      { id: 'b', title: 'B', description: 'B.', path: 'b', needsResearch: false },
    ];
    expect(routesWithoutResearch(routes).map((r) => r.id)).toEqual(['b']);
  });
});
