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

/**
 * DF_FIRST_DOUGHNUT: how a group pays for the research behind its first
 * doughnut on this deployment. One named choice, so every screen and the
 * research gate read the same rule.
 *
 * - `paid` (the default, and what unset or blank means): a plan in good
 *   standing or a contract, as for any research.
 * - `own`: an organization with no plan may build its first doughnut once,
 *   on its own research key; everything after that needs a plan or a
 *   contract again. It only does anything where organizations can store a
 *   key (DF_SECRETS_KEY).
 */
export const FIRST_DOUGHNUT_CHOICES = ['paid', 'own'] as const;
export type FirstDoughnut = (typeof FIRST_DOUGHNUT_CHOICES)[number];

/** Choices that are planned but not built: a deployment set to one refuses to start rather than run as `paid`. */
const FIRST_DOUGHNUT_NOT_BUILT = ['approval', 'starter'] as const;

function firstDoughnutRaw(env: Env): string {
  return env.DF_FIRST_DOUGHNUT?.trim().toLowerCase() ?? '';
}

const isFirstDoughnut = (raw: string): raw is FirstDoughnut =>
  (FIRST_DOUGHNUT_CHOICES as readonly string[]).includes(raw);

/** What is wrong with DF_FIRST_DOUGHNUT, or null when it is unset or one of the accepted choices. */
export function firstDoughnutProblem(env: Env): string | null {
  const raw = firstDoughnutRaw(env);
  if (raw === '' || isFirstDoughnut(raw)) return null;
  const accepted = `accepted choices: ${FIRST_DOUGHNUT_CHOICES.join(', ')} (unset means paid)`;
  if ((FIRST_DOUGHNUT_NOT_BUILT as readonly string[]).includes(raw)) {
    return `DF_FIRST_DOUGHNUT=${raw} is not available yet; ${accepted}`;
  }
  // The value is the operator's own typing, not a secret, but a long or odd one is not echoed.
  return `DF_FIRST_DOUGHNUT must be one of the accepted choices: ${FIRST_DOUGHNUT_CHOICES.join(', ')} (unset means paid)`;
}

/**
 * The deployment's first-doughnut choice. Anything that is not an accepted
 * choice reads as `paid`, the stricter rule, so a mistyped value outside
 * production never hands out research; production refuses to start on it
 * (productionEnvProblems).
 */
export function firstDoughnutChoice(env: Env): FirstDoughnut {
  const raw = firstDoughnutRaw(env);
  return isFirstDoughnut(raw) ? raw : 'paid';
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
  const firstDoughnut = firstDoughnutProblem(env);
  if (firstDoughnut) problems.push(firstDoughnut);
  return problems;
}
