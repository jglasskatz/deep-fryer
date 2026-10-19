'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  INVOLVEMENT_LIMITS,
  involvementListingInputSchema,
  type InvolvementListingInput,
  type InvolvementListingInputDraft,
} from '@deep-fryer/core';
import { involvementListings, involvementSubmissions, type DbExecutor, type Tenant } from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { getAuth } from './auth';
import { requireTenantRoleWithFeature } from './features';
import { userDb } from './db';

/**
 * Staff curation of getting involved (SPEC-v6 §4.3): the listings residents
 * see under "How to get involved", and the review of what organizations send
 * through the public form.
 *
 * Every action needs the editor role, checked first in the app
 * (requireTenantRole) and then again by the database: writes run through
 * userDb, where migration 0010's policies let only editors write listings
 * and read or change submissions. Inputs are validated by the shared core
 * schema (the NYC seed script uses the same one), every change is audited in
 * the same transaction, and the admin page plus the public pages that show
 * listings — the Get involved page and every dimension page — are revalidated.
 *
 * Two rules carried over from the emergency curation (emergency-actions.ts):
 *
 * - Visibility has one writer per listing. A listing may be published when
 *   it is created (or approved), and afterwards only setListingPublished
 *   changes it; saveListing's edit path ignores `published`, so an edit form
 *   opened before someone pressed Publish cannot silently undo it.
 * - "Link checked" is a claim about one address. Editing a listing's link
 *   clears the stamp, because residents read "Checked by staff on …" as a
 *   statement about the link in front of them, not an earlier one.
 *
 * Contact details stay out of the audit log. They live only in the
 * submissions table, readable by editors; audit entries for a submission
 * record the review decision (status, note, listing), never the submitter's
 * name, email, or phone.
 */

const idSchema = z.string().uuid('unknown record');

// Edits never carry visibility (see above); zod drops the key if sent.
const listingUpdateSchema = involvementListingInputSchema.omit({ published: true });

/** An optional staff note on a decline or spam decision: '' and whitespace mean none. */
const reviewNoteSchema = z
  .string()
  .trim()
  .max(INVOLVEMENT_LIMITS.reviewNote, `keep the note under ${INVOLVEMENT_LIMITS.reviewNote} characters`)
  .nullish()
  .transform((note) => note || null);

function revalidate(tenant: Tenant) {
  revalidatePath(`/${tenant.slug}/admin/involvement`);
  // The overview counts new submissions.
  revalidatePath(`/${tenant.slug}/admin`);
  revalidatePath(`/${tenant.slug}/outreach`);
  // Every dimension page lists the listings that serve it (or all of them).
  revalidatePath(`/${tenant.slug}/dim`, 'layout');
}

/** Postgres unique_violation: a second listing with the same name racing the pre-check. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

const duplicateName = (name: string) =>
  new UserError(`A listing named “${name}” already exists on this portrait. Edit that one, or choose another name.`);

/**
 * Listing names are unique per portrait. The database's constraint is
 * exact; this check also ignores case, because "Food Bank" and "food bank"
 * side by side would read to residents as the same thing listed twice.
 */
async function assertNameFree(db: DbExecutor, tenantId: string, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: involvementListings.id })
    .from(involvementListings)
    .where(
      and(
        eq(involvementListings.tenantId, tenantId),
        sql`lower(${involvementListings.name}) = lower(${name})`,
        exceptId ? ne(involvementListings.id, exceptId) : undefined,
      ),
    );
  if (clash) throw duplicateName(name);
}

function listingValues(listing: Omit<InvolvementListingInput, 'published'>) {
  return {
    name: listing.name,
    description: listing.description,
    url: listing.url,
    phone: listing.phone,
    kind: listing.kind,
    dimensionSlugs: listing.dimension_slugs,
    sourceUrl: listing.source_url,
    displayOrder: listing.display_order,
  };
}

// ---- Listings --------------------------------------------------------------------------------

/**
 * Create a listing (no `id`) or edit one (`id`). On an edit, `published` is
 * ignored (see the module comment) and a changed link clears its
 * "link checked" date.
 */
