/**
 * Pure verdicts for the production preflight (scripts/preflight.ts): the
 * checks an operator runs against the live providers after deploying. Kept
 * here, separate from the network calls, so each verdict is unit-tested.
 */

import { emergencyConfigSchema } from './emergency.js';
import { parseDisabledFeatures, resolvePortraitFeatures, unknownDisabledFeaturesMessage, type Feature } from './features.js';

export type Verdict = { status: 'pass' | 'fail' | 'warn'; detail: string };

/**
 * The deployment's kill switch (DF_DISABLED_FEATURES): a name it does not know
 * switches nothing off, so it is a warning that names the valid keys; the
 * rest is reported so the operator sees what is off.
 */
export function disabledFeaturesVerdict(raw: string | undefined | null): Verdict {
  const unknown = unknownDisabledFeaturesMessage(raw);
  if (unknown) return { status: 'warn', detail: unknown };
  const { disabled } = parseDisabledFeatures(raw);
  return {
    status: 'pass',
    detail: disabled.size ? `off for the whole deployment: ${[...disabled].join(', ')}` : 'no feature is off for the whole deployment',
  };
}

/**
 * Organizations' own Anthropic API keys (SPEC-v7 §4) are stored encrypted
 * under DF_SECRETS_KEY. With keys on file and the secret unset — lost in a
 * restore, or removed — those organizations' research is refused (the web
 * app's gate) and nothing falls back to the deployment's key, so the operator
 * hears it here rather than from the organizations.
 */
export function storedApiKeysVerdict(keysOnFile: number, secretsKeySet: boolean): Verdict {
  if (keysOnFile === 0) return { status: 'pass', detail: 'no organization has its own API key on file' };
  const orgs = `${keysOnFile} organization(s) have their own Anthropic API key on file`;
  return secretsKeySet
    ? { status: 'pass', detail: `${orgs}; DF_SECRETS_KEY is set` }
    : {
        status: 'warn',
        detail: `${orgs} but DF_SECRETS_KEY is not set: their research is refused until it is set again (or they remove the key)`,
      };
}

/**
 * Which portraits' NWS alerts the preflight checks: those the worker polls —
 * the emergency view on (the portrait's setting, under the deployment's kill
 * switch, resolved as the worker resolves it) and zones configured. A portrait
 * with the view off is left out entirely: the worker never fetches its alerts,
 * and its emergency settings page is a 404, so neither a failing feed nor an
 * invalid config there is anything to fix before onboarding.
 */
export function alertCheckTargets(
  rows: readonly { slug: string; emergency: unknown; features: unknown }[],
  disabled: ReadonlySet<Feature>,
): { portraits: { slug: string; zones: string[] }[]; invalid: string[] } {
  const portraits: { slug: string; zones: string[] }[] = [];
  const invalid: string[] = [];
  for (const r of rows) {
    if (!resolvePortraitFeatures(r.features as Record<string, unknown> | null, disabled).emergency) continue;
    const parsed = emergencyConfigSchema.safeParse(r.emergency);
    if (!parsed.success) invalid.push(r.slug);
    else if (parsed.data.nws_zones.length) portraits.push({ slug: r.slug, zones: parsed.data.nws_zones });
  }
  return { portraits, invalid };
}

/**
 * OAuth client credentials, checked without a user. Two probes, because
 * providers validate in different orders:
 *
 * - `invalid-code` (Google): redeem a deliberately invalid authorization
 *   code. Google authenticates the client first, so a valid client gets
 *   `invalid_grant` (bad code) and a wrong id/secret gets `invalid_client`.
 * - `client-credentials` (Microsoft Entra): Entra rejects a malformed code
 *   (AADSTS9002313) before it looks at the client — a fake client id would
 *   pass the first probe — so request an app-only token from the city's own
 *   tenant instead. A valid id and secret receive a token with no
 *   permissions (discarded); a wrong secret is `invalid_client`
 *   (AADSTS7000215), an unknown app `unauthorized_client` (AADSTS700016).
 */
export type CredentialProbe = 'invalid-code' | 'client-credentials';

export function oauthCredentialVerdict(probe: CredentialProbe, status: number, body: unknown): Verdict {
  const res = (body && typeof body === 'object' ? (body as Record<string, unknown>) : {}) as {
    error?: string;
    error_description?: string;
    access_token?: string;
  };
  const description = String(res.error_description ?? '').split('\n')[0]!.slice(0, 160);
  if (res.error === 'invalid_client' || res.error === 'unauthorized_client') {
    return { status: 'fail', detail: `client credentials rejected: ${res.error} ${description}`.trim() };
  }
  if (res.error === 'redirect_uri_mismatch') {
    return { status: 'fail', detail: 'redirect URI not registered for this client (see docs/deploy.md §2)' };
  }
  if (probe === 'invalid-code' && res.error === 'invalid_grant') {
    return { status: 'pass', detail: 'client id and secret accepted (test code rejected as expected)' };
  }
  if (probe === 'client-credentials' && status === 200 && typeof res.access_token === 'string') {
    return { status: 'pass', detail: 'client id and secret accepted (permissionless app token discarded)' };
  }
  return {
    status: 'warn',
    detail: `could not confirm the credentials (HTTP ${status}): ${res.error ?? 'no error field'} ${description}`.trim(),
  };
}

/** Every catalog lookup key must have an active, non-zero price — nothing is sold at a placeholder. */
export function stripeCatalogVerdict(
  lookupKeys: readonly string[],
  prices: readonly { lookup_key: string | null; active: boolean; unit_amount: number | null }[],
): Verdict {
  const problems: string[] = [];
  for (const key of lookupKeys) {
    const price = prices.find((p) => p.lookup_key === key && p.active);
    if (!price) problems.push(`${key}: no active price`);
    else if (!price.unit_amount) problems.push(`${key}: amount is 0`);
  }
  return problems.length
    ? { status: 'fail', detail: `${problems.join('; ')} — run pnpm stripe:setup with the real price sheet` }
    : { status: 'pass', detail: `${lookupKeys.length} catalog prices active` };
}

/** The webhook must point at this deployment and listen for every event the handler syncs. */
export function stripeWebhookVerdict(
  url: string,
  required: readonly string[],
  endpoints: readonly { url: string; status: string; enabled_events: string[] }[],
): Verdict {
  const endpoint = endpoints.find((e) => e.url === url);
  if (!endpoint) return { status: 'fail', detail: `no webhook endpoint for ${url} — run pnpm stripe:setup --webhook-url ${url}` };
  if (endpoint.status !== 'enabled') return { status: 'fail', detail: `webhook for ${url} is ${endpoint.status}` };
  const all = endpoint.enabled_events.includes('*');
  const missing = all ? [] : required.filter((e) => !endpoint.enabled_events.includes(e));
  return missing.length
    ? { status: 'fail', detail: `webhook missing events: ${missing.join(', ')}` }
    : { status: 'pass', detail: `webhook enabled for ${url}` };
}
