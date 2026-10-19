import 'server-only';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { framework } from '@deep-fryer/contract';
import {
  DEFAULT_EMERGENCY_TIME_ZONE,
  INVOLVEMENT_LIMITS,
  emergencyConfigSchema,
  httpsUrlSchema,
  type InvolvementKind,
  type InvolvementListingInput,
  type InvolvementSubmissionKind,
} from '@deep-fryer/core';
import {
  involvementListings,
  involvementSubmissions,
  tenantConfig,
  type DbExecutor,
  type InvolvementListing,
  type Tenant,
} from '@deep-fryer/db';
import { userDb } from './db';

/**
 * Staff reads for getting involved (SPEC-v6 §4.3): the submission review
 * queue and every listing, published or not.
 *
 * Everything runs in userDb, so row-level security (migration 0010) is the
 * gate: submissions — which hold an organization's private contact details —
 * are readable only by the portrait's editors, and members read draft
 * listings. A caller below editor therefore sees no submissions at all
 * rather than an error; the admin page is editor-only anyway
 * (requireAdminPage), and countNewSubmissions quietly answers 0 for a
 * moderator or viewer, which is exactly what their overview should show.
 *
 * The keyed hash of the submitter's network address is never selected: it
 * exists for the public form's rate limits only, and staff have no use for it.
 */

/** Where a submission stands in staff review, in the order the page's tabs show them. */
export const SUBMISSION_STATUSES = ['new', 'approved', 'declined', 'spam'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/**
 * The most submissions one tab lists. A healthy queue is a handful of rows;
 * the cap only bounds the page when a spam wave slips past the form's rate
 * limits, and the tab's count still says how many there are in total.
 */
export const SUBMISSIONS_PER_TAB = 100;

/** The status a `?status=` query names, or "new" (the queue staff work from) when it names none. */
export function asSubmissionStatus(value: string | string[] | undefined): SubmissionStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  return (SUBMISSION_STATUSES as readonly string[]).includes(raw ?? '') ? (raw as SubmissionStatus) : 'new';
}

/** One submission as the review page shows it: everything the form collected except the address hash. */
export interface SubmissionView {
  id: string;
  kind: InvolvementSubmissionKind;
  /** Framework dimension slug, or null for "several / not sure". */
  dimensionSlug: string | null;
  orgName: string | null;
  about: string | null;
  pitch: string;
  /** Unreviewed: shown to staff as text, never as a live link. */
  website: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  /** The language the public form was shown in (a LOCALES code). */
  locale: string;
  status: SubmissionStatus;
  reviewNote: string | null;
  reviewedAt: Date | null;
  /** The listing an approval created; null once that listing is deleted. */
  listingId: string | null;
  createdAt: Date;
}

export interface InvolvementAdminView {
  /** The tab being shown. */
  status: SubmissionStatus;
  /** Submissions per status, for the tab labels (every status present, 0 when none). */
  counts: Record<SubmissionStatus, number>;
  /** The selected tab's submissions, newest first, at most SUBMISSIONS_PER_TAB. */
  submissions: SubmissionView[];
  /** Every listing on the portrait, published or not, in the order residents see them. */
  listings: InvolvementListing[];
  /**
   * The portrait's own clock for staff timestamps — the time zone set in the
   * emergency settings (the one per-portrait zone there is), or New York's
   * until an owner sets one. A server in UTC must not print "received 2:14 AM"
   * for a submission that arrived at 10:14 PM local time.
   */
  timeZone: string;
}

const submissionColumns = {
  id: involvementSubmissions.id,
  kind: involvementSubmissions.kind,
  dimensionSlug: involvementSubmissions.dimensionSlug,
  orgName: involvementSubmissions.orgName,
  about: involvementSubmissions.about,
  pitch: involvementSubmissions.pitch,
  website: involvementSubmissions.website,
  contactName: involvementSubmissions.contactName,
  email: involvementSubmissions.email,
  phone: involvementSubmissions.phone,
  locale: involvementSubmissions.locale,
  status: involvementSubmissions.status,
  reviewNote: involvementSubmissions.reviewNote,
  reviewedAt: involvementSubmissions.reviewedAt,
  listingId: involvementSubmissions.listingId,
  createdAt: involvementSubmissions.createdAt,
};

async function submissionCounts(db: DbExecutor, tenantId: string): Promise<Record<SubmissionStatus, number>> {
  const rows = await db
    .select({ status: involvementSubmissions.status, n: count() })
    .from(involvementSubmissions)
    .where(eq(involvementSubmissions.tenantId, tenantId))
    .groupBy(involvementSubmissions.status);
  const counts: Record<SubmissionStatus, number> = { new: 0, approved: 0, declined: 0, spam: 0 };
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}

