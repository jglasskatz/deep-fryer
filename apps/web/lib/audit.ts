import { auditLog, getDb } from '@deep-fryer/db';
import { getAuth } from './auth';

/** Every mutation logs through this one path — actor resolution included. */
export async function audit(
  tenantId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const db = getDb();
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
