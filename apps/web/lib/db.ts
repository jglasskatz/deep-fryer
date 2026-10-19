import 'server-only';
import { getDb, withAuthContext, type DbExecutor } from '@deep-fryer/db';
import { getAuth, runWithAuth } from './auth';

/**
 * The two ways the web app reaches Postgres (SPEC-v4 §6).
 *
 * userDb(fn) — everything a person does or sees: one transaction as the
 * non-owner `deep_fryer_app` role with app.user_id set to the signed-in
 * person (or none, for anonymous visitors), so row-level security enforces
 * tenant isolation independently of the app-layer checks. Dev mode
 * (no AUTH_SECRET; refused in production) runs as owner, because the local
 * developer acts as owner everywhere without memberships.
 *
 * systemDb() — the owner role, RLS bypassed. Only for the operations that
 * by nature cross the member boundary, each after an app-layer check:
 * auth plumbing (sessions, roles), the Stripe webhook and subscription
 * sync, organization-wide quota and seat math, provisioning, invitation
 * acceptance, audit writes, and owner-only transcript downloads.
 * systemTransaction(fn) is the same as one transaction, for an action that
 * audits inside it.
 *
 * Code inside either transaction keeps to it: no second transaction and no
 * systemDb() query until it has returned, or it waits for a second pooled
 * connection while holding one (packages/db auth-context.ts). The identity
 * is the exception made safe here: both resolve it before the transaction
 * opens and hold it for the callback, so getAuth() inside — audit()'s actor,
 * requireUserId() — answers without reading the session again (lib/auth.ts
 * transactionAuth). Role checks are not covered: getRole reads memberships
 * on the pooled client, so requireTenantRole and its kin run before the
 * transaction.
 */
export async function userDb<T>(fn: (db: DbExecutor) => Promise<T>): Promise<T> {
  const ctx = await getAuth();
  return runWithAuth(ctx, () =>
    ctx.devMode ? getDb().transaction(fn) : withAuthContext(getDb(), ctx.userId, fn),
  );
}

export function systemDb(): DbExecutor {
  return getDb();
}

/**
 * A system-context transaction (see systemDb) for an action that has
 * already authorized the request and writes its audit entry inside it, so
 * the change and its record commit together. Like userDb it resolves the
 * request's identity first and holds it for the callback: audit() records
 * the actor without a session read on a second pooled connection.
 */
export async function systemTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const ctx = await getAuth();
  return runWithAuth(ctx, () => getDb().transaction(fn));
}
