/**
 * Pure verdicts for the production preflight (scripts/preflight.ts): the
 * checks an operator runs against the live providers after deploying. Kept
 * here, separate from the network calls, so each verdict is unit-tested.
 */

import type { Env } from './deploy-env.js';
import { emergencyConfigSchema } from './emergency.js';
import { parseDisabledFeatures, resolvePortraitFeatures, unknownDisabledFeaturesMessage, type Feature } from './features.js';
import { SLUG_RE } from './slugs.js';

export type Verdict = { status: 'pass' | 'fail' | 'warn'; detail: string };

/**
 * An error as one line for the preflight table, its cause chain included.
 * Node's fetch reports every network failure as just "fetch failed" and keeps
 * the reason — a refused connection, a name that does not resolve, a
 * certificate this container does not trust — in `err.cause` (sometimes one
 * level deeper, or as an AggregateError with an empty message when every
 * address of a host refused). That reason is the only thing the operator can
 * act on, so each link contributes its first message line and its code, once.
 */
export function errorDetail(err: unknown, max = 220): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth++) {
    if (typeof current !== 'object') {
      parts.push(String(current));
      break;
    }
    const e = current as { code?: unknown; message?: unknown; errors?: unknown; cause?: unknown };
    const firstLine = (m: unknown) => (typeof m === 'string' ? m.split('\n')[0]!.trim() : '');
    let message = firstLine(e.message);
    if (!message && Array.isArray(e.errors)) {
      message = [...new Set(e.errors.map((x) => firstLine((x as { message?: unknown })?.message) || String(x)))].join('; ');
    }
    const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';
    const part = code && !message.includes(code) ? (message ? `${message} (${code})` : code) : message;
    if (part && !parts.includes(part)) parts.push(part);
    current = e.cause;
  }
  const line = parts.join(': ') || 'unknown error';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The domain of a bare address or of a "Name <address>" mailbox, lower-cased; null when there is none. */
export function addressDomain(raw: string): string | null {
  const address = /<([^<>]*)>\s*$/.exec(raw)?.[1] ?? raw;
  const at = address.lastIndexOf('@');
  const domain = at >= 0 ? address.slice(at + 1).trim().toLowerCase().replace(/\.$/, '') : '';
  return domain || null;
}

/**
 * Placeholder domains: any domain with an `example` label (the reserved
 * example.com/.net/.org and *.example, example.gov as .env.example ships it,
 * mail.example.org) and the reserved test TLDs (RFC 2606, RFC 6761). A
 * placeholder copied from .env.example passes every format check, so it is
 * caught by name; a real city whose name merely contains "example"
 * (cityofexample.gov) is not.
 */
function isPlaceholderDomain(domain: string): boolean {
  const labels = domain.split('.');
  return labels.includes('example') || ['test', 'invalid', 'localhost'].includes(labels.at(-1)!);
}

/** A bare address, as a mailto: link needs it: one @, a dotted domain, no display name or brackets. */
const PLAIN_ADDRESS = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/**
 * EMAIL_FROM and SUPPORT_EMAIL as the outside world will see them. Both
 * pass the boot rules with a placeholder still in them, and neither failure
 * shows on the server: mail from a domain whose SPF/DKIM do not cover the
 * relay is refused or filtered as spam at the recipient, and a placeholder
 * support address sends every stuck customer nowhere. So these are warnings
 * the operator sees before launch. A display name in SUPPORT_EMAIL is
 * warned about too: pages turn it into a mailto: link.
 */
export function contactAddressesVerdict(env: Env): Verdict {
  const from = env.EMAIL_FROM?.trim();
  const support = env.SUPPORT_EMAIL?.trim();
  const fromDomain = from ? addressDomain(from) : null;
  const supportDomain = support ? addressDomain(support) : null;
  const problems: string[] = [];
  if (fromDomain && isPlaceholderDomain(fromDomain)) {
    problems.push(
      `EMAIL_FROM is on ${fromDomain}, a placeholder domain: mail from it is refused or lands in spam — use an address on a domain your SMTP relay may send for (its SPF and DKIM records)`,
    );
  }
  if (support && !PLAIN_ADDRESS.test(support)) {
    problems.push('SUPPORT_EMAIL should be a plain address such as help@yourcity.gov (no name or angle brackets): pages link it as mailto:');
  } else if (supportDomain && isPlaceholderDomain(supportDomain)) {
    problems.push(`SUPPORT_EMAIL is on ${supportDomain}, a placeholder domain: the footer and error pages would send people to an address nobody reads`);
  }
  if (problems.length) return { status: 'warn', detail: problems.join('; ') };
  const shown = [fromDomain && `sender on ${fromDomain}`, supportDomain && `support on ${supportDomain}`].filter(Boolean);
  return { status: 'pass', detail: shown.length ? shown.join(', ') : 'no sender or support address set' };
}

