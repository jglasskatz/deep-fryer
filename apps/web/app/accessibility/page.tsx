import type { Metadata } from 'next';
import { LegalPage, LegalSection, SupportLink } from '@/components/legal/LegalPage';
import { supportEmail } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Accessibility',
  description:
    'How this site aims to meet WCAG 2.1 Level AA, how it was tested, what is known not to work fully yet, and how to report a barrier.',
};

/**
 * The date this statement describes the software as of: the production-
 * readiness audit (commit 18d5ba0, 16 October 2026) and what has changed
 * since. Update it with the statement whenever an audit or a fix changes
 * what the statement says.
 */
const DESCRIBES_SOFTWARE_AS_OF = '17 October 2026';

/**
 * The accessibility statement, linked from every page's footer. Written from
 * what was actually done and what actually ships, not from a template:
 *
 * - the target, WCAG 2.1 AA, is the standard the US Department of Justice's
 *   ADA Title II rule sets for state and local government web content;
 * - "how it was tested" is the 18d5ba0 audit (176 axe-core runs over public,
 *   translated, right-to-left, dark and staff pages, keyboard checks, 320 px
 *   reflow, a second reviewer reproducing each finding);
 * - the limitations are the ones the code and docs/language-access.md admit
 *   to — including that no testing with screen-reader users has been done,
 *   which nothing in the record claims;
 * - reports go to the operator's SUPPORT_EMAIL, with no promised response
 *   time: the software cannot know the operator's, so it invents none.
 */
export default function AccessibilityPage() {
  const support = supportEmail();
  return (
    <LegalPage
      title="Accessibility statement"
      preface={
        <>
          Whoever runs this site is responsible for it, including this statement. It describes the deep-fryer
          software this site runs, as of {DESCRIBES_SOFTWARE_AS_OF}.
        </>
      }
    >
      <LegalSection id="target" title="Our target">
        <p>
          We aim for this site to conform to the{' '}
          <a className="underline" href="https://www.w3.org/TR/WCAG21/">
            Web Content Accessibility Guidelines (WCAG) 2.1
          </a>{' '}
          at Level AA — the standard the US Department of Justice&apos;s ADA Title II rule sets for state and local
          government websites. That covers every page: the public portraits residents read, and the pages city
          staff use to review and publish them.
        </p>
        <p>
          As far as our testing shows, the site meets that standard, with the limitations listed below. It has not
          been independently audited or certified.
        </p>
      </LegalSection>

      <LegalSection id="tested" title="How it was tested">
        <ul>
          <li>
            176 automated checks with axe-core over public pages (portraits, dimension pages, methodology, getting
            involved), translated pages including right-to-left Arabic and Urdu, and staff pages, in both the light
            and the dark theme.
          </li>
          <li>
            Keyboard-only use across the same pages: menus open and close from the keyboard (Escape closes them),
            wide tables scroll with the arrow keys, and a skip link leads past the header.
          </li>
          <li>Reflow: pages work at 320 CSS pixels wide (a phone, or a desktop at 400% zoom) without sideways scrolling.</li>
          <li>
            Contrast: text, form field borders and controls were measured against the background in both themes.
          </li>
          <li>Every page has its own title, in the reader&apos;s language on translated pages.</li>
          <li>A second reviewer reproduced each problem the checks found before it was fixed.</li>
        </ul>
      </LegalSection>

      <LegalSection id="features" title="What the site provides">
        <ul>
          <li>
            The doughnut chart is a picture, so it always comes with a text equivalent: a written summary for screen
            readers and a list of every dimension with its status in words, each linking to a page with the numbers
            and their sources.
          </li>
          <li>Light and dark themes, following your device unless you choose one.</li>
          <li>
            Public pages in English and, where a portrait has translation turned on, ten more languages, with
            right-to-left layout for Arabic and Urdu.
          </li>
          <li>Public pages you opened while signed out can be read again on the same device without a connection.</li>
        </ul>
      </LegalSection>

      <LegalSection id="limitations" title="Known limitations">
        <ul>
          <li>
            The doughnut itself can be explored only with a pointer (mouse, touch or pen). Everything it shows is in
            the list beside or under it and on each dimension&apos;s page.
          </li>
          <li>
            Translations of headings and explanations are machine-assisted drafts that a certified translator has not
            reviewed yet. Research findings, sources and residents&apos; comments are published in English only.
          </li>
          <li>
            Evidence snapshots are images of source pages as they looked when they were captured. Their text is not
            available as text here; the original source is linked beside each one.
          </li>
          <li>Staff pages — the review queue, settings, billing and accounts — are in English only.</li>
          <li>
            Documents and sites the portraits link to belong to others, and we cannot vouch for their accessibility.
          </li>
          <li>
            Testing so far has been automated checks and manual keyboard and layout checks. It has not yet included
            testing with screen readers or other assistive technology by people who use them every day.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="report" title="Report a barrier">
        <p>
          If something on this site does not work for you, please tell us at{' '}
          <SupportLink email={support} fallback="the address of the organization that runs this site" />. It helps to
          include the page&apos;s address, what you were trying to do, and the browser and any assistive technology
          you use. We will also help you get the information you need in another way.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
