import 'server-only';
import { getDb, withAuthContext, type DbExecutor } from '@deep-fryer/db';
import { getAuth } from './auth';

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
 */
export async function userDb<T>(fn: (db: DbExecutor) => Promise<T>): Promise<T> {
  const ctx = await getAuth();
  if (ctx.devMode) return getDb().transaction(fn);
  return withAuthContext(getDb(), ctx.userId, fn);
}

export function systemDb(): DbExecutor {
  return getDb();
}
