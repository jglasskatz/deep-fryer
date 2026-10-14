import type { RunnerOptions, Task } from 'graphile-worker';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import {
  alertIsCurrent,
  emergencyConfigSchema,
  isAlertsFeed,
  nwsAlertPageUrl,
  nwsAlertsUrl,
  nwsRequestHeaders,
  parseNwsAlerts,
  type EmergencyConfig,
  type NormalizedAlert,
} from '@deep-fryer/core';
import {
  emergencyAlerts,
  emergencyAlertSyncs,
  getDb,
  tenantConfig,
  tenants,
  type DbExecutor,
} from '@deep-fryer/db';
import { ALERTS_CRONTAB, ALERTS_TASK, guardedFetch } from '@deep-fryer/research';

/**
 * Official alerts (SPEC-v5 §3): every five minutes (ALERTS_CRONTAB) the
 * worker re-reads the National Weather Service's active alerts for each
 * portrait that configured NWS zones, and mirrors them into
 * `emergency_alerts` exactly as issued. The app never originates an alert;
 * this task is the only writer, and it only copies.
 *
 * Failure model — the public page must stay truthful when the feed is down:
 * - a feed error never clears stored alerts (a storm is exactly when the
 *   feed is most likely to be slow); it records `last_error`, and the page
 *   says the feed is stale once the last success is older than
 *   ALERTS_STALE_AFTER_MS, while still filtering out alerts that expired;
 * - a response that is not the alerts FeatureCollection counts as an error,
 *   not as "no alerts", for the same reason;
 * - a feature that does not parse is not evidence that its alert ended: its
 *   stored copy is kept (by id; when a broken feature names no id, nothing
 *   is removed that run), and a feed in which nothing parses is a failure;
 * - one portrait failing never stops the others, and the task itself never
 *   throws for a feed problem (graphile-worker would retry the whole batch).
 *
 * Scheduling: the task runs in its own graphile-worker runner
 * (alertsRunnerOptions) so a long research or policy job can never hold the
 * only slot while the five-minute refresh waits and the page goes stale.
 */

/** Fetch and parse JSON. Injected so tests run without network access. */
export type FetchJson = (url: string, headers: Record<string, string>) => Promise<unknown>;

const FEED_TIMEOUT_MS = 15_000;

/**
 * The production fetcher: through the worker egress guard (https and public
 * addresses only, every redirect re-checked) with a hard timeout, so a hung
 * connection cannot hold the cron slot past its next tick.
 */
export const fetchNwsJson: FetchJson = async (url, headers) => {
  const res = await guardedFetch(url, { headers, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`api.weather.gov answered ${res.status}`);
  return res.json();
};

export interface AlertTarget {
  tenantId: string;
  tenantSlug: string;
  config: EmergencyConfig;
}

export type SyncOutcome =
  | { tenantId: string; ok: true; stored: number; removed: number; rejected: number }
  | { tenantId: string; ok: false; error: string };

/** What one attempt leaves in `emergency_alert_syncs` (staff read `last_error` in admin). */
type Attempt = { ok: true; note: string | null } | { ok: false; error: string };

/** Short, single-line failure text for `last_error` (staff see it in admin). */
function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return (text.split('\n')[0] ?? '').slice(0, 300) || 'unknown error';
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Alert → row; null when the feed's effective time is not a date (dropped,
 * counted as rejected, its stored copy kept). `url` is the readable NWS page
 * residents follow; staff reach the API record through the source id.
 */
function alertRow(tenantId: string, a: NormalizedAlert, config: EmergencyConfig, now: Date) {
  const effective = toDate(a.effective);
  if (!effective) return null;
  return {
    tenantId,
    source: a.source,
    sourceId: a.source_id,
    event: a.event,
    severity: a.severity,
    urgency: a.urgency,
    certainty: a.certainty,
    headline: a.headline,
    description: a.description,
    instruction: a.instruction,
    areaDesc: a.area_desc,
    senderName: a.sender_name,
    url: nwsAlertPageUrl(a, config.nws_zones),
    effective,
    expires: toDate(a.expires),
    ends: toDate(a.ends),
    fetchedAt: now,
  };
}

/**
 * Refresh one portrait's alerts. Returns the outcome instead of throwing;
 * the sync-state row is written either way.
 */
