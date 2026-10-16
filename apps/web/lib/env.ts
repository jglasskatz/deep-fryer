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

import { productionEnvProblems } from '@deep-fryer/core';

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

/**
 * DF_SECRETS_KEY (SPEC-v7 §4): the AES-256 key organizations' own Anthropic
 * API keys are encrypted under, as configured (base64), or null when unset.
 * Optional: without it, bring-your-own-key is unavailable and research runs
 * on the deployment's ANTHROPIC_API_KEY only. When it is set, production
 * refuses to boot unless it is 32 bytes of base64 (@deep-fryer/core
 * deploy-env). Blank counts as unset, because docker compose passes
 * `${DF_SECRETS_KEY:-}` through. Only the raw value lives here — server code
 * that encrypts turns it into key material with @deep-fryer/core/secrets
 * parseSecretsKey, so this module stays free of crypto.
 */
export const secretsKey = (): string | null => process.env.DF_SECRETS_KEY?.trim() || null;

/** Organizations may store their own Anthropic API key on this deployment. */
export const bringYourOwnKeyAvailable = (): boolean => secretsKey() !== null;

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

/** Called once at server start; throws with every problem listed (rules: @deep-fryer/core deploy-env). */
export function assertProductionEnv(): void {
  if (!isProduction()) return;
  const problems = productionEnvProblems(process.env);
  if (problems.length) {
    throw new Error(`deep-fryer refuses to start:\n  - ${problems.join('\n  - ')}`);
  }
}
