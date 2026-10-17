'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { encryptSecret, keyHint, parseSecretsKey, SecretsKeyError } from '@deep-fryer/core/secrets';
import {
  deleteOrganizationApiKey,
  organizationApiKeyInfo,
  organizationBySlug,
  tenants,
  upsertOrganizationApiKey,
  type DbExecutor,
  type Organization,
} from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { getAuth, requireOrgRole } from './auth';
import { validateAnthropicKey } from './anthropic-key';
import { contactSentence } from './billing';
import { systemDb, userDb } from './db';
import { secretsKey } from './env';

/**
 * An organization's own Anthropic API key (SPEC-v7 §4): owners add,
 * replace, and remove it from the billing page. While it is on file, the
 * organization's research and policy sessions run on it and are not checked
 * against the plan's session allowance (packages/db billing
 * gateResearchSpend); the worker decrypts it into those sessions' subprocess
 * environment (apps/worker/src/org-key.ts).
 *
 * The key's path through here, and where it never goes:
 * - in: the form posts it once; it is trimmed, checked for form, and
 *   validated with one Models API call (lib/anthropic-key.ts);
 * - stored: only as AES-256-GCM ciphertext under DF_SECRETS_KEY, bound to
 *   the organization's id, plus its last four characters as a hint;
 * - never: returned to the client, put in revalidated page data (the page
 *   reads the hint and dates only — the app role cannot even select the
 *   ciphertext), logged, or written to the audit trail (which records the
 *   hint).
 *
 * Owners only — not billing contacts — because the key spends money on an
 * Anthropic account and its holder decides where research runs. The write
 * goes through userDb, so row-level security (is_org_owner, migration 0011)
 * enforces the same rule as requireOrgRole.
 */

/**
 * Why a key cannot be saved on this server, for the owner who tried. The
 * owner cannot fix it and the setting means nothing to them, so the message
 * names no setting: the server log does (encryptionKey), for the operator.
 */
const keysNotStorable = () =>
  `This server isn’t set up to store organization keys. ${contactSentence()} Research can still run on your plan.`;

async function orgForOwner(orgSlug: string): Promise<Organization> {
  const org = await organizationBySlug(systemDb(), orgSlug);
  if (!org) throw new UserError('Unknown organization.');
  try {
    await requireOrgRole(org.id, ['owner']);
  } catch (err) {
    // requireOrgRole's own message names the billing role too, which is
    // allowed for the rest of the billing page but not for the key.
    if (err instanceof UserError) {
      throw new UserError('Only an organization owner can add, replace, or remove its Anthropic API key.');
    }
    throw err;
  }
  return org;
}

/** DF_SECRETS_KEY as key material, or a UserError the owner can act on (and the setting's name in the log). */
function encryptionKey(): Uint8Array {
  const raw = secretsKey();
  if (!raw) {
    console.warn('[api-key] an owner tried to save a key, but DF_SECRETS_KEY is not set (docs/deploy.md)');
    throw new UserError(keysNotStorable());
  }
  try {
    return parseSecretsKey(raw);
  } catch (err) {
    if (err instanceof SecretsKeyError) {
      console.error('[api-key] DF_SECRETS_KEY is not a valid 32-byte base64 key (docs/deploy.md); keys cannot be saved');
      throw new UserError(keysNotStorable());
    }
    throw err;
  }
}

/**
 * Record a key change on every portrait the organization holds. The audit
 * trail is per portrait (audit_log.tenant_id), and the key decides how each
 * of them is researched, so each portrait's history shows the change. Only
 * the hint and dates are recorded — never the key or its ciphertext.
 */
async function auditKeyChange(
  db: DbExecutor,
  org: Organization,
  action: 'save' | 'replace' | 'remove',
  before: { key_hint: string } | null,
  after: { key_hint: string; provider: string; validated_at: string } | null,
): Promise<void> {
  const portraits = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, org.id));
  for (const portrait of portraits) {
    await audit(portrait.id, 'organization_api_key', org.id, action, before, after, db);
  }
}

/**
 * Validate, encrypt, and store (or replace) the organization's key. Returns
 * only what the page may show: the hint and when it was validated.
 */
export const saveApiKey = action(async (orgSlug: string, apiKey: string) => {
  const org = await orgForOwner(orgSlug);
  // Before anything reaches Anthropic: without DF_SECRETS_KEY nothing could be stored.
  const keyMaterial = encryptionKey();
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  await validateAnthropicKey(key);

  const validatedAt = new Date();
  const ciphertext = await encryptSecret(key, keyMaterial, org.id);
  const hint = keyHint(key);
  const auth = await getAuth();
  await userDb(async (db) => {
    const previous = await organizationApiKeyInfo(db, org.id);
    await upsertOrganizationApiKey(db, {
      organizationId: org.id,
      ciphertext,
      keyHint: hint,
      createdBy: auth.userId,
      validatedAt,
    });
    await auditKeyChange(
      db,
      org,
      previous ? 'replace' : 'save',
      previous ? { key_hint: previous.keyHint } : null,
      { key_hint: hint, provider: 'anthropic', validated_at: validatedAt.toISOString() },
    );
  });

  revalidatePath(`/o/${org.slug}/billing`);
  revalidatePath('/start');
  return { keyHint: hint, validatedAt: validatedAt.toISOString() };
});

/**
 * Remove the organization's key at once. Research applied from now on is
 * checked against the plan's allowance and runs on the deployment's key; a
 * run the worker has already started keeps the key it started with. Work the
 * gate put on the key that has not started yet fails when the worker reaches
 * it (apps/worker org-key.ts ORG_KEY_REMOVED) — it never moves onto the
 * deployment's key, because it was never checked against the allowance.
 */
export const removeApiKey = action(async (orgSlug: string) => {
  const org = await orgForOwner(orgSlug);
  const removed = await userDb(async (db) => {
    const hint = await deleteOrganizationApiKey(db, org.id);
    if (hint !== null) await auditKeyChange(db, org, 'remove', { key_hint: hint }, null);
    return hint;
  });
  if (removed === null) throw new UserError('There is no API key on file for this organization.');

  revalidatePath(`/o/${org.slug}/billing`);
  revalidatePath('/start');
  return { removed: true };
});
