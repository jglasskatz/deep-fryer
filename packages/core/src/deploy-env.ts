/**
 * The production environment contract, as a pure function of the
 * environment: what a deployment must set before it may serve anyone. The
 * web app refuses to boot on any problem (apps/web/lib/env.ts →
 * instrumentation.ts) and the operator preflight (scripts/preflight.ts)
 * reports the same list, so the two can never disagree.
 */
export type Env = Record<string, string | undefined>;

export function productionEnvProblems(env: Env): string[] {
  const problems: string[] = [];
  const google = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
  const microsoft = Boolean(env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
  const smtp = Boolean(env.SMTP_URL && env.EMAIL_FROM);
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!env.AUTH_SECRET) problems.push('AUTH_SECRET is required (refusing to start in anonymous-owner dev mode)');
  if (!google && !microsoft && !smtp) {
    problems.push(
      'configure at least one sign-in method: AUTH_GOOGLE_ID/SECRET, AUTH_MICROSOFT_ENTRA_ID_ID/SECRET, or SMTP_URL + EMAIL_FROM',
    );
  }
  if (!env.APP_URL) problems.push('APP_URL is required (the public https origin)');
  if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
    problems.push('set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET together (or neither)');
  }
  if (env.STRIPE_API_BASE) {
    problems.push('STRIPE_API_BASE points Stripe calls at a test server (stripe-mock); unset it in production');
  }
  return problems;
}
