import type { Task } from 'graphile-worker';
import { getDb, pruneExpiredSignInRecords } from '@deep-fryer/db';

/**
 * PRIVACY_SWEEP_TASK (@deep-fryer/research), every quarter hour: delete the
 * sign-in records the privacy notice says are not kept — sign-in requests'
 * network-address hashes once they leave the limit's one-hour window, and
 * unused sign-in links (with the email address each was sent to) once they
 * expire. The deletes are packages/db pruneExpiredSignInRecords; this task
 * only runs them on the schedule and logs what went, never who.
 *
 * It runs on the worker's housekeeping runner (runners.ts), never behind a
 * research session, so the schedule holds however long research takes.
 */
export const privacySweep: Task = async (_payload, helpers) => {
  const swept = await pruneExpiredSignInRecords(getDb());
  if (swept.signInRequests || swept.verificationTokens) {
    helpers.logger.info(
      `privacy_sweep: ${swept.signInRequests} sign-in request(s) past the limit's window, ${swept.verificationTokens} expired sign-in link(s) deleted`,
    );
  }
};