/**
 * Whether SMTP_URL carries a login (smtps://user:pass@relay:465).
 * nodemailer's verify() authenticates only when it has one; without one, a
 * successful verify proves only that the relay answered.
 */
export function smtpLoginConfigured(smtpUrl: string): boolean {
  try {
    return new URL(smtpUrl).username !== '';
  } catch {
    return false;
  }
}

/**
 * What a successful verify() of SMTP_URL proves. With a login it is the
 * relay accepting our credentials; without one it is only a connection, and
 * whether the relay will take mail from this server unauthenticated (some
 * internal relays trust the sender's address) shows only when a message is
 * sent, so the operator is told to send one.
 */
export function smtpVerifiedVerdict(smtpUrl: string, emailFrom: string | undefined): Verdict {
  const from = emailFrom?.trim() || 'EMAIL_FROM unset';
  return smtpLoginConfigured(smtpUrl)
    ? { status: 'pass', detail: `connected and authenticated (${from})` }
    : {
        status: 'warn',
        detail: `connected, but SMTP_URL has no login configured: mail goes out only if the relay accepts this server without one — send yourself a sign-in link to confirm (${from})`,
      };
}

/**
 * The model ids compose gives the worker when .env leaves them unset or
 * blank (docker-compose.yml x-research-env; docs/deploy.md "Models"). The
 * ops shell gets the same block, so the preflight checks exactly what the
 * worker runs; these fallbacks only matter when the preflight runs outside
 * compose.
 */
export const RESEARCH_MODEL_DEFAULTS = {
  ANTHROPIC_MODEL: 'claude-sonnet-5',
  VERIFIER_MODEL: 'claude-opus-5',
  ANTHROPIC_SMALL_FAST_MODEL: 'claude-haiku-4-5-20251001',
} as const;

export type ResearchModel = {
  /** What the model does in a research run, as docs/deploy.md "Models" names it. */
  role: string;
  variable: string;
  model: string;
  /** The variable is unset or blank, so the model is compose's default. */
  fromDefault: boolean;
};

/**
 * Every model a research run can call on the deployment's key: the
 * researcher, the verifier and the page reader always, the scouts only when
 * RESEARCH_SUBAGENT_MODEL is set (empty means scouts off).
 */
export function researchModels(env: Env): ResearchModel[] {
  const configured = (variable: keyof typeof RESEARCH_MODEL_DEFAULTS, role: string): ResearchModel => {
    const value = env[variable]?.trim();
    return { role, variable, model: value || RESEARCH_MODEL_DEFAULTS[variable], fromDefault: !value };
  };
  const models = [
    configured('ANTHROPIC_MODEL', 'researcher'),
    configured('VERIFIER_MODEL', 'verifier'),
    configured('ANTHROPIC_SMALL_FAST_MODEL', 'page reader'),
  ];
  const scouts = env.RESEARCH_SUBAGENT_MODEL?.trim();
  if (scouts) models.push({ role: 'scouts', variable: 'RESEARCH_SUBAGENT_MODEL', model: scouts, fromDefault: false });
  return models;
}

/**
 * The id to ask the Models API about, or null for a value the Claude Code
 * CLI resolves by itself — an alias such as `sonnet`, which the API does not
 * know and which an SDK update may point at another model. A context-window
 * suffix (`claude-sonnet-5[1m]`) is the CLI's, not part of the id.
 */
export function modelLookupId(model: string): string | null {
  const id = model.trim().replace(/\[[^\]]*\]$/, '');
  return id.startsWith('claude-') ? id : null;
}

/**
 * A model setting that is an alias, not an id: the Models API cannot check
 * it, and the CLI decides what it means, so an SDK update can move it to
 * another model without anyone deciding to — the reason the page reader is
 * pinned (docs/deploy.md "Models").
 */
export function modelAliasVerdict(m: ResearchModel): Verdict {
  return {
    status: 'warn',
    detail: `${m.variable}=${m.model} is a Claude Code alias, not a model id: not checked, and an SDK update can change what it means — pin an id (docs/deploy.md "Models")`,
  };
}

/**
 * One configured model, judged from the Models API's answer for it
 * (GET /v1/models/{id} with the deployment's key: free, and the same
 * account, workspace and model access the worker's sessions get). 401 is the
 * key itself, 403 the key's workspace not allowed the model, 404 an id that
 * does not exist for this key — each with the one change that fixes it.
 * Anything else (rate limits, overload) cannot tell either way.
 */
