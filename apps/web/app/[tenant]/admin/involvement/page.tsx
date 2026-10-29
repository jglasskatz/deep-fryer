import type { Metadata } from 'next';
import Link from 'next/link';
import { linkHost, telHref } from '@deep-fryer/core';
import type { InvolvementListing } from '@deep-fryer/db';
import { SiteHeader } from '@/components/site-header/SiteHeader';
import { ActionButton } from '@/components/admin/ActionButton';
import { ListingEditDetails, ListingForm, type ListingFormListing } from '@/components/involvement/admin/ListingForm';
import { SubmissionActions } from '@/components/involvement/admin/SubmissionActions';
import { KIND_LABELS, dimensionName, dimensionsInWords } from '@/components/involvement/admin/labels';
import { requireAdminPage } from '@/lib/admin-guard';
import { adminPageMetadata } from '@/lib/page-meta';
import {
  SUBMISSION_STATUSES,
  SUBMISSIONS_PER_TAB,
  asSubmissionStatus,
  involvementAdminView,
  listingDraftFromSubmission,
  type SubmissionStatus,
  type SubmissionView,
} from '@/lib/involvement-admin';
import { deleteListing, markLinkChecked, setListingPublished } from '@/lib/involvement-admin-actions';
import { LOCALES } from '@/lib/i18n/locales';
import { requireFeature } from '@/lib/features';
import { safeHref } from '@/lib/safe-url';

export const dynamic = 'force-dynamic';

/** Get involved · Admin · <portrait> (WCAG 2.4.2): the generic site title named none of the staff pages. */
export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  return adminPageMetadata((await params).tenant, 'Get involved');
}

const STATUS_TAB: Record<SubmissionStatus, { tab: string; empty: string }> = {
  new: { tab: 'New', empty: 'No new submissions. Organizations reach this queue through the form on every dimension page.' },
  approved: { tab: 'Approved', empty: 'No approved submissions yet.' },
  declined: { tab: 'Declined', empty: 'No declined submissions.' },
  spam: { tab: 'Spam', empty: 'Nothing marked as spam.' },
};

const LANGUAGE_NAMES = new Map<string, string>(LOCALES.map((l) => [l.code, l.english]));

/** Staff timestamps: unambiguous, on the portrait's own clock, with the zone named. */
function when(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(date);
}

function day(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(date);
}

/**
 * A mailto: link only for an address that is plainly one — no characters a
 * mail client would read as extra headers (`?subject=…`, `&body=…`). The
 * public form already validated it; this keeps the page safe if a row ever
 * arrived some other way. Anything else is shown as text.
 */
