'use client';

import { useState } from 'react';
import { framework } from '@deep-fryer/contract';
import {
  INVOLVEMENT_LIMITS,
  type InvolvementKind,
  type InvolvementListingInput,
  type InvolvementListingInputDraft,
} from '@deep-fryer/core';
import { approveSubmission, saveListing } from '@/lib/involvement-admin-actions';
import { useAction } from '@/lib/use-action';
import { KIND_OPTIONS, RINGS } from './labels';

/**
 * The one listing form on /{tenant}/admin/involvement (English, like every
 * staff page), used three ways:
 *
 * - add a listing (no `listing`, no `approve`);
 * - edit a listing (`listing`) — visibility is not part of an edit: the
 *   row's Publish / Unpublish button is its only writer, so this form has no
 *   "Publish now" box and the server ignores `published` on edits;
 * - approve a submission (`approve`) — prefilled from the submission on the
 *   server (listingDraftFromSubmission), so staff edit the organization's
 *   words into a listing before anything is created.
 *
 * It posts through useAction, which shows the server's validation message
 * (from the shared core schema) and refreshes the page on success. The
 * client only shapes input (empty fields become null, checkboxes a list);
 * the server decides what is valid.
 *
 * Like the emergency forms, an edit form copies its listing into local
 * state once; the page keys it by the listing's id and updatedAt, so a
 * refresh bringing a changed listing remounts it with the new values.
 */

/** What the edit form needs of a listing (a plain object, so it crosses the server/client boundary as-is). */
export interface ListingFormListing {
  id: string;
  name: string;
  description: string;
  url: string | null;
  phone: string | null;
  kind: InvolvementKind;
  dimensionSlugs: string[];
  sourceUrl: string | null;
  displayOrder: number;
}

const field = 'w-full rounded border border-black/20 bg-white px-2 py-1 text-sm';
const label = 'block text-sm';
const hint = 'mt-0.5 block text-xs text-[color:var(--color-muted)]';

const orNull = (s: string) => (s.trim() ? s.trim() : null);

interface FormState {
  name: string;
  description: string;
  url: string;
  phone: string;
  kind: InvolvementKind;
  dimensions: string[];
  sourceUrl: string;
  displayOrder: number;
  published: boolean;
}

const BLANK: FormState = {
  name: '',
  description: '',
  url: '',
  phone: '',
  kind: 'volunteer',
  dimensions: [],
  sourceUrl: '',
  displayOrder: 0,
  published: false,
};

function fromListing(l: ListingFormListing): FormState {
  return {
    name: l.name,
    description: l.description,
    url: l.url ?? '',
    phone: l.phone ?? '',
    kind: l.kind,
    dimensions: l.dimensionSlugs,
    sourceUrl: l.sourceUrl ?? '',
    displayOrder: l.displayOrder,
    published: false,
  };
}

function fromDraft(d: InvolvementListingInput): FormState {
  return {
    name: d.name,
    description: d.description,
    url: d.url ?? '',
    phone: d.phone ?? '',
    kind: d.kind,
    dimensions: d.dimension_slugs,
    sourceUrl: d.source_url ?? '',
    displayOrder: d.display_order,
    published: d.published,
  };
}

