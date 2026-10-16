'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { involvementSubmissionInputSchema, SUBMISSION_LIMITS } from '@deep-fryer/core';
import { involvementSubmissions, tenantBySlug } from '@deep-fryer/db';
import { addressHash, clientAddress } from './client-address';
import { userDb } from './db';
import { portraitFeaturesById } from './features';
import { verifyFormToken } from './form-token';
import { getLocale } from './i18n/server';

/**
 * The public "put your organization forward" form (SPEC-v6 §4.2). No
 * account is needed — organizations should not have to sign up to be
 * listed — so the form defends itself in layers, cheapest first:
 *
 * 1. Honeypot: a field people never see. A filled one is a bot; it gets the
 *    same "thank you" a person gets, and nothing is stored, so it learns
 *    nothing to adapt to.
 * 2. Signed form token (lib/form-token.ts): proves the page was loaded from
 *    this server for this portrait, at least SUBMISSION_LIMITS.minFillMs
 *    before sending, and not a day ago.
 * 3. Validation by the shared core schema (lengths, a real email, http(s)
 *    website, organization details required for an organization).
 * 4. The portrait exists and is live.
 * 5. Rate limits per network address (hashed) and per email, counted by the
 *    SECURITY DEFINER involvement_submission_counts — the submitter's role
 *    cannot read the submissions table itself.
 * 6. Insert through userDb, so involvement_submissions_public_insert
 *    decides as well: a new row only, nothing a reviewer sets.
 *
 * And above all, nothing is published without a staff decision (§4.3). No
 * email is sent to the submitter, so the form cannot be used to send mail
 * to arbitrary addresses.
 *
 * Results are statuses, not English messages: this is a public-plane form,
 * and the client maps each status to the reader's language (m.involvement).
 * Contact details are never logged — not even inside an error, since a
 * Postgres CHECK violation's detail quotes the whole failing row.
 */

/** The form's fields, by the names the client sends and the schema uses. */
export type InvolvementField =
  | 'kind'
  | 'dimension_slug'
  | 'org_name'
  | 'about'
  | 'pitch'
  | 'website'
  | 'contact_name'
  | 'email'
  | 'phone';

export type SubmitInvolvementResult =
  | { status: 'thanks' }
  | { status: 'invalid'; fields: InvolvementField[] }
  | { status: 'tooFast' }
  | { status: 'rateLimited' }
  | { status: 'expired' }
  | { status: 'failed' };

export interface SubmitInvolvementInput {
  /** The portrait the form was shown on (also the token's scope). */
  tenantSlug: string;
  /** The signed form token the page rendered into the form. */
  token: string;
  /** The honeypot's value: empty from a person. */
  honeypot: string;
  /** The visible fields, as entered (validated here, never trusted). */
  fields: Partial<Record<InvolvementField, unknown>>;
}