function mailtoHref(email: string): string | undefined {
  return /^[^\s@?&#/:]+@[^\s@?&#/:]+\.[^\s@?&#/:]+$/.test(email) ? `mailto:${email}` : undefined;
}

function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn'; children: React.ReactNode }) {
  const tones = {
    neutral: 'bg-black/10',
    good: 'bg-green-100 text-green-900',
    warn: 'bg-amber-100 text-amber-900',
  };
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function ReviewSummary({
  submission,
  listingsById,
  timeZone,
}: {
  submission: SubmissionView;
  listingsById: Map<string, InvolvementListing>;
  timeZone: string;
}) {
  if (submission.status === 'new') return null;
  const at = submission.reviewedAt ? ` ${when(submission.reviewedAt, timeZone)}` : '';
  if (submission.status === 'approved') {
    const listing = submission.listingId ? listingsById.get(submission.listingId) : undefined;
    return (
      <p className="mt-2 text-sm">
        Approved{at}.{' '}
        {listing ? (
          <>
            Listing:{' '}
            <a className="underline" href={`#listing-${listing.id}`}>
              {listing.name}
            </a>{' '}
            <Chip tone={listing.published ? 'good' : 'neutral'}>{listing.published ? 'published' : 'draft'}</Chip>
          </>
        ) : (
          <span className="text-[color:var(--color-muted)]">Its listing has since been deleted.</span>
        )}
      </p>
    );
  }
  return (
    <div className="mt-2 text-sm">
      <p>
        {submission.status === 'spam' ? 'Marked as spam' : 'Declined'}
        {at}.
      </p>
      {submission.reviewNote ? (
        <p className="mt-0.5 whitespace-pre-line text-[color:var(--color-muted)]" dir="auto">
          Note: {submission.reviewNote}
        </p>
      ) : null}
    </div>
  );
}

function SubmissionCard({
  tenantSlug,
  dimensionOptions,
  submission: s,
  listingsById,
  timeZone,
}: {
  tenantSlug: string;
  dimensionOptions: {slug:string;name:string}[];
  submission: SubmissionView;
  listingsById: Map<string, InvolvementListing>;
  timeZone: string;
}) {
  const host = linkHost(s.website);
  const mailto = mailtoHref(s.email);
  const tel = telHref(s.phone);
  const language = LANGUAGE_NAMES.get(s.locale) ?? s.locale;
  // Submitted text may be in any language, including right-to-left ones
  // (Arabic, Urdu pages): dir="auto" lets each block take its own direction.
  return (
    <li className="rounded border border-black/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold" dir="auto">
          {s.orgName ?? 'A suggestion'}
        </h3>
        <p className="text-xs text-[color:var(--color-muted)]">
          Received {when(s.createdAt, timeZone)} · sent from the {language} page
        </p>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <Chip>{s.kind === 'listing' ? 'Organization' : 'Suggestion'}</Chip>
        <span>{s.dimensionSlug ? dimensionName(s.dimensionSlug) : 'Several / not sure'}</span>
      </p>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
        {s.about ? (
          <>
            <dt className="font-medium">Who they are</dt>
            <dd className="whitespace-pre-line" dir="auto">
              {s.about}
            </dd>
          </>
        ) : null}
        <dt className="font-medium">{s.kind === 'listing' ? 'Why it’s a good way to get involved' : 'Their suggestion'}</dt>
        <dd className="whitespace-pre-line" dir="auto">
          {s.pitch}
        </dd>
        {s.website ? (
          <>
            <dt className="font-medium">Website</dt>
            <dd>
              {/* Unreviewed: text, never a live link, until staff have checked it and approved. */}
              <span className="font-medium">{host ?? 'an address that does not parse'}</span>
              {s.website.startsWith('http://') ? (
                <span className="ms-2">
                  <Chip tone="warn">not https</Chip>
                </span>
              ) : null}
              <span className="mt-0.5 block break-all font-mono text-xs text-[color:var(--color-muted)]">{s.website}</span>
              <span className="block text-xs text-[color:var(--color-muted)]">
                Not a link until approved: type or paste it to check it first.
              </span>
            </dd>
          </>
        ) : null}
        <dt className="font-medium">Contact (staff only)</dt>
        <dd>
          <span dir="auto">{s.contactName}</span>
          {' · '}
          {mailto ? (
            <a className="underline" href={mailto}>
              {s.email}
            </a>
          ) : (
            <span className="break-all">{s.email}</span>
          )}
          {s.phone ? (
            <>
              {' · '}
              {tel ? (
                <a className="underline" href={tel}>
                  {s.phone}
                </a>
              ) : (
                <span>{s.phone}</span>
              )}
            </>
          ) : null}
        </dd>
      </dl>
      <ReviewSummary submission={s} listingsById={listingsById} timeZone={timeZone} />
      <div className="mt-3">
        <SubmissionActions
          tenantSlug={tenantSlug}
          dimensionOptions={dimensionOptions}
          submissionId={s.id}
          status={s.status}
          draft={listingDraftFromSubmission(s)}
        />
      </div>
    </li>
  );
}

function LinkCheck({ listing, timeZone }: { listing: InvolvementListing; timeZone: string }) {
  if (!listing.url) return <span className="text-xs text-[color:var(--color-muted)]">No link</span>;
  return listing.linkCheckedAt ? (
    <span className="text-xs">Link checked {day(listing.linkCheckedAt, timeZone)}</span>
  ) : (
    <Chip tone="warn">Link not checked</Chip>
  );
}

function ListingRow({ tenantSlug, dimensionOptions, listing: l, timeZone }: { tenantSlug: string; dimensionOptions:{slug:string;name:string}[]; listing: InvolvementListing; timeZone: string }) {
  const href = safeHref(l.url);
  const source = safeHref(l.sourceUrl);
  const tel = telHref(l.phone);
  const formListing: ListingFormListing = {
    id: l.id,
    name: l.name,
    description: l.description,
    url: l.url,
    phone: l.phone,
    kind: l.kind,
    dimensionSlugs: l.dimensionSlugs,
    sourceUrl: l.sourceUrl,
    displayOrder: l.displayOrder,
  };
  // Publishing a listing whose link nobody has opened puts an unchecked address in front of residents: ask first.
  const publishConfirm =
    !l.published && l.url && !l.linkCheckedAt
      ? `Nobody has checked the link for “${l.name}” yet. Publish anyway?`
      : undefined;
  return (
    <li id={`listing-${l.id}`} className="scroll-mt-4 rounded border border-black/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{l.name}</span>
            <Chip tone={l.published ? 'good' : 'neutral'}>{l.published ? 'published' : 'draft'}</Chip>
            <LinkCheck listing={l} timeZone={timeZone} />
          </p>
          <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
            {KIND_LABELS[l.kind].name} · {dimensionsInWords(l.dimensionSlugs)}
            {l.submissionId ? ' · from a submission' : ''}
          </p>
          <p className="mt-1 whitespace-pre-line">{l.description}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {href ? (
              <a className="underline" href={href} rel="noopener noreferrer">
                Open link ({linkHost(l.url) ?? l.url})
              </a>
            ) : null}
            {l.phone ? tel ? <a className="underline" href={tel}>{l.phone}</a> : <span>{l.phone}</span> : null}
            {source ? (
              <a className="underline" href={source} rel="noopener noreferrer">
                Source page ({linkHost(l.sourceUrl) ?? l.sourceUrl})
              </a>
            ) : null}
          </p>
        </div>
        <span className="flex flex-wrap items-start gap-2">
          {/* Every listing action revalidates this page, so its response already carries it: no refresh on top. */}
          <ActionButton
            action={setListingPublished.bind(null, { tenantSlug, id: l.id, published: !l.published })}
            pendingLabel="Saving…"
            confirm={publishConfirm}
            refresh={false}
          >
            {l.published ? 'Unpublish' : 'Publish'}
          </ActionButton>
          {l.url ? (
            <ActionButton
              action={markLinkChecked.bind(null, { tenantSlug, id: l.id })}
              pendingLabel="Saving…"
              refresh={false}
            >
              Link checked today
            </ActionButton>
          ) : null}
          <ActionButton
            action={deleteListing.bind(null, { tenantSlug, id: l.id })}
            pendingLabel="Deleting…"
            confirm={`Delete “${l.name}”? This cannot be undone.`}
            className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50"
            refresh={false}
          >
            Delete
          </ActionButton>
        </span>
      </div>
      {/* The form mounts only when Edit is opened; updatedAt remounts it with a changed listing's values. */}
      <ListingEditDetails tenantSlug={tenantSlug} dimensionOptions={dimensionOptions} listing={formListing} version={l.updatedAt.getTime()} />
    </li>
  );
}

/**
 * Staff review and curation for getting involved (SPEC-v6 §4.3).
 *
 * Submissions: what organizations and residents sent through the public
 * form, by status. Contact details are shown here (editors only — RLS) and
 * nowhere else; an unreviewed website is shown as its domain and full text,
 * never as a link, so nobody opens an unvetted address by accident.
 * Approving turns a submission into a listing staff have edited.
 *
 * Listings: everything residents can see under "How to get involved" once
 * published, plus drafts — including those a setup script proposed, with
 * the page each was taken from — with "Link checked today" for the date
 * residents are shown.
 */
export default async function InvolvementAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { tenant } = await params;
  await requireFeature(tenant, 'involvement');
  const status = asSubmissionStatus((await searchParams).status);
  const ctx = await requireAdminPage(tenant, 'editor', `/${tenant}/admin/involvement`);
  const view = await involvementAdminView(ctx.tenant, status);
  const slug = ctx.tenant.slug;
  const tz = view.timeZone;
  const listingsById = new Map(view.listings.map((l) => [l.id, l]));
  const publishedCount = view.listings.filter((l) => l.published).length;
  const shownTotal = view.counts[status];

  return (
    <>
      <SiteHeader variant="admin" tenant={{ slug, name: ctx.tenant.name }} />
      <main id="main" className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="text-sm">
          <Link className="underline" href={`/${slug}/admin`}>
            ← Admin
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold">Get involved</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted)]">
          Ways for residents to take part — programs, organizations, public bodies, campaigns — shown under &ldquo;How
          to get involved&rdquo; on each dimension page and on the public{' '}
          <Link className="underline" href={`/${slug}/outreach`}>
            Get involved page
          </Link>
          . Organizations put themselves forward through the form on those pages; nothing they send is public until an
          editor approves it here and the listing is published. Their contact details never leave this page, and they
          are not emailed. Every change is audited.
        </p>

        <section className="mt-8" aria-labelledby="submissions">
          <h2 id="submissions" className="text-lg font-semibold">
            Submissions
          </h2>
          <nav aria-label="Submissions by status" className="mt-3">
            <ul className="flex flex-wrap gap-2">
              {SUBMISSION_STATUSES.map((s) => {
                const current = s === status;
                return (
                  <li key={s}>
                    <Link
                      href={`/${slug}/admin/involvement?status=${s}#submissions`}
                      aria-current={current ? 'page' : undefined}
                      className={
                        current
                          ? 'inline-block rounded bg-black px-3 py-1.5 text-sm font-medium text-white'
                          : 'inline-block rounded border border-black/20 px-3 py-1.5 text-sm hover:bg-black/5'
                      }
                    >
                      {STATUS_TAB[s].tab} ({view.counts[s]})
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {view.submissions.length === 0 ? (
            <p className="mt-4 text-sm text-[color:var(--color-muted)]">{STATUS_TAB[status].empty}</p>
          ) : (
            <>
              {shownTotal > view.submissions.length ? (
                <p className="mt-3 text-xs text-[color:var(--color-muted)]">
                  Showing the newest {SUBMISSIONS_PER_TAB} of {shownTotal}.
                </p>
              ) : null}
              <ul className="mt-4 space-y-3">
                {view.submissions.map((s) => (
                  <SubmissionCard key={s.id} tenantSlug={slug} dimensionOptions={view.dimensionOptions} submission={s} listingsById={listingsById} timeZone={tz} />
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-12" aria-labelledby="listings">
          <h2 id="listings" className="text-lg font-semibold">
            Listings ({view.listings.length}, {publishedCount} published)
          </h2>
          <p className="mt-1 text-sm text-[color:var(--color-muted)]">
            In the order residents see them (order, then name). Only published listings are public. Open each link and
            press &ldquo;Link checked today&rdquo; — residents see the date — and check the source page of any listing a
            setup script proposed before publishing it. Listings are published in English.
          </p>
          {view.listings.length === 0 ? (
            <p className="mt-3 text-sm">No listings yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {view.listings.map((l) => (
                <ListingRow key={l.id} tenantSlug={slug} dimensionOptions={view.dimensionOptions} listing={l} timeZone={tz} />
              ))}
            </ul>
          )}
          <details className="mt-3 rounded border border-dashed border-black/20 p-3" open={view.listings.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">Add a listing</summary>
            <div className="mt-3">
              <ListingForm tenantSlug={slug} dimensionOptions={view.dimensionOptions} />
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
