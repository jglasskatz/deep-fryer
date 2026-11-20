import { asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { auditLog, users } from './schema.js';

/**
 * Staff access (users.is_staff): who may set contract plans and quotas and
 * act across organizations. It is granted from the operator's shell
 * (scripts/make-staff.ts), never from the web app, so these helpers run in
 * the system context: pass the pooled client from getDb(), or a transaction
 * opened on it. Each change and its audit entry commit together.
 *
 * Audit entries for staff access belong to no portrait (migration 0023): the
 * entity is the account, `tenant_id` is null, and no portrait owner can read
 * them.
 */

/** The audit_log entity and actions a staff change is recorded under. */
export const STAFF_AUDIT_ENTITY = 'user';
export const STAFF_GRANT_ACTION = 'grant_staff';
export const STAFF_REVOKE_ACTION = 'revoke_staff';

/** Why a staff change was not made; its message is meant for the operator. */
export class StaffChangeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaffChangeRefused';
  }
}

export interface StaffChange {
  userId: string;
  email: string;
  /** The flag after the call. */
  isStaff: boolean;
  /** False when the account already had the asked-for access: nothing was written. */
  changed: boolean;
}

export interface StaffChangeOptions {
  /** Who made the change, when a signed-in person did; null from the shell. */
  actorUserId?: string | null;
  /** Where the change came from, kept in the audit entry (e.g. the command's name). */
  via?: string;
}

export interface StaffMember {
  userId: string;
  email: string | null;
  name: string | null;
  /** When access was last granted through setStaff; null if it was set some other way. */
  grantedAt: Date | null;
}

/**
 * Someone has signed in with an account when Auth.js has confirmed its
 * address (a used sign-in link sets email_verified) or linked a provider
 * account to it (Google, Microsoft). A row that staff scripts made ahead of
 * time for an invited owner has neither until that person signs in.
 */
const hasSignedIn = sql<boolean>`("users"."email_verified" is not null
  or exists (select 1 from accounts a where a.user_id = "users"."id"))`;

/**
 * Give the account signed in as `email` staff access (`on` true), or take it
 * away (`on` false), and record the change in audit_log.
 *
 * Granting needs an account someone has signed in with: an address no one
 * has used yet is refused, so access never waits on an inbox for whoever
 * claims it first. Taking access away needs only an account with that
 * address. Addresses match without regard to case. Asking for what the
 * account already has changes nothing and writes no entry.
 */
export async function setStaff(
  db: DbExecutor,
  email: string,
  on: boolean,
  options: StaffChangeOptions = {},
): Promise<StaffChange> {
  const address = email.trim();
  if (!address) throw new StaffChangeRefused('Give the email address the person signs in with.');

  return db.transaction(async (tx) => {
    const matches = await tx
      .select({ id: users.id, email: users.email, isStaff: users.isStaff, signedIn: hasSignedIn })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${address})`)
      .for('update');

    const eligible = on ? matches.filter((row) => row.signedIn) : matches;
    if (eligible.length === 0) {
      throw new StaffChangeRefused(
        on
          ? `No one has signed in as ${address} yet. Sign in to the app with that address first, then run this again.`
          : `There is no account for ${address}.`,
      );
    }
    if (eligible.length > 1) {
      throw new StaffChangeRefused(
        `More than one account uses ${address} (in different capitals). Sort that out before changing staff access.`,
      );
    }

    const user = eligible[0]!;
    const current = { userId: user.id, email: user.email ?? address };
    if (user.isStaff === on) return { ...current, isStaff: on, changed: false };

    await tx.update(users).set({ isStaff: on }).where(eq(users.id, user.id));
    // The entry names the account by id only. It belongs to no portrait, so
    // nothing removes it when the account is deleted; keeping the address out
    // means deleting an account still removes the person's email address.
    await tx.insert(auditLog).values({
      tenantId: null,
      userId: options.actorUserId ?? null,
      entity: STAFF_AUDIT_ENTITY,
      entityId: user.id,
      action: on ? STAFF_GRANT_ACTION : STAFF_REVOKE_ACTION,
      before: { is_staff: user.isStaff },
      after: { is_staff: on, ...(options.via ? { via: options.via } : {}) },
    });
    return { ...current, isStaff: on, changed: true };
  });
}

/** Everyone with staff access, by address, with when setStaff last granted it. */
export async function listStaff(db: DbExecutor): Promise<StaffMember[]> {
  // Spelled out with table names: drizzle leaves columns unqualified in a
  // select list, where audit_log.id would shadow users.id.
  const grantedAt = sql<Date | null>`(
    select max(a.ts) from audit_log a
     where a.tenant_id is null
       and a.entity = ${STAFF_AUDIT_ENTITY}
       and a.entity_id = "users"."id"
       and a.action = ${STAFF_GRANT_ACTION}
  )`.mapWith((value: string | Date | null) => (value == null ? null : new Date(value)));
  return db
    .select({ userId: users.id, email: users.email, name: users.name, grantedAt })
    .from(users)
    .where(eq(users.isStaff, true))
    .orderBy(asc(users.email));
}