export async function syncTenantAlerts({
  db,
  tenantId,
  config,
  fetchJson,
  now,
}: {
  db: DbExecutor;
  tenantId: string;
  config: EmergencyConfig;
  fetchJson: FetchJson;
  now: Date;
}): Promise<SyncOutcome> {
  let body: unknown;
  try {
    const url = nwsAlertsUrl(config.nws_zones);
    body = await fetchJson(url, nwsRequestHeaders(process.env));
    if (!isAlertsFeed(body)) throw new Error('api.weather.gov answered without a features list');
  } catch (err) {
    const error = shortError(err);
    await recordAttempt(db, tenantId, now, { ok: false, error });
    return { tenantId, ok: false, error };
  }

  const parsed = parseNwsAlerts(body);
  // Alerts were listed but none could be read: the feed's format changed
  // under us. That is a failure, not "all clear" — keep what is stored and
  // let the page go stale rather than claim there are no alerts.
  if (parsed.rejected > 0 && parsed.alerts.length === 0) {
    const error = `api.weather.gov listed ${parsed.rejected} alert(s) this app could not read`;
    await recordAttempt(db, tenantId, now, { ok: false, error });
    return { tenantId, ok: false, error };
  }
  // Expired alerts can linger in the "active" feed for a few minutes after
  // they end; never store what the page would hide anyway.
  const current = parsed.alerts.filter((a) => alertIsCurrent(a, now));
  // The same alert listed twice would make one INSERT … ON CONFLICT touch a
  // row twice (a Postgres error), so keep the first of each id.
  const byId = new Map<string, NonNullable<ReturnType<typeof alertRow>>>();
  let rejected = parsed.rejected;
  // Alerts still in the feed that could not be read this time: their last
  // stored copy stays (a partial format change must not silently delete a
  // real warning).
  const keep = new Set(parsed.rejectedIds);
  // A broken feature that names no id could be any stored alert, so that
  // run removes nothing.
  const canRemove = parsed.rejectedIds.length === parsed.rejected;
  for (const a of current) {
    const row = alertRow(tenantId, a, config, now);
    if (!row) {
      rejected++;
      keep.add(a.source_id);
    } else if (!byId.has(row.sourceId)) byId.set(row.sourceId, row);
  }
  const rows = [...byId.values()];
  const note = rejected
    ? `${rejected} alert(s) in the feed could not be read; ${canRemove ? 'their last stored copies were kept' : 'no stored alert was removed'}`
    : null;

  try {
    const removed = await db.transaction(async (tx) => {
      if (rows.length) {
        await tx
          .insert(emergencyAlerts)
          .values(rows)
          .onConflictDoUpdate({
            target: [emergencyAlerts.tenantId, emergencyAlerts.source, emergencyAlerts.sourceId],
            set: {
              event: sqlExcluded('event'),
              severity: sqlExcluded('severity'),
              urgency: sqlExcluded('urgency'),
              certainty: sqlExcluded('certainty'),
              headline: sqlExcluded('headline'),
              description: sqlExcluded('description'),
              instruction: sqlExcluded('instruction'),
              areaDesc: sqlExcluded('area_desc'),
              senderName: sqlExcluded('sender_name'),
              url: sqlExcluded('url'),
              effective: sqlExcluded('effective'),
              expires: sqlExcluded('expires'),
              ends: sqlExcluded('ends'),
              fetchedAt: sqlExcluded('fetched_at'),
            },
          });
      }
      // Anything of ours no longer in the active feed was cancelled, expired,
      // or superseded: the page shows only what the NWS shows now.
      let removed = 0;
      if (canRemove) {
        const listed = [...rows.map((r) => r.sourceId), ...keep];
        const gone = await tx
          .delete(emergencyAlerts)
          .where(
            and(
              eq(emergencyAlerts.tenantId, tenantId),
              eq(emergencyAlerts.source, 'nws'),
              listed.length ? notInArray(emergencyAlerts.sourceId, listed) : undefined,
            ),
          )
          .returning({ id: emergencyAlerts.id });
        removed = gone.length;
      }
      await recordAttempt(tx, tenantId, now, { ok: true, note });
      return removed;
    });
    return { tenantId, ok: true, stored: rows.length, removed, rejected };
  } catch (err) {
    const error = shortError(err);
    await recordAttempt(db, tenantId, now, { ok: false, error }).catch(() => undefined);
    return { tenantId, ok: false, error };
  }
}

