import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIRST_DOUGHNUT_CHOICES } from '@deep-fryer/core';
import { decideResearchSpend, type Subscription } from '@deep-fryer/db';

/**
 * The owner's rule, "No free trials for making donuts, but free to view":
 * nothing may give an organization research it has not paid for. The
 * behaviour is tested where it lives (core plans.test.ts, packages/db
 * provision.test.ts, lib/org-actions.test.ts, lib/research-actions.test.ts);
 * this test reads the source so that nothing new brings a trial back — a
 * subscription written as 'trialing' or on the 'trial' plan, a trial length,
 * or a Stripe trial on checkout. The 'trial' plan id and the 'trialing'
 * status stay in the types, the schema and the Stripe status mapping, for
 * subscriptions that began before trials were retired; those only read them.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ROOTS = ['apps/web/app', 'apps/web/lib', 'apps/web/components', 'apps/worker/src', 'packages', 'scripts'];

/** Ways code starts a trial: the old option and constant, a row written as one, or Stripe's trial parameters. */
const STARTS_A_TRIAL = [
  /\bstartTrial\b/,
  /\bTRIAL_DAYS\b/,
  /\btrial_period_days\b/,
  /\btrial_end\s*:/,
  /\bstatus\s*:\s*['"]trialing['"]/,
  /\bplan\s*:\s*['"]trial['"]/,
  // A validator that lets 'trial' in from a request (setContract's plan once did): the value then reaches a write.
  /\bz\.enum\(\s*\[[^\]]*['"]trial['"]/,
];

/**
 * Words that offer a trial to a reader. Matched against what a page or a
 * catalog says, with comments taken out: code may explain that trials are
 * gone, but no page may promise one ("Start a 30-day trial" outlived them
 * once, on the account page).
 */
const OFFERS_A_TRIAL = /\b\d+[- ]day trial\b|\bfree trial\b|\btrial period\b|\bstart a trial\b|\btry it free\b/i;

/** The source without its comments: block comments (JSX ones included) and line comments. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return ['node_modules', '.next', 'dist', 'migrations'].includes(d.name) ? [] : sourceFiles(rel);
    // Tests may build trial rows on purpose: that is how they check the ones that still exist.
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [rel] : [];
  });
}

describe('no free research', () => {
  it('has no code path that starts a trial', () => {
    const files = ROOTS.flatMap(sourceFiles);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((f) => {
      const source = readFileSync(path.join(REPO, f), 'utf8');
      return STARTS_A_TRIAL.filter((re) => re.test(source)).map((re) => `${f}: ${re.source}`);
    });
    expect(offenders).toEqual([]);
    // The check itself still catches a subscription fixture written as a trial.
    const fixture = "await db.insert(subscriptions).values({ organizationId, plan: 'community', status: 'trialing' });";
    expect(STARTS_A_TRIAL.filter((re) => re.test(fixture)).map((re) => re.source)).toEqual([String.raw`\bstatus\s*:\s*['"]trialing['"]`]);
  });

  /**
   * The deployment's first-doughnut choice (DF_FIRST_DOUGHNUT) is the one
   * place research may start without a plan, and only on the group's own
   * key, which pays for it: never on the deployment's key, never for a
   * trial, never twice.
   */
  it('lets research start without a plan only on the organization’s own key, under every first-doughnut choice', () => {
    const trial = {
      organizationId: 'o-1', plan: 'trial', status: 'trialing', collection: 'card',
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86_400_000), trialEndsAt: new Date(Date.now() + 86_400_000),
      cancelAtPeriodEnd: false, firstInvoicePaidAt: null, researchSessionsOverride: 30, portraitsOverride: null, seatsOverride: null,
    } as Subscription;
    for (const choice of FIRST_DOUGHNUT_CHOICES) {
      for (const firstFullBuild of [false, true]) {
        for (const hasKey of [false, true]) {
          for (const requested of [1, 22, 500]) {
            const none = decideResearchSpend(null, 0, hasKey, requested, new Date(), { choice, firstFullBuild });
            if (none.check.allowed) {
              expect({ choice, firstFullBuild, hasKey, funding: none.funding }).toEqual({
                choice: 'own', firstFullBuild: true, hasKey: true, funding: 'organization_key',
              });
            }
            expect(decideResearchSpend(trial, 0, hasKey, requested, new Date(), { choice, firstFullBuild }).check.allowed).toBe(false);
          }
        }
      }
    }
  });

  it('offers no trial anywhere a reader can see: pages, components, and the catalogs (English is the source of every translation)', () => {
    const files = ['apps/web/app', 'apps/web/components', 'apps/web/lib/i18n/messages']
      .flatMap(sourceFiles)
      .filter((f) => f.endsWith('.tsx') || f.includes('i18n/messages'));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => OFFERS_A_TRIAL.test(withoutComments(readFileSync(path.join(REPO, f), 'utf8'))));
    expect(offenders).toEqual([]);
    // The check itself catches the wording that once slipped through.
    expect(OFFERS_A_TRIAL.test('Start a 30-day trial for your jurisdiction')).toBe(true);
    expect(OFFERS_A_TRIAL.test(withoutComments('// never promising a free trial'))).toBe(false);
  });
});