export const saveListing = action(
  async (input: { tenantSlug: string; id?: string | null; listing: InvolvementListingInputDraft }) => {
    const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
    const auth = await getAuth();

    if (!input.id) {
      const listingInput = involvementListingInputSchema.parse(input.listing);
      const id = await userDb(async (db) => {
        await assertNameFree(db, tenant.id, listingInput.name);
        const [row] = await db
          .insert(involvementListings)
          .values({ tenantId: tenant.id, ...listingValues(listingInput), published: listingInput.published, createdBy: auth.userId })
          .returning()
          .catch((err) => {
            throw isUniqueViolation(err) ? duplicateName(listingInput.name) : err;
          });
        await audit(tenant.id, 'involvement_listing', row!.id, 'create', null, row, db);
        return row!.id;
      });
      revalidate(tenant);
      return { id };
    }

    const id = idSchema.parse(input.id);
    const listingInput = listingUpdateSchema.parse(input.listing);
    await userDb(async (db) => {
      const [before] = await db
        .select()
        .from(involvementListings)
        .where(and(eq(involvementListings.id, id), eq(involvementListings.tenantId, tenant.id)));
      if (!before) throw new UserError('Unknown listing.');
      await assertNameFree(db, tenant.id, listingInput.name, before.id);
      const linkChanged = (listingInput.url ?? null) !== (before.url ?? null);
      const [after] = await db
        .update(involvementListings)
        .set({
          ...listingValues(listingInput),
          ...(linkChanged ? { linkCheckedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(involvementListings.id, before.id))
        .returning()
        .catch((err) => {
          throw isUniqueViolation(err) ? duplicateName(listingInput.name) : err;
        });
      await audit(tenant.id, 'involvement_listing', before.id, 'update', before, after, db);
    });
    revalidate(tenant);
    return { id };
  },
);

export const deleteListing = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
  const id = idSchema.parse(input.id);
  await userDb(async (db) => {
    const [before] = await db
      .delete(involvementListings)
      .where(and(eq(involvementListings.id, id), eq(involvementListings.tenantId, tenant.id)))
      .returning();
    if (!before) throw new UserError('Unknown listing.');
    // The submission it was approved from stays approved (that decision was
    // made), but no longer points at a listing that does not exist; the
    // review page then says its listing was deleted.
    if (before.submissionId) {
      await db
        .update(involvementSubmissions)
        .set({ listingId: null })
        .where(and(eq(involvementSubmissions.id, before.submissionId), eq(involvementSubmissions.tenantId, tenant.id)));
    }
    await audit(tenant.id, 'involvement_listing', before.id, 'delete', before, null, db);
  });
  revalidate(tenant);
});

/** The row's Publish / Unpublish button: one field, without resending the whole listing. */
export const setListingPublished = action(
  async (input: { tenantSlug: string; id: string; published: boolean }) => {
    const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
    const id = idSchema.parse(input.id);
    const published = z.boolean().parse(input.published);
    await userDb(async (db) => {
      const [row] = await db
        .update(involvementListings)
        .set({ published, updatedAt: new Date() })
        .where(and(eq(involvementListings.id, id), eq(involvementListings.tenantId, tenant.id)))
        .returning({ id: involvementListings.id });
      if (!row) throw new UserError('Unknown listing.');
      await audit(
        tenant.id,
        'involvement_listing',
        row.id,
        published ? 'publish' : 'unpublish',
        { published: !published },
        { published },
        db,
      );
    });
    revalidate(tenant);
  },
);

/**
 * "Link checked today": a staff member opened the listing's link and it
 * still goes where the listing says. Residents see the date ("Checked by
 * staff on …"). The database's clock stamps it, so every server agrees.
 */
export const markLinkChecked = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
  const id = idSchema.parse(input.id);
  await userDb(async (db) => {
    const [before] = await db
      .select({ id: involvementListings.id, url: involvementListings.url, linkCheckedAt: involvementListings.linkCheckedAt })
      .from(involvementListings)
      .where(and(eq(involvementListings.id, id), eq(involvementListings.tenantId, tenant.id)));
    if (!before) throw new UserError('Unknown listing.');
    if (!before.url) throw new UserError('This listing has no link to check.');
    const [after] = await db
      .update(involvementListings)
      .set({ linkCheckedAt: sql`now()`, updatedAt: new Date() })
      .where(eq(involvementListings.id, before.id))
      .returning({ linkCheckedAt: involvementListings.linkCheckedAt });
    await audit(
      tenant.id,
      'involvement_listing',
      before.id,
      'link_checked',
      { link_checked_at: before.linkCheckedAt },
      { link_checked_at: after!.linkCheckedAt, url: before.url },
      db,
    );
  });
  revalidate(tenant);
});

// ---- Submissions ------------------------------------------------------------------------------

/** Lock a submission row for the rest of the transaction, so two reviewers cannot both decide it. */
async function lockSubmission(db: DbExecutor, tenantId: string, id: string) {
  const [row] = await db
    .select({
      id: involvementSubmissions.id,
      status: involvementSubmissions.status,
      reviewNote: involvementSubmissions.reviewNote,
    })
    .from(involvementSubmissions)
    .where(and(eq(involvementSubmissions.id, id), eq(involvementSubmissions.tenantId, tenantId)))
    .for('update');
  if (!row) throw new UserError('Unknown submission.');
  return row;
}

