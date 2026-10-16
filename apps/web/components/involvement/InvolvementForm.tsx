'use client';

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { INVOLVEMENT_LIMITS, PHONE_INPUT_PATTERN, type InvolvementSubmissionKind } from '@deep-fryer/core';
import type { Messages } from '@/lib/i18n/messages/en';
import {
  submitInvolvement,
  type InvolvementField,
  type SubmitInvolvementResult,
} from '@/lib/involvement-actions';

/**
 * The "put your organization forward" form (SPEC-v6 §4.2), on every
 * dimension page and on the Get involved page. No account is needed; the
 * server action (lib/involvement-actions.ts) does the real checking, and
 * this component's job is to make the form easy to fill in on a phone, in
 * any language, and to say clearly what happened.
 *
 * - Every word comes from `labels` (m.involvement, the reader's language),
 *   passed from the server page; the action answers with a status, mapped
 *   here to the matching message.
 * - The browser checks what it can first (required, type=email/url,
 *   maxLength from INVOLVEMENT_LIMITS, the same ceilings the database
 *   enforces), so most mistakes are caught with the browser's own message
 *   in the reader's language before anything is sent; the phone field
 *   carries core's PHONE_INPUT_PATTERN for the same reason. What only the
 *   server can judge comes back as a list of fields: they are marked
 *   aria-invalid and named in an error summary at the top of the form, which
 *   takes focus (the GOV.UK pattern) so screen-reader and keyboard users land
 *   on it. The website and phone fields, whose rules the browser cannot
 *   fully check (a type=url field takes https://myorg; three digits are the
 *   server's rule), also say under the field what to change, linked through
 *   aria-describedby so it is read with the field (WCAG 3.3.1, 3.3.3).
 * - Organization name and "who you are" are asked only for an
 *   organization; a suggestion needs neither (hidden fields are not sent).
 * - The honeypot is a field people never see (visually hidden, aria-hidden,
 *   out of the tab order, autocomplete off). Its name is chosen to tempt
 *   form-filling bots without matching any browser autofill heuristic:
 *   Chrome classifies names containing "company" or "organization" as the
 *   saved address's company and could fill a hidden field with them, and a
 *   real organization's submission would then be silently discarded.
 * - Submitting is done in script (onSubmit) and the form element has
 *   method="post" and no action: should the page be used before its script
 *   loads, a native submit posts to the page itself, which ignores it —
 *   contact details never end up in a URL, a history entry, or a log.
 * - Text fields take `dir="auto"` so an English name typed on an Arabic page
 *   (or the reverse) runs in its own direction; email, web and phone fields
 *   are always left-to-right. Layout uses logical properties throughout.
 * - Colours are the tokens and remapped classes dark mode covers
 *   (lib/theme-dark.test.ts).
 */

export interface InvolvementDimensionOption {
  /** Framework dimension slug (what the submission stores). */
  slug: string;
  /** The dimension's name in the reader's language. */
  name: string;
}

/** Field names in the order they appear, for the error summary and focus. */
const FIELD_ORDER: InvolvementField[] = [
  'kind',
  'dimension_slug',
  'org_name',
  'about',
  'pitch',
  'website',
  'contact_name',
  'email',
  'phone',
];

/** The honeypot's name (see the component comment for why not "company_…"). */
const HONEYPOT = 'homepage';

const input =
  'mt-1 block w-full rounded border border-field-border bg-white px-3 py-2 text-base aria-invalid:border-red-700 aria-invalid:border-2';
const hint = 'mt-0.5 block text-sm text-[color:var(--color-muted)]';
const fieldLabel = 'block font-medium';

type Failure = Exclude<SubmitInvolvementResult, { status: 'thanks' }>;

