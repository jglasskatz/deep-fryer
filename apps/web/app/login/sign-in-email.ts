import { simpleHtml, type OutboundEmail } from '@/lib/email';
import { isStartPath } from './sign-in';

/**
 * The sign-in email (auth.ts sendVerificationRequest): one link, which
 * works once and expires, and no code to type.
 *
 * It names the product, never the server's host: a link from "localhost" or
 * a bare internal hostname reads as spam or phishing, and the address the
 * link points to is printed beside the button anyway. When the sign-in
 * starts the self-serve flow (`next` is /start, ./sign-in.ts isStartPath) it
 * also says what the link is for — staff who asked for it from a "set up
 * your city" page recognise it; nothing else about where the person was (a
 * portrait, a discussion) goes into a message that sits in mail logs.
 *
 * English only: Auth.js gives this step no request language, and the email
 * goes out before the reader's language cookie could be read. Pure apart
 * from the HTML helper, so the tests read exactly what is sent.
 */

/**
 * The product's name as it appears to people. No shared constant exists:
 * the root layout's metadata (app/layout.tsx), the manifest and invitation
 * emails each spell it out the same way.
 */
export const PRODUCT_NAME = 'deep-fryer';

/** Why the link was asked for, as far as the email says: the start flow, or just signing in. */
export type SignInEmailPurpose = 'start' | 'sign-in';

/**
 * The purpose of the magic link Auth.js built (`…/api/auth/callback/nodemailer
 * ?callbackUrl=…&token=…&email=…`). Auth.js has already made callbackUrl an
 * absolute URL on this site (its redirect callback); anything that is not on
 * the link's own origin, or does not parse, is a plain sign-in.
 */
export function signInEmailPurpose(magicLink: string): SignInEmailPurpose {
  let link: URL;
  let destination: URL;
  try {
    link = new URL(magicLink);
    const callbackUrl = link.searchParams.get('callbackUrl');
    if (!callbackUrl) return 'sign-in';
    destination = new URL(callbackUrl, link.origin);
  } catch {
    return 'sign-in';
  }
  if (destination.origin !== link.origin) return 'sign-in';
  return isStartPath(`${destination.pathname}${destination.search}`) ? 'start' : 'sign-in';
}

/** The message for a magic link that expires in `expiresInMinutes`. */
export function signInEmail(magicLink: string, expiresInMinutes: number): Omit<OutboundEmail, 'to'> {
  const start = signInEmailPurpose(magicLink) === 'start';
  const subject = start
    ? `Sign in to ${PRODUCT_NAME} to set up your city’s doughnut`
    : `Sign in to ${PRODUCT_NAME}`;
  const what = start
    ? `sign in to ${PRODUCT_NAME} and set up your city’s doughnut`
    : `sign in to ${PRODUCT_NAME}`;
  const expiry = `It expires in ${expiresInMinutes} minutes and works once.`;
  const ignore = 'If you did not ask to sign in, ignore this email.';
  return {
    subject,
    text: `Use this link to ${what}. ${expiry}\n\n${magicLink}\n\n${ignore}`,
    html: simpleHtml([`Use the button below to ${what}.`, `${expiry} ${ignore}`], { href: magicLink, label: 'Sign in' }),
  };
}
