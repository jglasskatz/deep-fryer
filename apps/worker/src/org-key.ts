import { and, eq } from 'drizzle-orm';
import {
  SecretDecryptError,
  SecretsKeyError,
  decryptSecret,
  parseSecretsKey,
} from '@deep-fryer/core/secrets';
import type { SDKAssistantMessageError } from '@anthropic-ai/claude-agent-sdk';
import {
  PROVIDER_META,
  type ResearchProvider,
  type SessionTokenUsage,
} from '@deep-fryer/core';
import { organizationApiKeys, tenants, type DbExecutor, type ResearchFunding } from '@deep-fryer/db';

/**
 * The organization's own model-provider API keys (Anthropic, OpenAI, Google
 * Gemini) for its research and policy sessions (SPEC-v7 §4, migration 0028).
 *
 * The worker is the only place a stored key is decrypted: it connects as
 * the table owner, so it can read `organization_api_keys.ciphertext`, which
 * the web app's role cannot (migration 0011). Plaintext keys never appear in
 * logs, transcripts, or error messages.
 */

export class OrgKeyUnavailableError extends Error {
  readonly usage?: SessionTokenUsage;
  /** Set when the provider refused the key (orgKeyRejected): which refusal, for the caller's operator log. */
  readonly rejection?: KeyRejection;
  /** With `rejection`: the model the refused session asked for. */
  readonly model?: string;
  /** Which model provider this error applies to. */
  readonly provider?: ResearchProvider;

