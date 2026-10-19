#!/usr/bin/env tsx
/**
 * Production preflight: verify a deployment against the live services it
 * depends on, after `docker compose up` and before a city is onboarded.
 *
 *   docker compose run --rm migrate node --import tsx ../../scripts/preflight.ts
 *
 * Each check talks to the real thing — Postgres, the object store, the SMTP
 * relay, Google / Microsoft Entra, Stripe, the Anthropic Models API, the
 * National Weather Service alerts feed, and the public URL through Caddy —
 * and prints PASS / WARN / FAIL with what to fix. Exit 1 if anything
 * fails. Nothing is written except one throwaway SMTP verification (no
 * message is sent); OAuth credentials are proven by redeeming a deliberately
 * invalid code (see oauthCredentialVerdict); Stripe is read-only; the
 * research key is proven by looking up each configured model (free, no
 * tokens spent).
 *
 * The web checks fetch APP_URL from inside this container, so APP_URL must
 * resolve to Caddy there and present a certificate the container trusts
 * (docs/deploy.md, "Verify against the live services", has the rehearsal
 * setup for a host without a public name).
 */
import nodemailer from 'nodemailer';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import Stripe from 'stripe';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  PLANS,
  SAMPLE_DATA_CONFIG_KEY,
  alertCheckTargets,
  anthropicModelVerdict,
  appRoleVerdict,
  type AppRoleFacts,
  contactAddressesVerdict,
  disabledFeaturesVerdict,
  errorDetail,
  isSampleDataValue,
  modelAliasVerdict,
  modelLookupId,
  nwsAlertsUrl,
  nwsFeedVerdict,
  nwsZonesVerdict,
  nwsZoneUrls,
  nwsZoneCoverageVerdict,
  nwsRequestHeaders,
  STRIPE_WEBHOOK_EVENTS,
  oauthCredentialVerdict,
  parseDisabledFeatures,
  productionEnvProblems,
  type CredentialProbe,
  researchKeyMissingVerdict,
  researchModels,
  sampleDataVerdict,
  showcaseSlug,
  showcaseVerdict,
  smtpLoginConfigured,
  smtpVerifiedVerdict,
  storedApiKeysVerdict,
  stripeCatalogVerdict,
  stripeEndpoint,
  stripeWebhookVerdict,
  termsUrlToCheck,
  termsUrlVerdict,
  type Verdict,
} from '@deep-fryer/core';
import { getDb, organizations, tenantConfig, tenantIsPublic, tenants } from '@deep-fryer/db';
import { s3SettingsFromEnv } from '@deep-fryer/research';
import journal from '../packages/db/migrations/meta/_journal.json' with { type: 'json' };

type Row = { area: string; check: string } & Verdict;
const rows: Row[] = [];
const record = (area: string, check: string, v: Verdict) => rows.push({ area, check, ...v });
const skip = (area: string, check: string, why: string) => record(area, check, { status: 'warn', detail: `skipped: ${why}` });

/**
 * Runs one check; a throw is a FAIL that keeps the error's cause (a bare
 * "fetch failed" says nothing; its cause names the refused port, the name
 * that did not resolve, or the certificate that is not trusted). `hint` is
 * the usual fix for checks that can only throw by not reaching the service.
 */
async function guarded(area: string, check: string, fn: () => Promise<Verdict>, hint?: string) {
  try {
    record(area, check, await fn());
  } catch (err) {
    record(area, check, { status: 'fail', detail: hint ? `${errorDetail(err)} — ${hint}` : errorDetail(err) });
  }
}

/** Why a fetch of APP_URL from this container fails when the site itself is fine. */
const APP_URL_HINT =
  'APP_URL must resolve to Caddy from inside the containers and present a certificate they trust (docs/deploy.md, "Verify against the live services")';

const env = process.env;
const appUrl = (env.APP_URL ?? '').replace(/\/+$/, '');
const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
const microsoftConfigured = Boolean(env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET);
const stripeConfigured = Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

async function configChecks() {
  await guarded('config', 'production environment', async () => {
    const problems = productionEnvProblems(env);
    return problems.length
      ? { status: 'fail', detail: problems.join('; ') }
      : { status: 'pass', detail: 'every required variable set (same rules the web app enforces at boot)' };
  });
  await guarded('config', 'APP_URL is https', async () =>
    appUrl.startsWith('https://')
      ? { status: 'pass', detail: appUrl }
      : { status: 'fail', detail: `APP_URL must be the public https origin (got "${appUrl}")` },
  );
  // A misspelt name switches nothing off and would otherwise go unnoticed.
  await guarded('config', 'DF_DISABLED_FEATURES', async () => disabledFeaturesVerdict(env.DF_DISABLED_FEATURES));
  // Placeholders copied from .env.example pass the boot rules; mail from them bounces or lands in spam.
  await guarded('config', 'sender and support addresses', async () => contactAddressesVerdict(env));
}