export function InvolvementForm({
  tenantSlug,
  token,
  labels: t,
  dimensions,
  defaultDimension = null,
  hideDimension = false,
}: {
  tenantSlug: string;
  /** The signed form token, issued by the page when it rendered (lib/form-token.ts). */
  token: string;
  labels: Messages['involvement'];
  /** The portrait's published dimensions, in the order to offer them. */
  dimensions: InvolvementDimensionOption[];
  /** Preselected dimension (framework slug) on a dimension page. */
  defaultDimension?: string | null;
  /**
   * Fix the dimension instead of offering the choice (sent as a hidden
   * field). Off by default: even on a dimension page, an organization that
   * works across several should be able to say so.
   */
  hideDimension?: boolean;
}) {
  const id = useId();
  const fid = (name: string) => `${id}-${name}`;
  const [kind, setKind] = useState<InvolvementSubmissionKind>('listing');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sent, setSent] = useState(false);
  // Remounts the form (clearing every field) for "Send another".
  const [formKey, setFormKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const summaryRef = useRef<HTMLDivElement>(null);
  const thanksRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Focus moves only after a submission or "Send another" — never on the
  // first render, which would scroll a dimension page down to its form.
  const focusAfter = useRef<'summary' | 'thanks' | 'form' | null>(null);

  const invalid = new Set<InvolvementField>(failure?.status === 'invalid' ? failure.fields : []);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'summary') summaryRef.current?.focus();
    if (target === 'thanks') thanksRef.current?.focus();
    if (target === 'form') formRef.current?.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.focus();
  }, [failure, sent, formKey]);

  const fieldLabelText: Record<InvolvementField, string> = {
    kind: t.kindLegend,
    dimension_slug: t.dimensionLabel,
    org_name: t.orgName,
    about: t.about,
    pitch: kind === 'listing' ? t.pitchListing : t.pitchSuggestion,
    website: t.websiteLabel,
    contact_name: t.contactName,
    email: t.email,
    phone: t.phone,
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields: Partial<Record<InvolvementField, string>> = {};
    for (const name of FIELD_ORDER) {
      const value = data.get(name);
      if (typeof value === 'string') fields[name] = value;
    }
    const honeypot = data.get(HONEYPOT);
    const formToken = data.get('token');
    setFailure(null);
    startTransition(async () => {
      let result: SubmitInvolvementResult;
      try {
        result = await submitInvolvement({
          tenantSlug,
          token: typeof formToken === 'string' ? formToken : '',
          honeypot: typeof honeypot === 'string' ? honeypot : '',
          fields,
        });
      } catch {
        // The request itself failed (offline, server restarting).
        result = { status: 'failed' };
      }
      if (result.status === 'thanks') {
        focusAfter.current = 'thanks';
        setSent(true);
      } else {
        focusAfter.current = result.status === 'invalid' ? 'summary' : null;
        setFailure(result);
      }
    });
  }

  /** Once the person edits a field the server flagged, stop marking it. */
  function onInput(event: FormEvent<HTMLFormElement>) {
    const name = (event.target as HTMLInputElement).name as InvolvementField;
    if (failure?.status === 'invalid' && failure.fields.includes(name)) {
      const rest = failure.fields.filter((f) => f !== name);
      // With every flagged field edited, "check the fields marked below"
      // would point at nothing: the summary goes until the next attempt.
      setFailure(rest.length > 0 ? { status: 'invalid', fields: rest } : null);
    }
  }

  /**
   * Organization and suggestion ask different questions. Switching to a
   * suggestion removes the organization fields, so flags on them (from the
   * last attempt) go too — the summary must not point at fields not there.
   */
  function chooseKind(next: InvolvementSubmissionKind) {
    setKind(next);
    if (next === 'suggestion' && failure?.status === 'invalid') {
      const rest = failure.fields.filter((f) => f !== 'org_name' && f !== 'about');
      setFailure(rest.length > 0 ? { status: 'invalid', fields: rest } : null);
    }
  }

  /**
   * An error-summary link moves focus into the field, not just the scroll
   * position (a fragment link alone would leave a keyboard user where they
   * were); for the kind, the chosen radio button.
   */
  function focusField(name: InvolvementField) {
    const target =
      name === 'kind'
        ? formRef.current?.querySelector<HTMLElement>('input[name="kind"]:checked')
        : document.getElementById(fid(name));
    target?.focus();
  }

  function sendAnother() {
    focusAfter.current = 'form';
    setSent(false);
    setFailure(null);
    setKind('listing');
    setFormKey((k) => k + 1);
  }

  if (sent) {
    return (
      <div
        ref={thanksRef}
        tabIndex={-1}
        role="status"
        className="mt-4 rounded border border-green-700/30 bg-green-50 p-4 text-sm text-green-900 outline-offset-4"
      >
        <p>{t.thanks}</p>
        <button
          type="button"
          onClick={sendAnother}
          className="mt-3 min-h-11 rounded border border-black/20 px-4 py-2 font-medium hover:bg-black/5"
        >
          {t.sendAnother}
        </button>
      </div>
    );
  }

  const otherFailure =
    failure && failure.status !== 'invalid'
      ? { tooFast: t.tooFast, rateLimited: t.rateLimited, expired: t.expired, failed: t.failed }[failure.status]
      : null;
  const invalidInOrder = FIELD_ORDER.filter((f) => invalid.has(f));
  /** What to change, for the fields whose rules only the server fully checks. */
  const fieldError: Partial<Record<InvolvementField, string>> = { website: t.websiteInvalid, phone: t.phoneInvalid };
  const errorId = (name: InvolvementField) => fid(`${name}-error`);
  const showsError = (name: InvolvementField) => invalid.has(name) && fieldError[name] !== undefined;
  const aria = (name: InvolvementField, describedBy?: string) => ({
    id: fid(name),
    name,
    'aria-invalid': invalid.has(name) || undefined,
    // The error first, so it is what a screen reader says right after the label.
    'aria-describedby': [showsError(name) ? errorId(name) : null, describedBy].filter(Boolean).join(' ') || undefined,
  });
  /** Under a flagged field: what to change. */
  const errorFor = (name: InvolvementField) =>
    showsError(name) ? (
      <span id={errorId(name)} className="mt-1 block text-sm text-red-700">
        {fieldError[name]}
      </span>
    ) : null;

  return (
    <form
      key={formKey}
      ref={formRef}
      method="post"
      onSubmit={onSubmit}
      onInput={onInput}
      className="mt-4 space-y-5"
      aria-busy={pending || undefined}
    >
      {failure?.status === 'invalid' ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded border-2 border-red-700 p-4 text-sm text-red-900 outline-offset-4"
        >
          <p className="font-medium">{t.invalid}</p>
          {invalidInOrder.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {invalidInOrder.map((name) => (
                <li key={name}>
                  <a
                    className="underline"
                    href={`#${fid(name)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      focusField(name);
                    }}
                  >
                    {fieldLabelText[name]}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <input type="hidden" name="token" value={token} />

      {/* The honeypot. A person never sees, hears, or tabs to it. */}
      <div aria-hidden="true" className="sr-only">
        <input type="text" name={HONEYPOT} tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <fieldset id={fid('kind')}>
        <legend className={fieldLabel}>{t.kindLegend}</legend>
        <div className="mt-1 space-y-1">
          {(
            [
              ['listing', t.kindListing],
              ['suggestion', t.kindSuggestion],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => chooseKind(value)}
                required
                className="size-5 shrink-0"
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {hideDimension ? (
        <input type="hidden" name="dimension_slug" value={defaultDimension ?? ''} />
      ) : (
        <div>
          <label htmlFor={fid('dimension_slug')} className={fieldLabel}>
            {t.dimensionLabel}
          </label>
          <select {...aria('dimension_slug')} defaultValue={defaultDimension ?? ''} className={input}>
            <option value="">{t.dimensionAny}</option>
            {dimensions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === 'listing' ? (
        <>
          <div>
            <label htmlFor={fid('org_name')} className={fieldLabel}>
              {t.orgName}
            </label>
            <input
              {...aria('org_name')}
              type="text"
              required
              maxLength={INVOLVEMENT_LIMITS.orgName}
              autoComplete="organization"
              dir="auto"
              className={input}
            />
          </div>
          <div>
            <label htmlFor={fid('about')} className={fieldLabel}>
              {t.about}
            </label>
            <span id={fid('about-hint')} className={hint}>
              {t.aboutHint}
            </span>
            <textarea
              {...aria('about', fid('about-hint'))}
              required
              rows={3}
              maxLength={INVOLVEMENT_LIMITS.about}
              dir="auto"
              className={input}
            />
          </div>
        </>
      ) : null}

      <div>
        <label htmlFor={fid('pitch')} className={fieldLabel}>
          {kind === 'listing' ? t.pitchListing : t.pitchSuggestion}
        </label>
        <span id={fid('pitch-hint')} className={hint}>
          {kind === 'listing' ? t.pitchListingHint : t.pitchSuggestionHint}
        </span>
        <textarea
          {...aria('pitch', fid('pitch-hint'))}
          required
          rows={5}
          maxLength={INVOLVEMENT_LIMITS.pitch}
          dir="auto"
          className={input}
        />
      </div>

      <div>
        <label htmlFor={fid('website')} className={fieldLabel}>
          {t.websiteLabel} <span className="font-normal text-[color:var(--color-muted)]">{t.optional}</span>
        </label>
        <input
          {...aria('website')}
          type="url"
          inputMode="url"
          maxLength={INVOLVEMENT_LIMITS.website}
          autoComplete="url"
          dir="ltr"
          className={input}
        />
        {errorFor('website')}
      </div>

      <fieldset className="space-y-4 rounded border border-black/15 p-4">
        <legend className="px-1 font-medium">{t.contactLegend}</legend>
        <p id={fid('privacy')} className="text-sm text-[color:var(--color-muted)]">
          {t.privacy}
        </p>
        <div>
          <label htmlFor={fid('contact_name')} className={fieldLabel}>
            {t.contactName}
          </label>
          <input
            {...aria('contact_name')}
            type="text"
            required
            maxLength={INVOLVEMENT_LIMITS.contactName}
            autoComplete="name"
            dir="auto"
            className={input}
          />
        </div>
        <div>
          <label htmlFor={fid('email')} className={fieldLabel}>
            {t.email}
          </label>
          <input
            {...aria('email', fid('privacy'))}
            type="email"
            required
            maxLength={INVOLVEMENT_LIMITS.email}
            autoComplete="email"
            dir="ltr"
            className={input}
          />
        </div>
        <div>
          <label htmlFor={fid('phone')} className={fieldLabel}>
            {t.phone} <span className="font-normal text-[color:var(--color-muted)]">{t.optional}</span>
          </label>
          <input
            {...aria('phone', fid('privacy'))}
            type="tel"
            // core's phoneSchema ceiling (the form limits table has no phone entry).
            maxLength={40}
            // type=tel checks nothing; the pattern lets the browser refuse
            // letters and extensions first, showing `title` with its message.
            pattern={PHONE_INPUT_PATTERN}
            title={t.phoneInvalid}
            autoComplete="tel"
            dir="ltr"
            className={input}
          />
          {errorFor('phone')}
        </div>
      </fieldset>

      {otherFailure ? (
        <p role="alert" className="text-sm text-red-700">
          {otherFailure}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full rounded bg-[color:var(--color-accent)] px-5 py-2 font-medium text-white hover:opacity-90 disabled:opacity-60 sm:w-auto"
      >
        {pending ? t.sending : t.send}
      </button>
    </form>
  );
}