export function anthropicModelVerdict(m: ResearchModel, status: number, body: unknown): Verdict {
  const b = (body && typeof body === 'object' ? body : {}) as { id?: unknown; error?: { type?: unknown; message?: unknown } };
  const type = typeof b.error?.type === 'string' ? b.error.type : '';
  const message = typeof b.error?.message === 'string' ? b.error.message.split('\n')[0]!.slice(0, 160) : '';
  const said = [`HTTP ${status}`, type, message].filter(Boolean).join(' ');
  if (status === 200) {
    const resolved = typeof b.id === 'string' && b.id !== m.model ? ` (as ${b.id})` : '';
    return { status: 'pass', detail: `${m.model}${resolved} available to the deployment's key` };
  }
  if (status === 401) {
    return {
      status: 'fail',
      detail: `ANTHROPIC_API_KEY was refused (${said}): it is mistyped, revoked or disabled — create a key in the Anthropic Console, put it in .env, then docker compose up -d worker web`,
    };
  }
  const fix = m.fromDefault
    ? `set ${m.variable} in .env to a model id this key can use`
    : m.variable === 'RESEARCH_SUBAGENT_MODEL'
      ? `correct ${m.variable} in .env, or empty it to turn scouts off`
      : `correct ${m.variable} in .env, or remove it to use the default (${RESEARCH_MODEL_DEFAULTS[m.variable as keyof typeof RESEARCH_MODEL_DEFAULTS]})`;
  if (status === 403) {
    return {
      status: 'fail',
      detail: `the key may not use ${m.model} (${said}): allow the model for the key's workspace in the Anthropic Console, or ${fix}; then docker compose up -d worker`,
    };
  }
  if (status === 404) {
    return { status: 'fail', detail: `${m.model} does not exist for this key (${said}): ${fix}; then docker compose up -d worker` };
  }
  return { status: 'warn', detail: `could not confirm ${m.model} (${said}): run the preflight again shortly` };
}

/**
 * No deployment key. Research the plan pays for — every build an
 * organization without its own key starts — is then refused before any
 * spend (the web app learns this from compose's DF_RESEARCH_KEY_CONFIGURED),
 * which suits only a deployment where every organization brings its own key.
 */
export function researchKeyMissingVerdict(): Verdict {
  return {
    status: 'warn',
    detail:
      'not set: plan-funded research is off (only organizations with their own key can build) — set ANTHROPIC_API_KEY in .env, then docker compose up -d worker web',
  };
}

/**
 * Portraits marked as seeded sample data (core SAMPLE_DATA_CONFIG_KEY, set by
 * scripts/seed-demo-data.ts). Every page of theirs says "Sample data — not
 * research", which is right on a demo stack and wrong in production: a
 * demo database is never promoted to production.
 */
export function sampleDataVerdict(slugs: readonly string[]): Verdict {
  if (slugs.length === 0) return { status: 'pass', detail: 'no portrait is marked as sample data' };
  const named = slugs.slice(0, 6).join(', ') + (slugs.length > 6 ? ', …' : '');
  return {
    status: 'warn',
    detail: `${slugs.length} portrait(s) hold seeded sample data (${named}), labeled "Sample data — not research": never promote a demo database — production starts from an empty one`,
  };
}

/** DF_SHOWCASE_ORG as the landing page reads it (trimmed, lower-cased, a well-formed slug), or null. */
export function showcaseSlug(raw: string | undefined): string | null {
  const slug = raw?.trim().toLowerCase();
  return slug && SLUG_RE.test(slug) ? slug : null;
}

/**
 * The landing page's showcase. It appears only for an organization with a
 * public portrait (one that has published), and silently not otherwise, so
 * a typo or a showcase that has not published yet is reported here rather
 * than discovered by its absence. `facts` is null when the value is not a
 * slug (nothing to look up).
 */
export function showcaseVerdict(
  raw: string | undefined,
  facts: { organization: boolean; publicPortraits: number } | null,
): Verdict {
  const value = raw?.trim();
  if (!value) return { status: 'pass', detail: 'not set: the landing page lists the public portraits, with no showcase' };
  const slug = showcaseSlug(value);
  if (!slug || !facts) return { status: 'warn', detail: `"${value}" is not an organization slug: the landing page shows no showcase` };
  if (!facts.organization) {
    return { status: 'warn', detail: `no organization "${slug}" (the slug in /o/<slug>): the landing page shows no showcase` };
  }
  if (facts.publicPortraits === 0) {
    return {
      status: 'warn',
      detail: `organization "${slug}" has no public portrait yet (a portrait becomes public when it first publishes): no showcase until then`,
    };
  }
  return { status: 'pass', detail: `organization "${slug}": ${facts.publicPortraits} public portrait(s) showcased` };
}

/** TERMS_URL when it is an absolute http(s) URL — the only kind the footer links — else null. */
export function termsUrlToCheck(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && /^https?:\/\/[^/\s]+/i.test(value) ? value : null;
}

/**
 * TERMS_URL, the footer's Terms link. Unset is allowed (no link) but worth
 * a warning before a public launch; a value that is not an http(s) URL is
 * dropped by the footer; one that does not answer would be a dead link on
 * every page. `status` is the answer to a GET, or null when none was made.
 */