export function ListingForm({
  tenantSlug,
  listing,
  approve,
  onCancel,
}: {
  tenantSlug: string;
  listing?: ListingFormListing;
  approve?: { submissionId: string; draft: InvolvementListingInput };
  /** Shown as a Cancel button beside Save (the approve form closes back to the submission). */
  onCancel?: () => void;
}) {
  const { run, pending, error } = useAction();
  const [saved, setSaved] = useState(false);
  const start = listing ? fromListing(listing) : approve ? fromDraft(approve.draft) : BLANK;
  const [s, set] = useState<FormState>(start);
  // Ids must be unique on a page that holds many of these forms at once.
  const prefix = listing ? `il-${listing.id}` : approve ? `ia-${approve.submissionId}` : 'il-new';
  const isNew = !listing;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        const input: InvolvementListingInputDraft = {
          name: s.name,
          description: s.description,
          url: orNull(s.url),
          phone: orNull(s.phone),
          kind: s.kind,
          dimension_slugs: s.dimensions,
          source_url: orNull(s.sourceUrl),
          display_order: s.displayOrder,
          // Ignored by the server on an edit (see above).
          published: isNew ? s.published : undefined,
        };
        run(async () => {
          const r = approve
            ? await approveSubmission({ tenantSlug, submissionId: approve.submissionId, listing: input })
            : await saveListing({ tenantSlug, id: listing?.id ?? null, listing: input });
          if (r.ok) {
            setSaved(true);
            if (!listing && !approve) set(BLANK);
          }
          return r;
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span className="font-medium">Name</span>
          <input
            className={field}
            required
            maxLength={INVOLVEMENT_LIMITS.name}
            value={s.name}
            onChange={(e) => set({ ...s, name: e.target.value })}
            placeholder="NYC Service"
          />
          <span className={hint}>The program, organization, or public body, as residents would search for it.</span>
        </label>
        <label className={label}>
          <span className="font-medium">Kind</span>
          <select className={field} value={s.kind} onChange={(e) => set({ ...s, kind: e.target.value as InvolvementKind })}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.name} — {k.meaning}
              </option>
            ))}
          </select>
          <span className={hint}>Residents see the kind in their own language, worded for them.</span>
        </label>
        <label className={label}>
          <span className="font-medium">Link</span>
          <input
            className={field}
            type="url"
            maxLength={INVOLVEMENT_LIMITS.website}
            value={s.url}
            onChange={(e) => set({ ...s, url: e.target.value })}
            placeholder="https://… (optional)"
          />
          <span className={hint}>
            https only. The page residents open to take part; changing it clears &ldquo;link checked&rdquo;.
          </span>
        </label>
        <label className={label}>
          <span className="font-medium">Phone</span>
          <input
            className={field}
            type="tel"
            value={s.phone}
            onChange={(e) => set({ ...s, phone: e.target.value })}
            placeholder="311 (optional)"
          />
          <span className={hint}>A public number residents can call — never a submitter&rsquo;s own contact number.</span>
        </label>
      </div>
      <label className={label}>
        <span className="font-medium">What people can do</span>
        <textarea
          className={field}
          rows={3}
          required
          maxLength={INVOLVEMENT_LIMITS.description}
          value={s.description}
          onChange={(e) => set({ ...s, description: e.target.value })}
        />
        <span className={hint}>
          Plain language, for residents; published in English. {s.description.length} / {INVOLVEMENT_LIMITS.description}{' '}
          characters.
        </span>
      </label>
      <fieldset className="rounded border border-black/10 p-3">
        <legend className="px-1 text-sm font-medium">Dimensions it serves</legend>
        <p className="text-xs text-[color:var(--color-muted)]">
          Leave all unchecked for a listing that serves every dimension: it then appears on every dimension page, after
          the listings made for that dimension.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {RINGS.map(({ ring, title }) => (
            <div key={ring}>
              <p className="text-xs font-medium text-[color:var(--color-muted)]">{title}</p>
              <ul className="mt-1 space-y-1">
                {framework.dimensions
                  .filter((d) => d.ring === ring)
                  .map((d) => {
                    const id = `${prefix}-dim-${d.slug}`;
                    return (
                      <li key={d.slug} className="flex items-center gap-2 text-sm">
                        <input
                          id={id}
                          type="checkbox"
                          checked={s.dimensions.includes(d.slug)}
                          onChange={(e) =>
                            set({
                              ...s,
                              dimensions: e.target.checked
                                ? [...s.dimensions, d.slug]
                                : s.dimensions.filter((slug) => slug !== d.slug),
                            })
                          }
                        />
                        <label htmlFor={id}>{d.name}</label>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>
      <label className={label}>
        <span className="font-medium">Source page</span>
        <input
          className={field}
          type="url"
          value={s.sourceUrl}
          onChange={(e) => set({ ...s, sourceUrl: e.target.value })}
          placeholder="https://… (optional)"
        />
        <span className={hint}>Where these details came from, for staff checking them later. Not shown to residents.</span>
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Order</span>
          <input
            className="w-20 rounded border border-black/20 bg-white px-2 py-1 text-sm"
            type="number"
            min={0}
            max={10000}
            value={s.displayOrder}
            onChange={(e) => set({ ...s, displayOrder: Number(e.target.value) || 0 })}
          />
        </label>
        {isNew ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.published} onChange={(e) => set({ ...s, published: e.target.checked })} />
            Publish now
          </label>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : approve ? 'Approve and create listing' : listing ? 'Save listing' : 'Add listing'}
        </button>
        {onCancel ? (
          <button type="button" disabled={pending} className="text-sm underline disabled:opacity-50" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-xs">
            {approve ? 'Approved.' : 'Saved.'}
          </p>
        ) : null}
      </div>
    </form>
  );
}
