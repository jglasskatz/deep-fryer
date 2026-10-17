import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection, SupportLink } from '@/components/legal/LegalPage';
import { supportEmail } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What this site collects and why, the cookies and device storage it uses, who can see what, how long it is kept, and who to contact.',
};

/** The date this notice describes the software as of; update it with any change to what the code collects or keeps. */
const DESCRIBES_SOFTWARE_AS_OF = '17 October 2026';

/**
 * The privacy notice, linked from every page's footer. A description of
 * what the code does, not legal boilerplate — each statement traces to it:
 *
 * - accounts and sessions: auth.ts (Auth.js on the app's own Postgres,
 *   database sessions of 30 days renewed at most daily, 15-minute single-use
 *   email links) and lib/account-actions.ts (what deleting an account
 *   removes);
 * - network addresses: lib/client-address.ts and lib/translation-requests.ts
 *   (HMAC-SHA256 under a purpose key derived from the server secret,
 *   truncated) and @deep-fryer/db sign-in-requests.ts (the sign-in limit's
 *   ledger: its rows, and unused sign-in links with their email addresses,
 *   are deleted by the worker's privacy sweep every quarter hour once out of
 *   the limit's one-hour window or expired — pruneExpiredSignInRecords,
 *   @deep-fryer/research PRIVACY_SWEEP_CRONTAB; page.test.ts holds this
 *   notice to those numbers);
 * - cookies and storage: middleware.ts (df_lang, one year), lib/theme.ts
 *   (df-theme in localStorage), public/sw.js (registered in every supporting
 *   browser by the root layout, installed or not; caches only pages marked
 *   x-df-cache: public and the images such pages show, never a signed-in or
 *   staff page or its images);
 * - no third-party scripts: lib/csp.ts (scripts, connections and fonts from
 *   this site only; images from it and its evidence storage) and the
 *   permissions policy that switches off location.
 *
 * The operator answers for the deployment — their hosting, email provider,
 * backups and server logs — and may need to add to this; docs/deploy.md
 * tells them what to review.
 */