const STATUS_WORDS = { new: 'new', approved: 'approved', declined: 'declined', spam: 'marked as spam' } as const;

/**
 * Approve a submission: create the listing staff edited from it and mark the
 * submission approved, in one transaction — either both happen or neither
 * (a duplicate listing name, say, leaves the submission in the queue).
 * Only a new submission can be approved; a second reviewer pressing Approve
 * on the same one is told it was already decided.
 */
export const approveSubmission = action(
  async (input: { tenantSlug: string; submissionId: string; listing: InvolvementListingInputDraft }) => {
    const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
    const submissionId = idSchema.parse(input.submissionId);
    const listingInput = involvementListingInputSchema.parse(input.listing);
    const auth = await getAuth();
    const listingId = await userDb(async (db) => {
      const submission = await lockSubmission(db, tenant.id, submissionId);
      if (submission.status !== 'new') {
        throw new UserError(`This submission was already ${STATUS_WORDS[submission.status]}.`);
      }
      await assertNameFree(db, tenant.id, listingInput.name);
      const [listing] = await db
        .insert(involvementListings)
        .values({
          tenantId: tenant.id,
          ...listingValues(listingInput),
          published: listingInput.published,
          submissionId: submission.id,
          createdBy: auth.userId,
        })
        .returning()
        .catch((err) => {
          throw isUniqueViolation(err) ? duplicateName(listingInput.name) : err;
        });
      await db
        .update(involvementSubmissions)
        .set({ status: 'approved', reviewedBy: auth.userId, reviewedAt: sql`now()`, listingId: listing!.id })
        .where(eq(involvementSubmissions.id, submission.id));
      await audit(tenant.id, 'involvement_listing', listing!.id, 'create', null, listing, db);
      await audit(
        tenant.id,
        'involvement_submission',
        submission.id,
        'approve',
        { status: submission.status },
        { status: 'approved', listing_id: listing!.id },
        db,
      );
      return listing!.id;
    });
    revalidate(tenant);
    return { listingId };
  },
);

/**
 * Decline a new submission, or mark it as spam, with an optional note for
 * other staff (never shown to the submitter — nothing is sent to them).
 * An approved submission cannot be declined: its listing is the decision,
 * and unpublishing or deleting that listing is how to undo it.
 */
export const reviewSubmission = action(
  async (input: { tenantSlug: string; submissionId: string; status: 'declined' | 'spam'; note?: string | null }) => {
    const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
    const submissionId = idSchema.parse(input.submissionId);
    const status = z.enum(['declined', 'spam']).parse(input.status);
    const note = reviewNoteSchema.parse(input.note);
    const auth = await getAuth();
    await userDb(async (db) => {
      const submission = await lockSubmission(db, tenant.id, submissionId);
      if (submission.status !== 'new') {
        throw new UserError(
          submission.status === 'approved'
            ? 'This submission was already approved. Unpublish or delete its listing instead.'
            : `This submission was already ${STATUS_WORDS[submission.status]}. Move it back to New first to change that.`,
        );
      }
      await db
        .update(involvementSubmissions)
        .set({ status, reviewNote: note, reviewedBy: auth.userId, reviewedAt: sql`now()` })
        .where(eq(involvementSubmissions.id, submission.id));
      await audit(
        tenant.id,
        'involvement_submission',
        submission.id,
        status === 'spam' ? 'mark_spam' : 'decline',
        { status: submission.status },
        { status, review_note: note },
        db,
      );
    });
    revalidate(tenant);
  },
);

/**
 * Undo a decline or a spam mark (a staff mistake): the submission goes back
 * to New with its review cleared, as if it had just arrived. The audit log
 * keeps the earlier decision.
 */
export const reopenSubmission = action(async (input: { tenantSlug: string; submissionId: string }) => {
  const { tenant } = await requireTenantRoleWithFeature(input.tenantSlug, 'editor', 'involvement');
  const submissionId = idSchema.parse(input.submissionId);
  await userDb(async (db) => {
    const submission = await lockSubmission(db, tenant.id, submissionId);
    if (submission.status === 'new') throw new UserError('This submission is already new.');
    if (submission.status === 'approved') {
      throw new UserError('An approved submission has a listing. Unpublish or delete the listing instead.');
    }
    await db
      .update(involvementSubmissions)
      .set({ status: 'new', reviewNote: null, reviewedBy: null, reviewedAt: null })
      .where(eq(involvementSubmissions.id, submission.id));
    await audit(
      tenant.id,
      'involvement_submission',
      submission.id,
      'reopen',
      { status: submission.status, review_note: submission.reviewNote },
      { status: 'new' },
      db,
    );
  });
  revalidate(tenant);
});
