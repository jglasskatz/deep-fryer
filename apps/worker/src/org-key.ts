import { eq } from 'drizzle-orm';
import {
  SecretDecryptError,
  SecretsKeyError,
  decryptSecret,
  parseSecretsKey,
} from '@deep-fryer/core/secrets';
import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import type { SessionTokenUsage } from '@deep-fryer/core';
import { organizationApiKeys, tenants, type DbExecutor, type ResearchFunding } from '@deep-fryer/db';

/**
 * The organization's own Anthropic API key, for its sessions (SPEC-v7 §4).
 *
 * The worker is the only place a stored key is decrypted: it connects as
 * the table owner, so it can read `organization_api_keys.ciphertext`, which
 * the web app's role cannot (migration 0011). The plaintext goes straight
 * into the session subprocess environment (session.ts sessionEnv) and
 * nowhere else — this module never logs it, and its errors never contain it.
 */

/**
 * Work the research gate funded with the organization's own key cannot use
 * that key: DF_SECRETS_KEY is missing or malformed on this worker, the key
 * was encrypted under a different DF_SECRETS_KEY (the operator rotated it),
 * or the key was removed after the work was queued (sessionApiKey). The
 * message is written for staff — it is stored on a failed analysis and in a
 * failed run's session transcripts — and says what to do.
 *
 * Callers must fail the work instead of falling back to the deployment's
 * key: the organization was told its sessions run on its own key, and the
 * gate let them start without counting them against the plan.
 *
 * It is also thrown once a session has started, when Anthropic rejects the
 * key itself (orgKeyRejected, below). Then `usage` carries whatever the
 * session had spent on the key before the rejection — a key that runs out
 * of credit mid-session has paid for the turns before it — so the caller
 * can still record it.
 */
export class OrgKeyUnavailableError extends Error {
  readonly usage?: SessionTokenUsage;
  /** Set when Anthropic refused the key (orgKeyRejected): which refusal, for the caller's operator log. */
  readonly rejection?: KeyRejection;
  /** With `rejection`: the model the refused session asked for. */
  readonly model?: string;

  constructor(
    message: string,
    options: { usage?: SessionTokenUsage; rejection?: KeyRejection; model?: string } = {},
  ) {
    super(message);
    this.name = 'OrgKeyUnavailableError';
    if (options.usage) this.usage = options.usage;
    if (options.rejection) this.rejection = options.rejection;
    if (options.model) this.model = options.model;
  }
}

/** Kept short: it is stored on the analysis (400 characters at most) and shown as is. */
export const ORG_KEY_UNREADABLE =
  "This organization's Anthropic API key could not be read on the research server (its encryption key was changed after the key was saved), so nothing ran — the deployment's own key is never used in its place. An organization owner can enter the key again under Billing, then start this again.";

export const ORG_KEY_NO_SECRETS_KEY =
  "This organization has an Anthropic API key on file, but the research server is not configured to read it (DF_SECRETS_KEY is missing or invalid), so nothing ran — the deployment's own key is never used in its place. Ask the operator to set DF_SECRETS_KEY on the worker, then start this again.";

/**
 * The work was started on the organization's own key, and the key was removed
 * from Billing while it waited in the queue. Starting it again goes through
 * the research gate afresh: on the key, if an owner has added one again, or
 * else on the plan's research sessions (which the gate checks then).
 */
export const ORG_KEY_REMOVED =
  "This was started on this organization's own Anthropic API key, which was removed before it ran, so nothing ran — the deployment's own key is never used in its place. An organization owner can add the key again under Billing, then start this again; started again without a key, it uses the plan's research sessions.";

/**
 * The errors with which Anthropic refuses the key itself, as the Agent SDK
 * names them on an assistant message (SDKAssistantMessage.error, of type
 * SDKAssistantMessageError). None of them goes away on a retry: a revoked or
 * mistyped key, an account out of credit, a model the key's workspace may
 * not use, an organization that does not allow this access. So a session
 * that hits one is not run again (session.ts runSessionWithRetry), and on an
 * organization's key the work stops with orgKeyRejected's reason instead of
 * starting every remaining session only to be refused again.
 *
 * `model_not_found` is the one that may not be the key's fault: the bundled
 * CLI reports every 404 that names a model this way, so a mistyped or
 * retired ANTHROPIC_MODEL / VERIFIER_MODEL reads exactly like a model the
 * key may not use. It is still not retried (the same id fails again), but
 * its reason names both causes and the operator is logged the model id
 * (modelNotFoundLog).
 */
export const KEY_REJECTED_ERRORS = [
  'authentication_failed',
  'billing_error',
  'model_not_found',
  'oauth_org_not_allowed',
] as const satisfies readonly SDKAssistantMessageError[];
export type KeyRejectedError = (typeof KEY_REJECTED_ERRORS)[number];

