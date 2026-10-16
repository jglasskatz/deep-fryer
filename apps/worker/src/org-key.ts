import { eq } from 'drizzle-orm';
import {
  SecretDecryptError,
  SecretsKeyError,
  decryptSecret,
  parseSecretsKey,
} from '@deep-fryer/core/secrets';
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
 */
export class OrgKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgKeyUnavailableError';
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