/**
 * Upsert the per-portrait sync state: the attempt time always; on success
 * also the success time, with `last_error` set to the run's note (alerts it
 * could not read) or cleared; on failure only the error, so
 * `last_success_at` keeps telling the page how old its data is.
 */
async function recordAttempt(db: DbExecutor, tenantId: string, now: Date, attempt: Attempt) {
  const lastError = attempt.ok ? attempt.note : attempt.error;
  await db
    .insert(emergencyAlertSyncs)
    .values({ tenantId, lastAttemptAt: now, lastSuccessAt: attempt.ok ? now : null, lastError })
    .onConflictDoUpdate({
      target: emergencyAlertSyncs.tenantId,
      set: attempt.ok ? { lastAttemptAt: now, lastSuccessAt: now, lastError } : { lastAttemptAt: now, lastError },
    });
}

/** `excluded.<column>` for ON CONFLICT DO UPDATE: take the incoming row's value. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

/**
 * Every live portrait with NWS zones configured. A stored config that no
 * longer validates is skipped with a log line rather than guessed at.
 */
export async function loadAlertTargets(
  db: DbExecutor,
  log: (message: string) => void = console.warn,
): Promise<AlertTarget[]> {
  const rows = await db
    .select({ tenantId: tenants.id, tenantSlug: tenants.slug, value: tenantConfig.value })
    .from(tenantConfig)
    .innerJoin(tenants, eq(tenants.id, tenantConfig.tenantId))
    .where(and(eq(tenantConfig.key, 'emergency'), isNull(tenants.archivedAt)));
  const targets: AlertTarget[] = [];
  for (const row of rows) {
    const parsed = emergencyConfigSchema.safeParse(row.value);
    if (!parsed.success) {
      log(`alerts_sync: ${row.tenantSlug}: emergency config is invalid (${parsed.error.issues[0]?.message}); skipping`);
      continue;
    }
    if (parsed.data.nws_zones.length === 0) continue;
    targets.push({ tenantId: row.tenantId, tenantSlug: row.tenantSlug, config: parsed.data });
  }
  return targets;
}

/**
 * Sync each target in turn. Sequential on purpose: the NWS asks clients to
 * be gentle, and a handful of portraits every five minutes is nothing.
 * Each target is isolated — even an unexpected throw (a database hiccup)
 * becomes that target's failed outcome.
 */
export async function syncAlertTargets(
  targets: AlertTarget[],
  { db, fetchJson, now }: { db: DbExecutor; fetchJson: FetchJson; now: Date },
): Promise<SyncOutcome[]> {
  const outcomes: SyncOutcome[] = [];
  for (const t of targets) {
    try {
      outcomes.push(await syncTenantAlerts({ db, tenantId: t.tenantId, config: t.config, fetchJson, now }));
    } catch (err) {
      outcomes.push({ tenantId: t.tenantId, ok: false, error: shortError(err) });
    }
  }
  return outcomes;
}

export const alertsSync: Task = async (_payload, helpers) => {
  const db = getDb();
  const targets = await loadAlertTargets(db, (m) => helpers.logger.warn(m));
  if (targets.length === 0) return;
  const slugs = new Map(targets.map((t) => [t.tenantId, t.tenantSlug]));
  const outcomes = await syncAlertTargets(targets, { db, fetchJson: fetchNwsJson, now: new Date() });
  for (const o of outcomes) {
    const slug = slugs.get(o.tenantId);
    if (o.ok) {
      helpers.logger.info(`alerts_sync: ${slug}: ${o.stored} current, ${o.removed} removed${o.rejected ? `, ${o.rejected} unparseable` : ''}`);
    } else {
      helpers.logger.warn(`alerts_sync: ${slug}: ${o.error}`);
    }
  }
};

/**
 * The alerts runner's graphile-worker options. The worker process starts
 * this runner beside the research one (`run(alertsRunnerOptions(url))`):
 *
 * - its own task list and its own slot (concurrency 1), so research and
 *   policy jobs, which run for minutes, can never starve the refresh — the
 *   runners share the queue but each only takes the tasks it knows;
 * - the five-minute schedule (ALERTS_CRONTAB), whose options make a failed
 *   tick final (the next tick is the retry) and collapse ticks waiting
 *   behind a busy runner into one.
 */
export function alertsRunnerOptions(connectionString: string): RunnerOptions {
  return {
    connectionString,
    concurrency: 1,
    taskList: { [ALERTS_TASK]: alertsSync },
    crontab: ALERTS_CRONTAB,
  };
}
