import { SLUG_RE } from '@deep-fryer/core';
import { safeHref } from './safe-url';

/*
 * The operator's optional settings for the site's own chrome — the footer's
 * Terms link and the landing page's showcase — read at request time, so one
 * image serves any deployment (like lib/env.ts appUrl). The required one,
 * SUPPORT_EMAIL, is lib/env.ts supportEmail: production refuses to boot
 * without it (@deep-fryer/core deploy-env).
 */

/**
 * TERMS_URL: where the operator's terms of service live, linked as "Terms"
 * in the footer. Unset, blank, or anything but an http(s) URL means no link
 * — a typo must not put a javascript: URL in every page's footer.
 */
export function termsUrl(): string | null {
  return safeHref(process.env.TERMS_URL) ?? null;
}

/**
 * DF_SHOWCASE_ORG: the organization whose portraits the landing page
 * features (NYC's six on the hosted site). Only a well-formed slug counts;
 * whether that organization has anything public to show is the landing
 * page's question, asked of the database on every visit, so a showcase
 * that has not published yet simply does not appear.
 */
export function showcaseOrgSlug(): string | null {
  const raw = process.env.DF_SHOWCASE_ORG?.trim().toLowerCase();
  return raw && SLUG_RE.test(raw) ? raw : null;
}
