import 'server-only';
import { auditLog, type DbExecutor } from '@deep-fryer/db';
import { getAuth } from './auth';
import { systemDb } from './db';

/**
 * Every mutation logs through this one path — actor resolution included.
 * Pass the action's transaction (`db`) so the change and its audit record
 * commit or roll back together; under the user role the audit_log insert
 * policy additionally requires the actor to be a member of the tenant.
 * Without `db` the entry is written in the system context.
 */
export async function audit(
  tenantId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
  db: DbExecutor = systemDb(),
): Promise<void> {
  const auth = await getAuth();
  await db.insert(auditLog).values({
    tenantId,
    userId: auth.userId,
    entity,
    entityId,
    action,
    before: before ?? null,
    after: after ?? null,
  });
}
