#!/usr/bin/env tsx
/**
 * Production preflight: verify a deployment against the live services it
 * depends on, after `docker compose up` and before a city is onboarded.
 *
 *   docker compose run --rm migrate node --import tsx ../../scripts/preflight.ts
 *
 * Each check talks to the real thing — Postgres, the object store, the SMTP
 * relay, Google / Microsoft Entra, Stripe, the National Weather Service
 * alerts feed, and the public URL through Caddy — and prints PASS / WARN /
 * FAIL with what to fix. Exit 1 if anything
 * fails. Nothing is written except one throwaway SMTP verification (no
 * message is sent); OAuth credentials are proven by redeeming a deliberately
 * invalid code (see oauthCredentialVerdict); Stripe is read-only.
 */
import nodemailer from 'nodemailer';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import Stripe from 'stripe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  PLANS,
  emergencyConfigSchema,
  nwsAlertsUrl,
  nwsFeedVerdict,
  nwsZoneCoverageVerdict,
  nwsRequestHeaders,
  STRIPE_WEBHOOK_EVENTS,
  oauthCredentialVerdict,
  productionEnvProblems,
  type CredentialProbe,
  stripeCatalogVerdict,
  stripeEndpoint,
  stripeWebhookVerdict,
  type Verdict,
} from '@deep-fryer/core';
import { getDb, tenantConfig, tenants } from '@deep-fryer/db';
import { s3SettingsFromEnv } from '@deep-fryer/research';
import journal from '../packages/db/migrations/meta/_journal.json' with { type: 'json' };

type Row = { area: string; check: string } & Verdict;
const rows: Row[] = [];
const record = (area: string, check: string, v: Verdict) => rows.push({ area, check, ...v });
const skip = (area: string, check: string, why: string) => record(area, check, { status: 'warn', detail: `skipped: ${why}` });

async function guarded(area: string, check: string, fn: () => Promise<Verdict>) {
  try {
    record(area, check, await fn());
  } catch (err) {
    record(area, check, { status: 'fail', detail: err instanceof Error ? err.message.split('\n')[0]!.slice(0, 220) : String(err) });
  }
}

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
  await guarded('database', 'row-level security role', async () => {
    const [r] = await db.execute<{ exists: boolean; bypass: boolean | null; member: boolean | null }>(sql`
      select exists(select 1 from pg_roles where rolname = 'deep_fryer_app') as exists,
             (select rolbypassrls from pg_roles where rolname = 'deep_fryer_app') as bypass,
             (select pg_has_role(current_user, 'deep_fryer_app', 'MEMBER')
                where exists(select 1 from pg_roles where rolname = 'deep_fryer_app')) as member`);
    if (!r?.exists) return { status: 'fail', detail: 'role deep_fryer_app missing (migration 0005)' };
    if (r.bypass) return { status: 'fail', detail: 'deep_fryer_app has BYPASSRLS — policies would not apply' };
    if (!r.member) return { status: 'fail', detail: 'the connecting user cannot SET ROLE deep_fryer_app' };
    return { status: 'pass', detail: 'deep_fryer_app exists, NOBYPASSRLS, assumable' };
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
  await guarded('storage', 'public evidence URL serves objects, not listings', async () => {
    const missing = await fetch(`${publicBase}/preflight/${crypto.randomUUID()}.png`);
    const listing = await fetch(`${publicBase}/`);
    if (missing.status !== 404) return { status: 'fail', detail: `missing object answered ${missing.status} (want 404: is /files/ routed to the bucket?)` };
    if (listing.ok && /ListBucketResult/.test(await listing.text())) return { status: 'fail', detail: 'the bucket listing is public' };
    return { status: 'pass', detail: `${publicBase}/… routed; no public listing` };
  });
}

async function mailChecks() {
  if (!process.env.SMTP_URL) return skip('mail', 'SMTP relay', 'SMTP_URL not set (no email sign-in or notifications)');
  await guarded('mail', 'SMTP relay accepts our login', async () => {
    await nodemailer.createTransport(process.env.SMTP_URL).verify();
    return { status: 'pass', detail: `connected and authenticated (${process.env.EMAIL_FROM ?? 'EMAIL_FROM unset'})` };
  });
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
      : { status: 'fail', detail: 'no active default portal configuration — run pnpm stripe:setup --portal' };
  });
}

/**
 * Official alerts (SPEC-v5 §3): for every portrait with NWS zones, the feed
 * the worker polls must answer with the alerts FeatureCollection — with the
 * same contact User-Agent the worker sends, since api.weather.gov may refuse
 * unidentified clients. Run from the worker's network when its egress goes
 * through an allowlist proxy, so the check sees what the worker sees.
 */
async function alertsChecks() {
  const portraits: { slug: string; zones: string[] }[] = [];
  await guarded('alerts', 'emergency configs readable', async () => {
    const rows = await getDb()
      .select({ slug: tenants.slug, value: tenantConfig.value })
      .from(tenantConfig)
      .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
      .where(and(eq(tenantConfig.key, 'emergency'), isNull(tenants.archivedAt)));
    const invalid: string[] = [];
    for (const r of rows) {
      const parsed = emergencyConfigSchema.safeParse(r.value);
      if (!parsed.success) invalid.push(r.slug);
      else if (parsed.data.nws_zones.length) portraits.push({ slug: r.slug, zones: parsed.data.nws_zones });
    }
    return invalid.length
      ? { status: 'fail', detail: `invalid emergency config for ${invalid.join(', ')} — re-save it at /{portrait}/admin/emergency` }
      : { status: 'pass', detail: `${portraits.length} portrait(s) with NWS zones` };
  });
  if (portraits.length === 0) return skip('alerts', 'NWS alerts feed', 'no portrait has NWS zones configured');
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
}

async function webChecks() {
  if (!appUrl) return;
  await guarded('web', 'public health check through the proxy', async () => {
    const res = await fetch(`${appUrl}/api/health`);
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!res.ok || !body.ok) return { status: 'fail', detail: `${appUrl}/api/health answered ${res.status}` };
    return { status: 'pass', detail: `${appUrl} healthy` };
  });
  await guarded('web', 'security headers', async () => {
    const res = await fetch(`${appUrl}/`, { redirect: 'manual' });
    const missing = ['content-security-policy', 'strict-transport-security', 'x-content-type-options'].filter(
      (h) => !res.headers.get(h),
    );
    return missing.length
      ? { status: 'fail', detail: `missing ${missing.join(', ')}` }
      : { status: 'pass', detail: 'CSP, HSTS, nosniff present' };
  });
}

async function main() {
  await configChecks();
  await databaseChecks();
  await storageChecks();
  await mailChecks();
  await signInChecks();
  await stripeChecks();
  await alertsChecks();
  await webChecks();

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