export function isKeyRejectedError(error: string | undefined): error is KeyRejectedError {
  return (KEY_REJECTED_ERRORS as readonly string[]).includes(error ?? '');
}

/**
 * Two more dead-key cases the bundled CLI (0.3.220, pinned exactly) does not
 * give an error of their own. When the key comes from ANTHROPIC_API_KEY —
 * which is how session.ts sessionEnv hands a session the organization's key
 * — it reports a key whose Anthropic organization has been disabled (the
 * API's 400 "organization has been disabled") and an organization that has
 * turned API-key authentication off (403 "API key authentication is
 * disabled") as a plain `invalid_request`, with its own wording on the error
 * frame. Neither goes away on a retry either. The phrases are the CLI's
 * message text (lower-cased), which is why they are tied to the pinned SDK:
 * a CLI that rewords them makes these sessions read as ordinary invalid
 * requests again (retried once, then failed), never as a different refusal.
 */
const INVALID_REQUEST_KEY_REJECTIONS = [
  ['organization_disabled', 'belongs to a disabled organization'],
  ['api_key_auth_disabled', 'has disabled api key authentication'],
] as const;

/** Every way Anthropic can refuse the key itself: the SDK's errors above, and the two the CLI reports as `invalid_request`. */
export type KeyRejection = KeyRejectedError | (typeof INVALID_REQUEST_KEY_REJECTIONS)[number][0];

/**
 * Pure: whether a session's failure was Anthropic refusing the key itself,
 * and which refusal — from the error on the session's own (main-loop) error
 * frame (SDKAssistantMessage.error) and that frame's text, which only the
 * `invalid_request` cases need. Null for every other failure, which a retry
 * may fix.
 */
export function keyRejection(error: string | undefined, text?: string): KeyRejection | null {
  if (isKeyRejectedError(error)) return error;
  if (error !== 'invalid_request' || !text) return null;
  const lower = text.toLowerCase();
  for (const [rejection, phrase] of INVALID_REQUEST_KEY_REJECTIONS) if (lower.includes(phrase)) return rejection;
  return null;
}

/**
 * Pure: the model a `model_not_found` error frame says was not found, or
 * null when its text does not name one. The CLI words it "There's an issue
 * with the selected model (<id>)…" or "The model <id> is not available…".
 * It is the model actually requested, which is not always the configured
 * one: the CLI's own refusal fallback (armed for claude-opus-5) retries a
 * refused turn on another model, and that model may be the one the key's
 * workspace does not allow.
 */
export function modelNamedIn(text: string | undefined): string | null {
  const m = text?.match(/selected model \(([^)\s]+)\)/) ?? text?.match(/The model (\S+) is not available/);
  return m?.[1] ?? null;
}

/**
 * Kept short like the messages above: stored on a failed analysis (400
 * characters at most) and in failed runs' transcripts.
 */
const REJECTED_TAIL = "so it stopped — the deployment's own key is never used in its place.";

/**
 * Pure: why work on the organization's own key stopped, for staff, when
 * Anthropic refused that key (`rejection`, from keyRejection) for a session
 * on `model`. It says whose key it was and what an organization owner can
 * do. The operator cannot fix an organization's key or its Anthropic
 * account, so only `model_not_found` — which a wrong model setting on the
 * research service produces too — mentions the operator, and only as the
 * second thing to check.
 */
export function orgKeyRejected(
  rejection: KeyRejection,
  model: string,
  usage?: SessionTokenUsage,
): OrgKeyUnavailableError {
  const shortModel = model.slice(0, 60);
  const messages: Record<KeyRejection, string> = {
    authentication_failed: `Anthropic rejected this organization's own API key (it may have been revoked, expired or mistyped), ${REJECTED_TAIL} An organization owner can enter a working key under Billing, then start this again.`,
    billing_error: `Anthropic reported a billing problem on the account behind this organization's own API key (usually no credit left), ${REJECTED_TAIL} An organization owner can add credit in the Anthropic Console, or enter another key under Billing, then start this again.`,
    model_not_found: `Anthropic did not find the model this needs (${shortModel}) for this organization's own API key (the key may not allow it, or the model setting is wrong), ${REJECTED_TAIL} An organization owner can allow it in the Anthropic Console, or ask the operator to check the setting, then start this again.`,
    oauth_org_not_allowed: `Anthropic does not allow this organization's own API key to be used this way (its Anthropic organization's settings refuse it), ${REJECTED_TAIL} An organization owner can check those settings in the Anthropic Console, or enter another key under Billing, then start this again.`,
    organization_disabled: `Anthropic reports that the Anthropic organization behind this organization's own API key has been disabled, ${REJECTED_TAIL} An organization owner can resolve that with Anthropic, or enter a key from another Anthropic organization under Billing, then start this again.`,
    api_key_auth_disabled: `The Anthropic organization behind this organization's own API key has turned off API key access, ${REJECTED_TAIL} An organization owner can allow API keys in that organization's Anthropic Console settings, or enter another key under Billing, then start this again.`,
  };
  return new OrgKeyUnavailableError(messages[rejection], { ...(usage ? { usage } : {}), rejection, model });
}