async function databaseChecks() {
  const db = getDb();
  await guarded('database', 'migrations current', async () => {
    const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const applied = Number(rows[0]?.n ?? 0);
    const expected = journal.entries.length;
    return applied === expected
      ? { status: 'pass', detail: `${applied} of ${expected} applied` }
      : { status: 'fail', detail: `${applied} of ${expected} applied — the migrate service did not finish` };
  });
  // Beyond the role itself, the objects a pg_dump restore drops when the role
  // was missing at restore time (appRoleVerdict). Privilege functions raise on
  // a missing role or function, so each is asked only when its object exists.
  await guarded('database', 'row-level security role', async () => {
    const [r] = await db.execute<AppRoleFacts>(sql`
      with app as (select rolbypassrls from pg_roles where rolname = 'deep_fryer_app'),
           owner_lock as (select to_regprocedure('public.lock_tenant_owners(uuid)') as fn)
      select exists(select 1 from app) as exists,
             (select rolbypassrls from app) as bypass,
             (select pg_has_role(current_user, 'deep_fryer_app', 'MEMBER') where exists(select 1 from app)) as member,
             (select has_table_privilege('deep_fryer_app', 'public.tenants', 'SELECT') where exists(select 1 from app)) as "readsTenants",
             exists(select 1 from pg_policies
                     where schemaname = 'public' and tablename = 'research_runs'
                       and policyname = 'research_runs_app_insert_planned') as "insertGuard",
             (select has_function_privilege('public', fn, 'EXECUTE') from owner_lock where fn is not null) as "ownerLockPublic"`);
    return appRoleVerdict(r ?? { exists: false, bypass: null, member: null, readsTenants: null, insertGuard: false, ownerLockPublic: null });
  });
  // Blank counts as unset, as in the web app (compose passes `${DF_SECRETS_KEY:-}`).
  await guarded('database', 'organization API keys readable', async () => {
    const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from organization_api_keys`);
    return storedApiKeysVerdict(Number(r?.n ?? 0), Boolean(env.DF_SECRETS_KEY?.trim()));
  });
}

async function storageChecks() {
  const s3 = s3SettingsFromEnv();
  if (!s3) return skip('storage', 'evidence bucket', 'S3_* not set (evidence on local disk)');
  await guarded('storage', 'app credentials reach the bucket', async () => {
    const client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    });
    await client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
    return { status: 'pass', detail: `s3://${s3.bucket}` };
  });
  const publicBase = process.env.S3_PUBLIC_URL?.replace(/\/+$/, '');
  if (!publicBase) return skip('storage', 'public evidence URL', 'S3_PUBLIC_URL not set');
  await guarded(
    'storage',
    'public evidence URL serves objects, not listings',
    async () => {
      const missing = await fetch(`${publicBase}/preflight/${crypto.randomUUID()}.png`);
      const listing = await fetch(`${publicBase}/`);
      if (missing.status !== 404) return { status: 'fail', detail: `missing object answered ${missing.status} (want 404: is /files/ routed to the bucket?)` };
      if (listing.ok && /ListBucketResult/.test(await listing.text())) return { status: 'fail', detail: 'the bucket listing is public' };
      return { status: 'pass', detail: `${publicBase}/… routed; no public listing` };
    },
    APP_URL_HINT,
  );
}

async function mailChecks() {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) return skip('mail', 'SMTP relay', 'SMTP_URL not set (no email sign-in or notifications)');
  // verify() logs in only when SMTP_URL carries a login; without one it proves a connection, and says so.
  await guarded('mail', smtpLoginConfigured(smtpUrl) ? 'SMTP relay accepts our login' : 'SMTP relay answers', async () => {
    await nodemailer.createTransport(smtpUrl).verify();
    return smtpVerifiedVerdict(smtpUrl, process.env.EMAIL_FROM);
  });
}