export function termsUrlVerdict(raw: string | undefined, status: number | null): Verdict {
  const value = raw?.trim();
  if (!value) return { status: 'warn', detail: 'not set: the footer has no Terms link — publish your terms of use and set TERMS_URL before a public launch' };
  if (!termsUrlToCheck(value)) {
    return { status: 'warn', detail: `"${value.slice(0, 80)}" is not an http(s) URL: the footer leaves the Terms link out` };
  }
  if (status === null) return { status: 'warn', detail: `${value} was not checked` };
  return status >= 200 && status < 300
    ? { status: 'pass', detail: `${value} answers ${status}` }
    : { status: 'warn', detail: `${value} answered ${status}: the footer's Terms link would not open` };
}

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
 * What the preflight reads about the row-level-security role (SPEC-v4 §6).
 * The privilege fields are null when the object they ask about does not
 * exist, since Postgres refuses to evaluate a privilege on a missing role or
 * function.
 */
export type AppRoleFacts = {
  /** deep_fryer_app exists (migration 0005). */
  exists: boolean;
  bypass: boolean | null;
  /** The connecting user may SET ROLE deep_fryer_app. */
  member: boolean | null;
  /** deep_fryer_app may read tenants: 0005's table grants are in place. */
  readsTenants: boolean | null;
  /** The restrictive research_runs_app_insert_planned policy exists (0013). */
  insertGuard: boolean;
  /** PUBLIC may execute lock_tenant_owners (0014 revokes it); null when the function is missing. */
  ownerLockPublic: boolean | null;
};

/**
 * The role every user-driven query runs as. Its existence alone proves
 * little: pg_dump carries no roles, so restoring a dump into a cluster
 * without deep_fryer_app drops every object the dump ties to the role — its
 * grants, the restrictive research_runs insert policy, and the REVOKE that
 * keeps lock_tenant_owners from PUBLIC (restored in the same entry as its
 * GRANT) — while the migration journal comes back complete, so migrate
 * re-creates none of them. Creating the role afterwards then passes an
 * existence check while every portrait page is a 500 (permission denied for
 * table tenants). Each of those losses is checked here by name, and the fix
 * names the only repair: restore again into a fresh database after creating
 * the roles (docs/deploy.md §6, Restore).
 */
export function appRoleVerdict(f: AppRoleFacts): Verdict {
  const restoreFix = 'create the roles and restore again into a fresh database (docs/deploy.md §6, Restore)';
  if (!f.exists) {
    return { status: 'fail', detail: `role deep_fryer_app missing: migration 0005 creates it, a pg_dump restore does not — ${restoreFix}` };
  }
  if (f.bypass) return { status: 'fail', detail: 'deep_fryer_app has BYPASSRLS — policies would not apply' };
  if (!f.member) return { status: 'fail', detail: 'the connecting user cannot SET ROLE deep_fryer_app' };
  const lost = [
    !f.readsTenants && 'deep_fryer_app cannot read tenants (its grants are missing)',
    !f.insertGuard && 'policy research_runs_app_insert_planned missing',
    f.ownerLockPublic === null && 'function lock_tenant_owners missing',
    f.ownerLockPublic === true && 'PUBLIC can execute lock_tenant_owners',
  ].filter((problem): problem is string => Boolean(problem));
  return lost.length
    ? { status: 'fail', detail: `${lost.join('; ')} — the database was restored before its roles existed; ${restoreFix}` }
    : { status: 'pass', detail: 'deep_fryer_app exists, NOBYPASSRLS, assumable, granted; insert policy and function ACL in place' };
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
    ? { status: 'fail', detail: `${problems.join('; ')} — run scripts/stripe-setup.ts with the real price sheet (docs/deploy.md §5)` }
    : { status: 'pass', detail: `${lookupKeys.length} catalog prices active` };
}

/** The webhook must point at this deployment and listen for every event the handler syncs. */
export function stripeWebhookVerdict(
  url: string,
  required: readonly string[],
  endpoints: readonly { url: string; status: string; enabled_events: string[] }[],
): Verdict {
  const endpoint = endpoints.find((e) => e.url === url);
  if (!endpoint) return { status: 'fail', detail: `no webhook endpoint for ${url} — run scripts/stripe-setup.ts --webhook-url ${url} (docs/deploy.md §5)` };
  if (endpoint.status !== 'enabled') return { status: 'fail', detail: `webhook for ${url} is ${endpoint.status}` };
  const all = endpoint.enabled_events.includes('*');
  const missing = all ? [] : required.filter((e) => !endpoint.enabled_events.includes(e));
  return missing.length
    ? { status: 'fail', detail: `webhook missing events: ${missing.join(', ')}` }
    : { status: 'pass', detail: `webhook enabled for ${url}` };
}