export default function PrivacyPage() {
  const support = supportEmail();
  return (
    <LegalPage
      title="Privacy notice"
      preface={
        <>
          Whoever runs this site is responsible for it and for the information it holds. This notice describes
          what the deep-fryer software this site runs collects and does, as of {DESCRIBES_SOFTWARE_AS_OF}; the
          operator may add details about their own hosting and providers.
        </>
      }
    >
      <LegalSection id="reading" title="Reading the site">
        <p>
          Anyone can read published portraits without an account. Reading in English sets no cookies; choosing
          another language sets one, below. The site has no analytics, advertising or tracking, and loads no
          scripts, fonts or other content from anyone else — everything comes from this site, apart from evidence
          images, which come from the operator&apos;s own file storage. It never asks for your location: the
          browser&apos;s location feature is switched off for it. Emergency alerts are fetched by the server from
          the National Weather Service, not by your browser.
        </p>
        <p>
          Like any web server, this site&apos;s server sees your network (IP) address, the address of the page you
          ask for and your browser&apos;s name with every request. Whether and for how long its request log keeps
          them depends on how the operator has set the server up.
        </p>
      </LegalSection>

      <LegalSection id="collected" title="What is collected, and why">
        <ul>
          <li>
            <strong>Signing in.</strong> Your email address, and — if you sign in with Google or Microsoft — the name
            that account gives (and, from Google, the address of your profile picture), so you can sign in and be
            invited to a portrait. Signing in with Google or Microsoft also stores that account&apos;s identifier and
            the sign-in tokens it issues. An emailed sign-in link works once and expires after 15 minutes.
          </li>
          <li>
            <strong>Your display name.</strong> The name you choose to show beside your comments. It is public.
          </li>
          <li>
            <strong>Comments and votes</strong> on a portrait&apos;s discussion, with the time they were posted. Comments
            are public once approved (moderators may hold a first post); who voted is not shown.
          </li>
          <li>
            <strong>Organization submissions</strong> from the &ldquo;get involved&rdquo; form: the organization&apos;s
            details, its pitch, and the contact name, email address and phone number you give, so the
            portrait&apos;s staff can review it and reach you. Only the portrait&apos;s editors can read the contact
            details; an approved listing shows only what staff publish.
          </li>
          <li>
            <strong>Translation requests:</strong> the language and the page, so staff can see which languages
            readers want. No name or email is asked for.
          </li>
          <li>
            <strong>Keyed hashes of network addresses</strong>, stored with each organization submission and
            translation request, and when you ask for an emailed sign-in link — only to limit how many of each one
            connection can send. A keyed hash is a scrambled stand-in for the address that cannot be turned back
            into it without the server&apos;s secret key. Sign-in entries are deleted within about a quarter of an
            hour of leaving the limit&apos;s one-hour window.
          </li>
          <li>
            <strong>City staff and organizations:</strong> membership and roles, invitations (the invited email
            address), a record of who changed what in a portrait (kept for public-records requests), and — for
            organizations that pay — the billing contact&apos;s email address and any purchase-order number.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" title="Cookies and storage on your device">
        <ul>
          <li>
            <strong>
              <code>df_lang</code>
            </strong>{' '}
            — the language you chose, so the site opens in it next time. Kept for one year. Not set by embedded
            doughnuts on other sites.
          </li>
          <li>
            <strong>Sign-in cookies</strong> (named <code>authjs.…</code>): the session cookie that keeps you signed
            in for 30 days, renewed while you use the site and removed when you sign out; and short-lived cookies
            that protect the sign-in form and the round trip to Google or Microsoft.
          </li>
          <li>
            <strong>
              <code>df-theme</code>
            </strong>{' '}
            in your browser&apos;s local storage — light, dark, or matching your device. It never leaves your device.
          </li>
          <li>
            <strong>Offline copies.</strong> This site&apos;s service worker — in any browser that supports one, not
            only the installed app — saves public pages you open while signed out, the images on them, and pages you
            save from an emergency page, in your browser&apos;s cache storage so they open without a connection.
            Nothing shown while someone is signed in, and nothing on staff, account or billing pages — their images
            included — is saved.
          </li>
        </ul>
        <p>Clearing this site&apos;s data in your browser removes all of these.</p>
      </LegalSection>

      <LegalSection id="others" title="Who else receives information">
        <p>The software sends information to other services only for these purposes, and only where the operator has set them up:</p>
        <ul>
          <li>
            <strong>Email delivery:</strong> the operator&apos;s email provider receives your address and the message
            (sign-in links, invitations, notices to staff).
          </li>
          <li>
            <strong>Google or Microsoft</strong>, if you choose to sign in with them.
          </li>
          <li>
            <strong>Stripe</strong>, for organizations that pay by card: the organization&apos;s name and billing email.
            Card details are entered on Stripe&apos;s own pages, never on this site.
          </li>
          <li>
            <strong>Anthropic</strong>, whose models carry out the research: research sessions send questions about the
            jurisdiction and the public sources consulted, and policy briefs staff submit for analysis. Nothing about
            readers, commenters or submitters is sent.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="stored" title="Where it is kept, and for how long">
        <p>
          Everything is stored on the operator&apos;s own server: a PostgreSQL database, and file storage for
          evidence snapshots. Backups are kept as the operator arranges.
        </p>
        <ul>
          <li>Sessions end when you sign out or after 30 days without use. You can sign out of every device from your account page.</li>
          <li>
            An unused sign-in link&apos;s record, with the email address it was sent to, is deleted within about a
            quarter of an hour of the link expiring.
          </li>
          <li>
            Comments are part of the public record and stay. If you delete your account, they remain, attributed to
            &ldquo;Deleted account&rdquo;.
          </li>
          <li>
            Organization submissions and translation requests are kept until the operator removes them; the software
            does not delete them on a schedule.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="choices" title="Your choices">
        <p>
          You can change your display name or delete your account on your{' '}
          <Link className="underline" href="/account">
            account page
          </Link>
          . Deleting it removes your email address (with any sign-in links sent to it that were never used), name,
          sign-in methods, sessions and every role you hold; an organization&apos;s only owner must first invite
          another. For anything else — a copy of what is held about
          you, a correction, or removing a submission — contact the operator.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>
          Questions about privacy on this site go to{' '}
          <SupportLink email={support} fallback="the organization that runs this site" />.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