/**
 * Pure: the OrgKeyUnavailableError for a session Anthropic refused the key
 * of — from the session's error report (SessionResult or SessionRunError:
 * the main-loop error and its frame's text) — or null when the failure was
 * something else. `model` is the model the session was started on; a
 * `model_not_found` reason names the model the error frame names instead,
 * when it names one (modelNamedIn).
 */
export function rejectedKeyError(
  report: { apiError?: string; apiErrorText?: string },
  model: string,
  usage?: SessionTokenUsage,
): OrgKeyUnavailableError | null {
  const rejection = keyRejection(report.apiError, report.apiErrorText);
  if (!rejection) return null;
  const named = rejection === 'model_not_found' ? modelNamedIn(report.apiErrorText) : null;
  return orgKeyRejected(rejection, named ?? model, usage);
}

/**
 * Pure: the error-level log line for the operator when a session failed with
 * `model_not_found` — on the deployment's key always a configuration
 * problem, and on an organization's key possibly one (KEY_REJECTED_ERRORS).
 * Staff read the reason on the run or analysis; the operator reads this.
 */
export function modelNotFoundLog(model: string, onOrganizationKey: boolean): string {
  const whose = onOrganizationKey ? "the organization's own API key" : "the deployment's API key";
  return `Anthropic reported model_not_found for model "${model.slice(0, 80)}" on ${whose}: check that ANTHROPIC_MODEL / VERIFIER_MODEL name a valid model id${onOrganizationKey ? ", or that the key's workspace may use it" : ''}`;
}

/**
 * The plaintext key of the organization holding `tenantId`, or null when the
 * organization has none on file. Throws OrgKeyUnavailableError when a key is
 * on file but cannot be decrypted. Tasks do not call this directly: which key
 * a session uses follows the funding stored on the work (sessionApiKey,
 * below), not merely whether a key is on file now.
 *
 * The ciphertext is bound to the organization's id (associated data), so a
 * ciphertext copied onto another organization's row does not decrypt there.
 */
export async function orgApiKeyForTenant(
  db: DbExecutor,
  tenantId: string,
  rawSecretsKey: string | undefined = process.env.DF_SECRETS_KEY,
): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: organizationApiKeys.organizationId, ciphertext: organizationApiKeys.ciphertext })
    .from(organizationApiKeys)
    .innerJoin(tenants, eq(tenants.organizationId, organizationApiKeys.organizationId))
    .where(eq(tenants.id, tenantId));
  if (!row) return null;

  let secretsKey: Uint8Array;
  try {
    secretsKey = parseSecretsKey(rawSecretsKey);
  } catch (err) {
    if (err instanceof SecretsKeyError) throw new OrgKeyUnavailableError(ORG_KEY_NO_SECRETS_KEY);
    throw err;
  }
  try {
    return await decryptSecret(row.ciphertext, secretsKey, row.organizationId);
  } catch (err) {
    if (err instanceof SecretDecryptError) throw new OrgKeyUnavailableError(ORG_KEY_UNREADABLE);
    throw err;
  }
}

/**
 * The key a run's or an analysis's sessions use: the one the research gate
 * chose when it let the work through, stored on the row as `funding`
 * (packages/db billing.ts gateResearchSpend, migration 0012) — never simply
 * whatever is on file when the job runs, which may have changed since.
 *
 * - 'plan': null, so the sessions run on the deployment's ANTHROPIC_API_KEY.
 *   The work was counted against the plan's allowance; an organization key
 *   added since is not used, or the organization would pay twice — with its
 *   key and with its allowance. The key is not even looked up (or decrypted).
 * - 'organization_key': the organization's key (orgApiKeyForTenant). The work
 *   was let through without an allowance check, so it must not run on the
 *   deployment's key: a key removed since fails it with ORG_KEY_REMOVED, and
 *   one that cannot be decrypted with orgApiKeyForTenant's reasons — always
 *   as OrgKeyUnavailableError, which callers record for staff instead of
 *   starting a session.
 */
export async function sessionApiKey(
  db: DbExecutor,
  tenantId: string,
  funding: ResearchFunding,
  rawSecretsKey: string | undefined = process.env.DF_SECRETS_KEY,
): Promise<string | null> {
  if (funding === 'plan') return null;
  const apiKey = await orgApiKeyForTenant(db, tenantId, rawSecretsKey);
  if (apiKey === null) throw new OrgKeyUnavailableError(ORG_KEY_REMOVED);
  return apiKey;
}