const FIELD_NAMES = new Set<string>([
  'kind',
  'dimension_slug',
  'org_name',
  'about',
  'pitch',
  'website',
  'contact_name',
  'email',
  'phone',
] satisfies InvolvementField[]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Advisory-lock namespaces (the first key of pg_advisory_xact_lock(int, int))
 * for the two rate limits, so the counts and the insert are atomic per
 * address and per email: without them a burst of parallel requests would
 * all count the same "4 so far" and all be stored. The second key is a
 * hash of tenant + address/email; a collision only serializes two
 * unrelated submissions briefly. Locks are always taken address first, then
 * email, so two submissions can never wait on each other in a cycle.
 */
const LOCK_ADDRESS = 61_001;
const LOCK_EMAIL = 61_002;

export async function submitInvolvement(input: SubmitInvolvementInput): Promise<SubmitInvolvementResult> {
  try {
    // 1. Honeypot. Success-shaped on purpose (see above).
    if (typeof input?.honeypot === 'string' && input.honeypot.trim() !== '') return { status: 'thanks' };

    // 2. Form token. A token that is not ours — including one signed before
    //    a secret rotation or a dev-server restart — reads as an expired
    //    form: reloading the page is the fix in every case.
    const tenantSlug = typeof input?.tenantSlug === 'string' ? input.tenantSlug : '';
    if (!tenantSlug) return { status: 'failed' };
    const verdict = verifyFormToken(input.token, tenantSlug, Date.now());
    if (verdict === 'too_fast') return { status: 'tooFast' };
    if (verdict !== 'ok') return { status: 'expired' };

    // 3. Validation. Only known keys reach the schema; the client is told
    //    which fields to fix (each has its own label to point at), never the
    //    schema's English messages.
    const raw = Object.fromEntries(
      Object.entries(input.fields ?? {}).filter(([key]) => FIELD_NAMES.has(key)),
    );
    const parsed = involvementSubmissionInputSchema.safeParse(raw);
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues
            .map((issue) => String(issue.path[0] ?? ''))
            .filter((name): name is InvolvementField => FIELD_NAMES.has(name)),
        ),
      ];
      return { status: 'invalid', fields };
    }
    const data = parsed.data;

    const requestHeaders = await headers();
    const ipHash = addressHash(clientAddress(requestHeaders));
    const locale = await getLocale();
    const now = Date.now();

    return await userDb(async (db): Promise<SubmitInvolvementResult> => {
      // 4. A live portrait. The insert policy checks this too; asking first
      //    turns a policy violation into a clear "failed" without an error.
      const tenant = await tenantBySlug(db, tenantSlug);
      if (!tenant || tenant.archivedAt) return { status: 'failed' };
      // A portrait without the involvement feature has no form (SPEC-v7 §3);
      // a forged post to it stores nothing.
      if (!(await portraitFeaturesById(tenant.id)).involvement) return { status: 'failed' };

      // 5. Rate limits, under transaction-scoped advisory locks (released at
      //    commit or rollback; see LOCK_ADDRESS).
      const email = data.email.toLowerCase();
      await db.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_ADDRESS}::int, hashtext(${`${tenant.id}:${ipHash}`}))`);
      await db.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_EMAIL}::int, hashtext(${`${tenant.id}:${email}`}))`);
      const [counts] = await db.execute<{ by_ip: string | number; by_email: string | number }>(sql`
        SELECT by_ip, by_email FROM involvement_submission_counts(
          ${tenant.id}::uuid,
          ${ipHash},
          ${email},
          ${new Date(now - HOUR_MS).toISOString()}::timestamptz,
          ${new Date(now - DAY_MS).toISOString()}::timestamptz
        )`);
      if (
        Number(counts?.by_ip ?? 0) >= SUBMISSION_LIMITS.perAddressPerHour ||
        Number(counts?.by_email ?? 0) >= SUBMISSION_LIMITS.perEmailPerDay
      ) {
        return { status: 'rateLimited' };
      }

      // 6. Store it. No RETURNING: the submitter's role may insert the row
      //    but not read it back (migration 0010), and a RETURNING clause
      //    would make Postgres refuse the whole insert.
      await db.insert(involvementSubmissions).values({
        tenantId: tenant.id,
        kind: data.kind,
        dimensionSlug: data.dimension_slug,
        orgName: data.org_name,
        about: data.about,
        pitch: data.pitch,
        website: data.website,
        contactName: data.contact_name,
        email: data.email,
        phone: data.phone,
        locale,
        ipHash,
      });
      return { status: 'thanks' };
    });
  } catch (err) {
    unstable_rethrow(err);
    // The error's code and constraint say what went wrong; its message and
    // detail may quote the submitted row, contact details included.
    const e = (err ?? {}) as { code?: unknown; constraint_name?: unknown; name?: unknown };
    console.error('[involvement] submission failed', {
      name: typeof e.name === 'string' ? e.name : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
      constraint: typeof e.constraint_name === 'string' ? e.constraint_name : undefined,
    });
    return { status: 'failed' };
  }
}