async function portraitTimeZone(db: DbExecutor, tenantId: string): Promise<string> {
  const [row] = await db
    .select({ value: tenantConfig.value })
    .from(tenantConfig)
    .where(and(eq(tenantConfig.tenantId, tenantId), eq(tenantConfig.key, 'emergency')));
  // A saved config that no longer validates falls back to the default, as the emergency page does.
  const parsed = row ? emergencyConfigSchema.safeParse(row.value) : null;
  return parsed?.success ? parsed.data.time_zone : DEFAULT_EMERGENCY_TIME_ZONE;
}

/** Everything /{tenant}/admin/involvement shows, read in one transaction as the signed-in editor. */
export async function involvementAdminView(tenant: Tenant, status: SubmissionStatus): Promise<InvolvementAdminView> {
  return userDb(async (db) => {
    // One transaction is one connection: these run in sequence, not in parallel.
    const counts = await submissionCounts(db, tenant.id);
    const submissions = await db
      .select(submissionColumns)
      .from(involvementSubmissions)
      .where(and(eq(involvementSubmissions.tenantId, tenant.id), eq(involvementSubmissions.status, status)))
      // The id breaks ties so two submissions in the same instant keep a stable order across refreshes.
      .orderBy(desc(involvementSubmissions.createdAt), desc(involvementSubmissions.id))
      .limit(SUBMISSIONS_PER_TAB);
    const listings = await db
      .select()
      .from(involvementListings)
      .where(eq(involvementListings.tenantId, tenant.id))
      .orderBy(asc(involvementListings.displayOrder), asc(involvementListings.name));
    const timeZone = await portraitTimeZone(db, tenant.id);
    return { status, counts, submissions, listings, timeZone };
  });
}

/**
 * New submissions waiting for a decision, for the admin overview's callout
 * and the admin navigation. 0 for anyone below editor (RLS hides the rows).
 */
export async function countNewSubmissions(tenantId: string): Promise<number> {
  return userDb(async (db) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(involvementSubmissions)
      .where(and(eq(involvementSubmissions.tenantId, tenantId), eq(involvementSubmissions.status, 'new')));
    return row?.n ?? 0;
  });
}

// ---- Approving: the listing form's starting point ------------------------------------------

const FRAMEWORK_SLUGS = new Set(framework.dimensions.map((d) => d.slug));

/**
 * Cut text to at most `max` characters for a listing field, preferring a
 * word boundary and marking the cut with an ellipsis so staff can see the
 * text was shortened. Never splits a UTF-16 surrogate pair (an emoji cut in
 * half would reach Postgres as a replacement character).
 */
export function trimToLimit(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max - 1);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut = cut.slice(0, -1);
  // Back up to the last space only when that keeps most of the text; one
  // very long "word" (a pasted link) is cut where it is.
  const space = cut.search(/\s\S*$/);
  if (space > max * 0.8) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}

/** The submission fields approval reads. */
export type SubmissionForListing = Pick<SubmissionView, 'kind' | 'dimensionSlug' | 'orgName' | 'pitch' | 'website'>;

/**
 * The listing form's starting values when staff approve a submission. Staff
 * edit before saving; these only spare them retyping.
 *
 * - name: the organization's name (a suggestion has none, so staff name it);
 * - description: the pitch, cut to a listing's 600-character limit;
 * - url: the website only if it is https — listings link only to https, and
 *   an http site is left for staff to convert after checking it;
 * - kind: an organization offering itself is "join a group" (organize);
 *   a suggestion could be anything, so "other" until staff choose;
 * - dimensions: the one the submitter chose, or none (= every dimension)
 *   for "several / not sure";
 * - phone stays empty: the submission's phone is the contact person's,
 *   which is never published;
 * - unpublished: approving creates the listing, publishing is a second,
 *   explicit choice ("Publish now").
 *
 * Typed as the schema's output (every field concrete) because it is the
 * form's starting state, not something saved as is: a suggestion's empty
 * name, for one, would not validate until staff fill it in.
 */
export function listingDraftFromSubmission(sub: SubmissionForListing): InvolvementListingInput {
  const website = sub.website?.trim() ?? '';
  const kind: InvolvementKind = sub.kind === 'listing' ? 'organize' : 'other';
  return {
    name: trimToLimit(sub.orgName ?? '', INVOLVEMENT_LIMITS.name),
    description: trimToLimit(sub.pitch, INVOLVEMENT_LIMITS.description),
    url: website && httpsUrlSchema.safeParse(website).success ? website : null,
    phone: null,
    kind,
    dimension_slugs: sub.dimensionSlug && FRAMEWORK_SLUGS.has(sub.dimensionSlug) ? [sub.dimensionSlug] : [],
    source_url: null,
    display_order: 0,
    published: false,
  };
}