  constructor(
    message: string,
    options: {
      usage?: SessionTokenUsage;
      rejection?: KeyRejection;
      model?: string;
      provider?: ResearchProvider;
    } = {},
  ) {
    super(message);
    this.name = 'OrgKeyUnavailableError';
    if (options.usage) this.usage = options.usage;
    if (options.rejection) this.rejection = options.rejection;
    if (options.model) this.model = options.model;
    if (options.provider) this.provider = options.provider;
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

export function orgKeyUnreadableMessage(provider: ResearchProvider = 'anthropic'): string {
  if (provider === 'anthropic') return ORG_KEY_UNREADABLE;
  const name = PROVIDER_META[provider].displayName;
  return `This organization's ${name} API key could not be read on the research server (its encryption key was changed after the key was saved), so nothing ran — the deployment's own key is never used in its place. An organization owner can enter the key again under Billing, then start this again.`;
}

export function orgKeyNoSecretsKeyMessage(provider: ResearchProvider = 'anthropic'): string {
  if (provider === 'anthropic') return ORG_KEY_NO_SECRETS_KEY;
  const name = PROVIDER_META[provider].displayName;
  return `This organization has a ${name} API key on file, but the research server is not configured to read it (DF_SECRETS_KEY is missing or invalid), so nothing ran — the deployment's own key is never used in its place. Ask the operator to set DF_SECRETS_KEY on the worker, then start this again.`;
}

export function orgKeyRemovedMessage(provider: ResearchProvider = 'anthropic'): string {
  if (provider === 'anthropic') return ORG_KEY_REMOVED;
  const name = PROVIDER_META[provider].displayName;
  return `This was started on this organization's own ${name} API key, which is not on file under Billing, so nothing ran — the deployment's own key is never used in its place. An organization owner can add a ${name} key under Billing, then start this again.`;
}

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

const INVALID_REQUEST_KEY_REJECTIONS = [
  ['organization_disabled', 'belongs to a disabled organization'],
  ['api_key_auth_disabled', 'has disabled api key authentication'],
] as const;

export type KeyRejection = KeyRejectedError | (typeof INVALID_REQUEST_KEY_REJECTIONS)[number][0];

export function keyRejection(error: string | undefined, text?: string): KeyRejection | null {
  if (isKeyRejectedError(error)) return error;
  if (error !== 'invalid_request' || !text) return null;
  const lower = text.toLowerCase();
  for (const [rejection, phrase] of INVALID_REQUEST_KEY_REJECTIONS) if (lower.includes(phrase)) return rejection;
  return null;
}

/**
 * Classify a non-2xx HTTP error from OpenAI, Google Gemini, or Anthropic REST
 * calls into a non-retryable `KeyRejection` when the failure is caused by the
 * API key, billing/quota exhaustion, permissions, or an unknown model.
 * Returns `null` for transient errors (5xx, temporary rate limits, etc.).
 */
export function classifyProviderHttpError(
  provider: ResearchProvider,
  status: number,
  bodyText: string,
): KeyRejection | null {
  const lower = bodyText.toLowerCase();

  if (provider === 'openai') {
    if (status === 401) return 'authentication_failed';
    if (status === 404 && (lower.includes('model_not_found') || lower.includes('does not exist') || lower.includes('model'))) {
      return 'model_not_found';
    }
    if (
      lower.includes('insufficient_quota') ||
      lower.includes('billing_hard_limit_reached') ||
      lower.includes('exceeded your current quota') ||
      lower.includes('billing_not_active')
    ) {
      return 'billing_error';
    }
    if (lower.includes('account_deactivated') || lower.includes('organization_deactivated')) {
      return 'organization_disabled';
    }
    if (status === 403) {
      if (lower.includes('model_not_found') || lower.includes('does not have access to model')) {
        return 'model_not_found';
      }
      return 'oauth_org_not_allowed';
    }
    return null;
  }

  if (provider === 'google') {
    if (status === 401) return 'authentication_failed';
    if (
      status === 400 &&
      (lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('api key expired'))
    ) {
      return 'authentication_failed';
    }
    if (
      (status === 429 || status === 403) &&
      (lower.includes('billing') ||
        lower.includes('quota exceeded') ||
        lower.includes('exceeded your current quota') ||
        lower.includes('free_tier') ||
        lower.includes('limit: 0'))
    ) {
      return 'billing_error';
    }
    if (status === 403) return 'oauth_org_not_allowed';
    if (status === 404 && (lower.includes('not_found') || lower.includes('is not found') || lower.includes('models/'))) {
      return 'model_not_found';
    }
    return null;
  }

  // Anthropic direct REST
  if (status === 401) return 'authentication_failed';
  if (status === 403) {
    if (lower.includes('disabled api key authentication')) return 'api_key_auth_disabled';
    return 'oauth_org_not_allowed';
  }
  if (status === 404 && (lower.includes('not_found') || lower.includes('model'))) return 'model_not_found';
  if (status === 400 && (lower.includes('credit balance is too low') || lower.includes('billing'))) {
    return 'billing_error';
  }
  if (status === 400 && lower.includes('disabled organization')) return 'organization_disabled';
  return null;
}

export function modelNamedIn(text: string | undefined): string | null {
  const m =
    text?.match(/selected model \(([^)\s]+)\)/) ??
    text?.match(/The model [`'"]?([^\s`'"]+)[`'"]? (?:is not available|does not exist)/i) ??
    text?.match(/models\/([^\s:,"')]+) is not found/i);
  return m?.[1] ?? null;
}

const REJECTED_TAIL = "so it stopped — the deployment's own key is never used in its place.";

export function orgKeyRejected(
  rejection: KeyRejection,
  model: string,
  usage?: SessionTokenUsage,
  provider: ResearchProvider = 'anthropic',
): OrgKeyUnavailableError {
  const shortModel = model.slice(0, 60);
  const { displayName, consoleName } = PROVIDER_META[provider];
  const messages: Record<KeyRejection, string> =
    provider === 'anthropic'
      ? {
          authentication_failed: `Anthropic rejected this organization's own API key (it may have been revoked, expired or mistyped), ${REJECTED_TAIL} An organization owner can enter a working key under Billing, then start this again.`,
          billing_error: `Anthropic reported a billing problem on the account behind this organization's own API key (usually no credit left), ${REJECTED_TAIL} An organization owner can add credit in the Anthropic Console, or enter another key under Billing, then start this again.`,
          model_not_found: `Anthropic did not find the model this needs (${shortModel}) for this organization's own API key (the key may not allow it, or the model setting is wrong), ${REJECTED_TAIL} An organization owner can allow it in the Anthropic Console, or ask the operator to check the setting, then start this again.`,
          oauth_org_not_allowed: `Anthropic does not allow this organization's own API key to be used this way (its Anthropic organization's settings refuse it), ${REJECTED_TAIL} An organization owner can check those settings in the Anthropic Console, or enter another key under Billing, then start this again.`,
          organization_disabled: `Anthropic reports that the Anthropic organization behind this organization's own API key has been disabled, ${REJECTED_TAIL} An organization owner can resolve that with Anthropic, or enter a key from another Anthropic organization under Billing, then start this again.`,
          api_key_auth_disabled: `The Anthropic organization behind this organization's own API key has turned off API key access, ${REJECTED_TAIL} An organization owner can allow API keys in that organization's Anthropic Console settings, or enter another key under Billing, then start this again.`,
        }
      : {
          authentication_failed: `${displayName} rejected this organization's own API key (it may have been revoked, expired or mistyped), ${REJECTED_TAIL} An organization owner can enter a working key under Billing, then start this again.`,
          billing_error: `${displayName} reported a billing or quota problem on the account behind this organization's own API key, ${REJECTED_TAIL} An organization owner can add credit in ${consoleName}, or enter another key under Billing, then start this again.`,
          model_not_found: `${displayName} did not find the model this needs (${shortModel}) for this organization's own API key (the key may not allow it, or the model setting is wrong), ${REJECTED_TAIL} An organization owner can allow it in ${consoleName}, or ask the operator to check the setting, then start this again.`,
          oauth_org_not_allowed: `${displayName} does not allow this organization's own API key to be used this way, ${REJECTED_TAIL} An organization owner can check permissions in ${consoleName}, or enter another key under Billing, then start this again.`,
          organization_disabled: `${displayName} reports that the account behind this organization's own API key has been disabled, ${REJECTED_TAIL} An organization owner can resolve that in ${consoleName}, or enter another key under Billing, then start this again.`,
          api_key_auth_disabled: `${displayName} has disabled API key access for the account behind this organization's own API key, ${REJECTED_TAIL} An organization owner can enable API keys in ${consoleName}, or enter another key under Billing, then start this again.`,
        };
  return new OrgKeyUnavailableError(messages[rejection], {
    ...(usage ? { usage } : {}),
    rejection,
    model,
    provider,
  });
}

export function rejectedKeyError(
  report: { apiError?: string; apiErrorText?: string },
  model: string,
  usage?: SessionTokenUsage,
  provider: ResearchProvider = 'anthropic',
): OrgKeyUnavailableError | null {
  const rejection = keyRejection(report.apiError, report.apiErrorText);
  if (!rejection) return null;
  const named = rejection === 'model_not_found' ? modelNamedIn(report.apiErrorText) : null;
  return orgKeyRejected(rejection, named ?? model, usage, provider);
}

export function modelNotFoundLog(
  model: string,
  onOrganizationKey: boolean,
  provider: ResearchProvider = 'anthropic',
): string {
  const whose = onOrganizationKey ? "the organization's own API key" : "the deployment's API key";
  const displayName = PROVIDER_META[provider].displayName;
  return `${displayName} reported model_not_found for model "${model.slice(0, 80)}" on ${whose}: check that ANTHROPIC_MODEL / VERIFIER_MODEL name a valid model id${onOrganizationKey ? ", or that the key's workspace may use it" : ''}`;
}

/**
 * The plaintext key of the organization holding `tenantId` for `provider`
 * (default `'anthropic'`), or null when none is on file. Throws
 * `OrgKeyUnavailableError` when a key is on file but cannot be decrypted.
 *
 * Ciphertext is bound to `${organizationId}:${provider}` (with automatic
 * backward-compatible fallback to legacy `organizationId`-only binding for
 * pre-0028 Anthropic rows).
 */
export async function orgApiKeyForTenant(
  db: DbExecutor,
  tenantId: string,
  rawSecretsKey: string | undefined = process.env.DF_SECRETS_KEY,
  provider: ResearchProvider = 'anthropic',
): Promise<string | null> {
  const [row] = await db
    .select({
      organizationId: organizationApiKeys.organizationId,
      ciphertext: organizationApiKeys.ciphertext,
    })
    .from(organizationApiKeys)
    .innerJoin(tenants, eq(tenants.organizationId, organizationApiKeys.organizationId))
    .where(and(eq(tenants.id, tenantId), eq(organizationApiKeys.provider, provider)));
  if (!row) return null;

  let secretsKey: Uint8Array;
  try {
    secretsKey = parseSecretsKey(rawSecretsKey);
  } catch (err) {
    if (err instanceof SecretsKeyError) {
      throw new OrgKeyUnavailableError(orgKeyNoSecretsKeyMessage(provider), { provider });
    }
    throw err;
  }
  try {
    return await decryptSecret(row.ciphertext, secretsKey, `${row.organizationId}:${provider}`);
  } catch (err) {
    if (err instanceof SecretDecryptError && provider === 'anthropic') {
      try {
        return await decryptSecret(row.ciphertext, secretsKey, row.organizationId);
      } catch (legacyErr) {
        if (legacyErr instanceof SecretDecryptError) {
          throw new OrgKeyUnavailableError(orgKeyUnreadableMessage(provider), { provider });
        }
        throw legacyErr;
      }
    }
    if (err instanceof SecretDecryptError) {
      throw new OrgKeyUnavailableError(orgKeyUnreadableMessage(provider), { provider });
    }
    throw err;
  }
}

/**
 * The key a run's or analysis's sessions use for `provider` (default `'anthropic'`):
 * - `'plan'`: returns `null`, so sessions run on the deployment's env key for `provider`.
 * - `'organization_key'`: decrypts the organization's stored key for `provider`,
 *   throwing `OrgKeyUnavailableError` if missing or unreadable (never falls back to
 *   the deployment's key).
 */
export async function sessionApiKey(
  db: DbExecutor,
  tenantId: string,
  funding: ResearchFunding,
  rawSecretsKey: string | undefined = process.env.DF_SECRETS_KEY,
  provider: ResearchProvider = 'anthropic',
): Promise<string | null> {
  if (funding === 'plan') return null;
  const apiKey = await orgApiKeyForTenant(db, tenantId, rawSecretsKey, provider);
  if (apiKey === null) {
    throw new OrgKeyUnavailableError(orgKeyRemovedMessage(provider), { provider });
  }
  return apiKey;
}
