/**
 * Environment contract for the web app — the one place that knows which
 * variables mean what, so features degrade (locally) or refuse (in
 * production) consistently instead of each module guessing.
 *
 * Local development is allowed to run with almost nothing set (bundled demo
 * portrait, dev-mode auth). Production must fail loudly at boot when a
 * required variable is missing (instrumentation.ts calls
 * assertProductionEnv) rather than serve a site that silently grants
 * anonymous owner access or drops sign-in emails.
 */

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

export const hasDatabase = (): boolean => Boolean(process.env.DATABASE_URL);

/** Auth.js is configured: a signing secret exists. Without it we run dev mode (non-prod only). */
export const authConfigured = (): boolean => Boolean(process.env.AUTH_SECRET);

export const googleConfigured = (): boolean =>
  Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const microsoftConfigured = (): boolean =>
  Boolean(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET);

export const smtpConfigured = (): boolean => Boolean(process.env.SMTP_URL && process.env.EMAIL_FROM);

/**
 * Magic-link sign-in is offered when mail can actually be delivered — or in
 * development, where links print to the server log instead.
 */
export const emailSignInEnabled = (): boolean => smtpConfigured() || !isProduction();

export const stripeConfigured = (): boolean =>
  Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

/** Where customers reach a person (pricing, billing, error pages); optional. */
export const supportEmail = (): string | null => process.env.SUPPORT_EMAIL?.trim() || null;

/**
 * Canonical public origin, no trailing slash ("https://app.deep-fryer.io").
 * Deliberately not NEXT_PUBLIC_*: those are inlined at build time even in
 * server code, and one image must serve any deployment.
 */
export function appUrl(): string {
  const raw = process.env.APP_URL || process.env.AUTH_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

/** Called once at server start; throws with every problem listed. */
export function assertProductionEnv(): void {
  if (!isProduction()) return;
  const problems: string[] = [];
  if (!hasDatabase()) problems.push('DATABASE_URL is required');
  if (!authConfigured()) {
    problems.push('AUTH_SECRET is required (refusing to start in anonymous-owner dev mode)');
  }
  if (!googleConfigured() && !microsoftConfigured() && !smtpConfigured()) {
    problems.push(
      'configure at least one sign-in method: AUTH_GOOGLE_ID/SECRET, AUTH_MICROSOFT_ENTRA_ID_ID/SECRET, or SMTP_URL + EMAIL_FROM',
    );
  }
  if (!process.env.APP_URL) problems.push('APP_URL is required (the public https origin)');
  if (Boolean(process.env.STRIPE_SECRET_KEY) !== Boolean(process.env.STRIPE_WEBHOOK_SECRET)) {
    problems.push('set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET together (or neither)');
  }
  if (problems.length) {
    throw new Error(`deep-fryer refuses to start:\n  - ${problems.join('\n  - ')}`);
  }
}
