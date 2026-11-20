/**
 * The ways a group can hand over what it already has, as step two of /start
 * ("What do you already have?") offers them. One list, so the start page,
 * the "no research yet" fallback in step three and the tests all read the
 * same routes; a new way in adds one entry here and nothing else on /start.
 *
 * Each route is a page under the portrait. Its `path` is static below the
 * portrait's address (no other dynamic segment, no query), so a test can find
 * the page file for every entry and render it for an editor
 * (app/start/route-pages.test.ts): a route whose page is missing or broken
 * fails the build rather than reaching a volunteer.
 *
 * Wording is for a volunteer with no technical background: `title` names
 * what the group has, `description` says in one sentence what happens next.
 * Pure data, with no server imports, so the page and its tests share it.
 */
export interface DoughnutRoute {
  /** Stable, unique, lower-case: a React key and the name tests report. */
  id: string;
  /** What the group has, in its own words ("Numbers you already know"). */
  title: string;
  /** What choosing it does, in one plain sentence. */
  description: string;
  /** The page below the portrait's address, e.g. `admin` for `/<portrait>/admin`. */
  path: string;
  /**
   * The route gives the group a doughnut only once research runs (for
   * example, documents that research reads). False for a route that makes
   * a draft from what the group types or uploads itself: those are what
   * step three offers when research cannot run yet.
   */
  needsResearch: boolean;
}

export const DOUGHNUT_ROUTES: readonly DoughnutRoute[] = [
  {
    id: 'type-it-in',
    title: 'Numbers you already know',
    description:
      'Type them in one topic at a time on your portrait’s admin page, each with its year and a link to where it came from. Each one is saved as a draft until your group publishes it.',
    path: 'admin',
    needsResearch: false,
  },
];

/** Where a route opens for one portrait. */
export function routeHref(route: Pick<DoughnutRoute, 'path'>, tenantSlug: string): string {
  return `/${encodeURIComponent(tenantSlug)}/${route.path}`;
}

/** The routes that give a doughnut without research: what a group can do while research cannot run. */
export function routesWithoutResearch(routes: readonly DoughnutRoute[] = DOUGHNUT_ROUTES): DoughnutRoute[] {
  return routes.filter((r) => !r.needsResearch);
}