/**
 * The deployment's research key (the worker's ANTHROPIC_API_KEY, given to
 * this ops shell by compose with the worker's model settings). Each model a
 * run calls is looked up in the Models API with that key — the same
 * account, workspace and model access the sessions get — so a wrong key, a
 * workspace not allowed a model, or a mistyped model id fails here instead
 * of in the first paid build. A 401 is the key itself, so the remaining
 * lookups would only repeat it. Talks to api.anthropic.com directly, not
 * through the worker's egress proxy.
 */
async function anthropicChecks() {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) return record('anthropic', 'research key (ANTHROPIC_API_KEY)', researchKeyMissingVerdict());
  for (const m of researchModels(env)) {
    const check = `${m.role} model (${m.variable})`;
    const id = modelLookupId(m.model);
    if (!id) {
      record('anthropic', check, modelAliasVerdict(m));
      continue;
    }
    let refused = false;
    await guarded('anthropic', check, async () => {
      const res = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(id)}`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(15_000),
      });
      refused = res.status === 401;
      return anthropicModelVerdict(m, res.status, await res.json().catch(() => null));
    });
    if (refused) break;
  }
}

async function discover(area: string, issuer: string, tenantFix: (iss: string) => string = (iss) => iss) {
  let tokenEndpoint: string | null = null;
  await guarded(area, 'issuer discovery', async () => {
    const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    if (!res.ok) return { status: 'fail', detail: `discovery answered ${res.status} for ${issuer}` };
    const doc = (await res.json()) as { issuer: string; token_endpoint: string };
    tokenEndpoint = doc.token_endpoint;
    return tenantFix(doc.issuer).replace(/\/+$/, '') === issuer.replace(/\/+$/, '')
      ? { status: 'pass', detail: doc.token_endpoint }
      : { status: 'warn', detail: `issuer advertises ${doc.issuer}, configured ${issuer}` };
  });
  return tokenEndpoint as string | null;
}

async function probeCredentials(area: string, endpoint: string, probe: CredentialProbe, form: Record<string, string>) {
  await guarded(area, 'client id and secret', async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    return oauthCredentialVerdict(probe, res.status, await res.json().catch(() => null));
  });
}

async function signInChecks() {
  if (googleConfigured) {
    const endpoint = await discover('google', 'https://accounts.google.com');
    if (endpoint) {
      await probeCredentials('google', endpoint, 'invalid-code', {
        grant_type: 'authorization_code',
        code: 'deep-fryer-preflight-invalid-code',
        redirect_uri: `${appUrl}/api/auth/callback/google`,
        client_id: env.AUTH_GOOGLE_ID!,
        client_secret: env.AUTH_GOOGLE_SECRET!,
      });
    }
  } else skip('google', 'sign-in', 'AUTH_GOOGLE_* not set');

  if (microsoftConfigured) {
    const issuer = env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || 'https://login.microsoftonline.com/common/v2.0';
    const tenant = /microsoftonline\.(?:com|us)\/([^/]+)\/v2\.0/.exec(issuer)?.[1] ?? 'common';
    const multiTenant = ['common', 'organizations', 'consumers'].includes(tenant);
    const endpoint = await discover('microsoft', issuer, (iss) => iss.replace('{tenantid}', tenant));
    if (endpoint && !multiTenant) {
      const graph = issuer.includes('microsoftonline.us') ? 'https://graph.microsoft.us' : 'https://graph.microsoft.com';
      await probeCredentials('microsoft', endpoint, 'client-credentials', {
        grant_type: 'client_credentials',
        scope: `${graph}/.default`,
        client_id: env.AUTH_MICROSOFT_ENTRA_ID_ID!,
        client_secret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      });
    }
    if (multiTenant) {
      record('microsoft', 'client id and secret', {
        status: 'warn',
        detail: `not verifiable on the multi-tenant "${tenant}" issuer, and any Microsoft 365 organization can sign in — pin AUTH_MICROSOFT_ENTRA_ID_ISSUER to your tenant id`,
      });
    }
  } else skip('microsoft', 'sign-in', 'AUTH_MICROSOFT_ENTRA_ID_* not set');
}

async function stripeChecks() {
  if (!stripeConfigured) return skip('stripe', 'billing', 'STRIPE_* not set (contracts only)');
  const key = process.env.STRIPE_SECRET_KEY!;
  const stripe = new Stripe(key, { ...stripeEndpoint(process.env.STRIPE_API_BASE, key) });
  record('stripe', 'key mode', {
    status: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'pass' : 'warn',
    detail: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live key' : 'test-mode key: no real payments will be taken',
  });
  await guarded('stripe', 'catalog prices', async () => {
    const keys = Object.values(PLANS).flatMap((p) => Object.values(p.stripeLookupKeys));
    const prices: Stripe.Price[] = [];
    for (let i = 0; i < keys.length; i += 10) {
      prices.push(...(await stripe.prices.list({ lookup_keys: keys.slice(i, i + 10), active: true, limit: 100 })).data);
    }
    return stripeCatalogVerdict(keys, prices);
  });
  await guarded('stripe', 'webhook endpoint', async () => {
    const endpoints = (await stripe.webhookEndpoints.list({ limit: 100 })).data;
    return stripeWebhookVerdict(`${appUrl}/api/billing/webhook`, STRIPE_WEBHOOK_EVENTS, endpoints);
  });
  await guarded('stripe', 'customer portal', async () => {
    const configs = (await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })).data;
    return configs[0]?.active
      ? { status: 'pass', detail: `default configuration ${configs[0].id}` }
      : { status: 'fail', detail: 'no active default portal configuration — run scripts/stripe-setup.ts --portal (docs/deploy.md §5)' };
  });
}

/**
 * Official alerts (SPEC-v5 §3): for every portrait with NWS zones whose
 * emergency view is on — the ones the worker polls (alertCheckTargets) — the
 * feed must answer with the alerts FeatureCollection, with the same contact
 * User-Agent the worker sends, since api.weather.gov may refuse unidentified
 * clients. Run from the worker's network when its egress goes through an
 * allowlist proxy, so the check sees what the worker sees.
 */
async function alertsChecks() {
  const portraits: { slug: string; zones: string[] }[] = [];
  await guarded('alerts', 'emergency configs readable', async () => {
    const db = getDb();
    const rows = await db
      .select({ id: tenants.id, slug: tenants.slug, value: tenantConfig.value })
      .from(tenantConfig)
      .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
      .where(and(eq(tenantConfig.key, 'emergency'), isNull(tenants.archivedAt)));
    const features = rows.length
      ? await db
          .select({ tenantId: tenantConfig.tenantId, value: tenantConfig.value })
          .from(tenantConfig)
          .where(and(eq(tenantConfig.key, 'features'), inArray(tenantConfig.tenantId, rows.map((r) => r.id))))
      : [];
    const featuresOf = new Map(features.map((f) => [f.tenantId, f.value]));
    const targets = alertCheckTargets(
      rows.map((r) => ({ slug: r.slug, emergency: r.value, features: featuresOf.get(r.id) ?? null })),
      parseDisabledFeatures(env.DF_DISABLED_FEATURES).disabled,
    );
    portraits.push(...targets.portraits);
    return targets.invalid.length
      ? {
          status: 'fail',
          detail: `invalid emergency config for ${targets.invalid.join(', ')} — re-save it at /{portrait}/admin/emergency`,
        }
      : { status: 'pass', detail: `${portraits.length} portrait(s) with the emergency view on and NWS zones` };
  });
  if (portraits.length === 0) {
    return skip('alerts', 'NWS alerts feed', 'no portrait with the emergency view on has NWS zones configured');
  }
  if (!env.SUPPORT_EMAIL && !env.EMAIL_FROM) {
    record('alerts', 'NWS contact in User-Agent', { status: 'warn', detail: 'set SUPPORT_EMAIL (or EMAIL_FROM) so the NWS can reach you' });
  }
  const headers = nwsRequestHeaders(env);
  // Portraits sharing a zone set (rare) are checked once.
  const seen = new Map<string, string[]>();
  for (const p of portraits) {
    const key = p.zones.join(',');
    seen.set(key, [...(seen.get(key) ?? []), p.slug]);
  }
  for (const [key, slugs] of seen) {
    const zones = key.split(',');
    await guarded('alerts', `NWS feed: ${slugs.join(', ')}`.slice(0, 46), async () => {
      const res = await fetch(nwsAlertsUrl(zones), { headers, signal: AbortSignal.timeout(15_000) });
      return nwsFeedVerdict(zones, res.status, await res.json().catch(() => null));
    });
    // A feed that answers can still miss most alerts if only one kind of zone is listed.
    record('alerts', `NWS zone kinds: ${slugs.join(', ')}`.slice(0, 46), nwsZoneCoverageVerdict(zones));
  }
  // The feed accepts any well-formed code, so a mistyped or retired zone
  // answers "no alerts" forever; each zone's own record proves it exists.
  // Lookups settle independently: one that times out is reported by name as
  // unconfirmed rather than failing the whole check.
  await guarded('alerts', 'NWS zones exist', async () => {
    const portraitsOf = new Map<string, string[]>();
    for (const p of portraits) {
      for (const z of new Set(p.zones)) portraitsOf.set(z, [...(portraitsOf.get(z) ?? []), p.slug]);
    }
    const lookups = await Promise.all(
      [...portraitsOf].map(async ([zone, slugs]) => {
        let status = 0;
        for (const url of nwsZoneUrls(zone)) {
          try {
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
            await res.body?.cancel();
            status = res.status;
          } catch {
            status = 0;
          }
          if (status !== 404) break; // found, or not answering: only a 404 tries the next record
        }
        return { zone, status, portraits: slugs };
      }),
    );
    return nwsZonesVerdict(lookups);
  });
}

async function webChecks() {
  if (!appUrl) return;
  await guarded(
    'web',
    'public health check through the proxy',
    async () => {
      const res = await fetch(`${appUrl}/api/health`);
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !body.ok) return { status: 'fail', detail: `${appUrl}/api/health answered ${res.status}` };
      return { status: 'pass', detail: `${appUrl} healthy` };
    },
    APP_URL_HINT,
  );
  await guarded(
    'web',
    'security headers',
    async () => {
      const res = await fetch(`${appUrl}/`, { redirect: 'manual' });
      const missing = ['content-security-policy', 'strict-transport-security', 'x-content-type-options'].filter(
        (h) => !res.headers.get(h),
      );
      return missing.length
        ? { status: 'fail', detail: `missing ${missing.join(', ')}` }
        : { status: 'pass', detail: 'CSP, HSTS, nosniff present' };
    },
    APP_URL_HINT,
  );
}

/**
 * What the public will see on launch day that nothing else checks (docs/deploy.md,
 * "Before a public launch"): seeded sample data in the database, a landing-page
 * showcase that silently shows nothing, and the footer's Terms link. Warnings
 * only — each is the operator's call — except that a check that cannot run fails.
 */
async function launchChecks() {
  const db = getDb();
  await guarded('launch', 'seeded sample data', async () => {
    const rows = await db
      .select({ slug: tenants.slug, value: tenantConfig.value })
      .from(tenantConfig)
      .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
      .where(and(eq(tenantConfig.key, SAMPLE_DATA_CONFIG_KEY), isNull(tenants.archivedAt)))
      .orderBy(tenants.slug);
    return sampleDataVerdict(rows.filter((r) => isSampleDataValue(r.value)).map((r) => r.slug));
  });
  await guarded('launch', 'landing showcase (DF_SHOWCASE_ORG)', async () => {
    const slug = showcaseSlug(env.DF_SHOWCASE_ORG);
    if (!slug) return showcaseVerdict(env.DF_SHOWCASE_ORG, null);
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    const [count] = org
      ? await db
          .select({ n: sql<number>`count(*)::int` })
          .from(tenants)
          .where(and(eq(tenants.organizationId, org.id), tenantIsPublic()))
      : [];
    return showcaseVerdict(env.DF_SHOWCASE_ORG, { organization: Boolean(org), publicPortraits: Number(count?.n ?? 0) });
  });
  await guarded('launch', 'terms page (TERMS_URL)', async () => {
    const url = termsUrlToCheck(env.TERMS_URL);
    if (!url) return termsUrlVerdict(env.TERMS_URL, null);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      await res.body?.cancel();
      return termsUrlVerdict(url, res.status);
    } catch (err) {
      // Someone else's site, perhaps unreachable from here: worth a look, not a blocker.
      return { status: 'warn', detail: `${url} did not answer: ${errorDetail(err)}` };
    }
  });
}

async function main() {
  await configChecks();
  await databaseChecks();
  await storageChecks();
  await mailChecks();
  await signInChecks();
  await stripeChecks();
  await anthropicChecks();
  await alertsChecks();
  await webChecks();
  await launchChecks();

  const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;
  for (const r of rows) console.log(`${mark[r.status]}  ${r.area.padEnd(10)} ${r.check.padEnd(46)} ${r.detail}`);
  const failed = rows.filter((r) => r.status === 'fail').length;
  console.log(`\n${failed ? `${failed} check(s) failed` : 'all checks passed'} (${rows.filter((r) => r.status === 'warn').length} warning(s))`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
