/**
 * The production environment contract, as a pure function of the
 * environment: what a deployment must set before it may serve anyone. The
 * web app refuses to boot on any problem (apps/web/lib/env.ts →
 * instrumentation.ts) and the operator preflight (scripts/preflight.ts)
 * reports the same list, so the two can never disagree.
 */
import { decodeBase64 } from './base64.js';

export type Env = Record<string, string | undefined>;

/** Bytes in DF_SECRETS_KEY: an AES-256 key (SPEC-v7 §4). */
export const SECRETS_KEY_BYTES = 32;

/**
 * What is wrong with a DF_SECRETS_KEY value, or null when it is a usable
 * AES-256 key: standard base64 that decodes to exactly 32 bytes, which is
 * what `openssl rand -base64 32` prints. A shorter or longer key is refused
 * rather than stretched or truncated, so the key the operator generated is
 * the key that encrypts. The value itself never appears in the message.
 */
export function secretsKeyProblem(raw: string): string | null {
  const generate = 'generate one with: openssl rand -base64 32';
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(raw.trim());
  } catch {
    return `DF_SECRETS_KEY must be base64 (${generate})`;
  }
  if (bytes.length !== SECRETS_KEY_BYTES) {
    return `DF_SECRETS_KEY must decode to ${SECRETS_KEY_BYTES} bytes, not ${bytes.length} (${generate})`;
  }
  return null;
}

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
  // Every customer-facing dead end — the site footer, error pages, a refused
  // research spend — ends in "contact <this address>", so a production site
  // without one would leave people nowhere to turn. Blank counts as unset:
  // compose passes `${SUPPORT_EMAIL:-}` through. Its shape is the preflight's
  // warning (contactAddressesVerdict), not a boot failure.
  if (!env.SUPPORT_EMAIL?.trim()) {
    problems.push(
      'SUPPORT_EMAIL is required: the address people write to for help, shown in the site footer and on error pages (e.g. SUPPORT_EMAIL=help@yourcity.gov)',
    );
  }
  if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
    problems.push('set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET together (or neither)');
  }
  if (env.STRIPE_API_BASE) {
    problems.push('STRIPE_API_BASE points Stripe calls at a test server (stripe-mock); unset it in production');
  }
  // Optional (SPEC-v7 §4): without it, organizations cannot store their own
  // Anthropic API key and research runs on the deployment's key only. When
  // it is set it must be a real AES-256 key — a malformed one would surface
  // only when the first owner saves a key, or worse, after keys are stored.
  // Blank counts as unset: compose passes `${DF_SECRETS_KEY:-}` through.
  const secretsKey = env.DF_SECRETS_KEY?.trim();
  if (secretsKey) {
    const problem = secretsKeyProblem(secretsKey);
    if (problem) problems.push(problem);
  }
  return problems;
}
