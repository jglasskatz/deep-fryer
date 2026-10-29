import { z } from 'zod';
import { httpsUrlSchema, phoneSchema } from './emergency.js';
import { SLUG_RE } from './slugs.js';

/**
 * Getting involved (SPEC-v6 §4): listings of ways to take part in each
 * dimension — programs, organizations, public bodies, campaigns — and the
 * public form organizations use to put themselves forward. Everything a
 * listing shows was decided by staff; a submission is private until a staff
 * member turns it into a listing.
 */

/** How a listing lets people take part (shown in words, never as a colour alone). */
export const INVOLVEMENT_KINDS = ['volunteer', 'services', 'civic', 'organize', 'other'] as const;
export type InvolvementKind = (typeof INVOLVEMENT_KINDS)[number];

/** "My organization is a way to get involved" or "a suggestion for how people can". */
export const INVOLVEMENT_SUBMISSION_KINDS = ['listing', 'suggestion'] as const;
export type InvolvementSubmissionKind = (typeof INVOLVEMENT_SUBMISSION_KINDS)[number];

/** Length ceilings, shared by the forms (maxLength) and the database CHECKs (migration 0010). */
export const INVOLVEMENT_LIMITS = {
  name: 160,
  description: 600,
  orgName: 160,
  about: 1000,
  pitch: 2000,
  contactName: 120,
  email: 254,
  website: 2000,
  reviewNote: 1000,
} as const;

/** The public form's abuse limits (SPEC-v6 §4.2). */
export const SUBMISSION_LIMITS = {
  /** Submissions per network address per portrait per hour. */
  perAddressPerHour: 5,
  /** Submissions per email address per portrait per day. */
  perEmailPerDay: 3,
  /** A form filled faster than this is a script, not a person. */
  minFillMs: 3_000,
  /** A form token older than this is refused (the page was left open overnight); reload to get a fresh one. */
  maxTokenAgeMs: 24 * 60 * 60 * 1000,
} as const;

// Syntax only: every write also validates membership in the portrait's active
// dimensions. A framework reference never changes a local dimension's identity.
const dimensionSlugSchema = z.string().max(80).regex(SLUG_RE, 'not a dimension address');

/** Form fields arrive as '' when left empty; optional fields store null instead. */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(emptyToNull, schema.nullable()).default(null);

/**
 * An organization's own website may still be plain http; staff convert it
 * (or drop it) before a listing goes public, where only https links render.
 */
const websiteSchema = z
  .string()
  .trim()
  .max(INVOLVEMENT_LIMITS.website)
  .refine((u) => {
    try {
      const url = new URL(u);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'must be a full web address, starting with https://');

/** A listing as staff save it (admin form, seed scripts). */
export const involvementListingInputSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(INVOLVEMENT_LIMITS.name),
  description: z
    .string()
    .trim()
    .min(1, 'say what people can do')
    .max(INVOLVEMENT_LIMITS.description),
  url: optional(httpsUrlSchema),
  phone: optional(phoneSchema),
  kind: z.enum(INVOLVEMENT_KINDS),
  /** Empty = the listing serves every dimension. */
  dimension_slugs: z
    .array(dimensionSlugSchema)
    .max(200)
    .default([])
    .refine((d) => new Set(d).size === d.length, 'each dimension once'),
  source_url: optional(httpsUrlSchema),
  display_order: z.number().int().min(0).max(10_000).default(0),
  published: z.boolean().default(false),
});
export type InvolvementListingInput = z.infer<typeof involvementListingInputSchema>;
export type InvolvementListingInputDraft = z.input<typeof involvementListingInputSchema>;

/**
 * The public form (no account). An organization must say who it is; a
 * suggestion needs only the suggestion. Contact details are required so
 * staff can follow up, and are never published.
 */
export const involvementSubmissionInputSchema = z
  .object({
    kind: z.enum(INVOLVEMENT_SUBMISSION_KINDS),
    dimension_slug: optional(dimensionSlugSchema),
    org_name: optional(z.string().trim().max(INVOLVEMENT_LIMITS.orgName)),
    about: optional(z.string().trim().max(INVOLVEMENT_LIMITS.about)),
    pitch: z.string().trim().min(1, 'tell us why, or what you suggest').max(INVOLVEMENT_LIMITS.pitch),
    website: optional(websiteSchema),
    contact_name: z.string().trim().min(1, 'your name is required').max(INVOLVEMENT_LIMITS.contactName),
    email: z.string().trim().max(INVOLVEMENT_LIMITS.email).email('use an email address such as name@example.org'),
    phone: optional(phoneSchema),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== 'listing') return;
    if (!v.org_name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['org_name'], message: 'the organization’s name is required' });
    if (!v.about) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['about'], message: 'tell us who you are' });
  });
export type InvolvementSubmissionInput = z.infer<typeof involvementSubmissionInputSchema>;

/** The fields a listing needs to be shown. */
export interface InvolvementListingView {
  id: string;
  name: string;
  description: string;
  url: string | null;
  phone: string | null;
  kind: InvolvementKind;
  dimension_slugs: string[];
  link_checked_at: string | null;
  display_order: number;
}

/**
 * The listings for one dimension page: those naming the dimension first,
 * then the general ones (no dimensions) — a dimension-specific way in is
 * more useful than a general one — each group in staff's order, then by name.
 */
export function listingsForDimension<L extends Pick<InvolvementListingView, 'dimension_slugs' | 'display_order' | 'name'>>(
  listings: L[],
  slug: string,
): L[] {
  const order = (a: L, b: L) => a.display_order - b.display_order || a.name.localeCompare(b.name);
  const specific = listings.filter((l) => l.dimension_slugs.includes(slug)).sort(order);
  const general = listings.filter((l) => l.dimension_slugs.length === 0).sort(order);
  return [...specific, ...general];
}

/** The host a website points at, for showing staff where an unreviewed link goes. */
export function linkHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
