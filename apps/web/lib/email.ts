import 'server-only';
import { createTransport, type Transporter } from 'nodemailer';
import { isProduction, smtpConfigured } from './env';

/**
 * Outbound mail (sign-in links, invitations, run notifications). One SMTP
 * transport for every provider — municipal IT can point it at their own
 * relay. In development without SMTP the message prints to the server log so
 * flows stay testable end to end.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('outbound email is not configured (SMTP_URL + EMAIL_FROM)');
  }
}

let transport: Transporter | null = null;

export function emailDeliverable(): boolean {
  return smtpConfigured() || !isProduction();
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  if (!smtpConfigured()) {
    if (isProduction()) throw new EmailNotConfiguredError();
    console.info(
      `[dev mail] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}\n`,
    );
    return;
  }
  transport ??= createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

/** Minimal, accessible HTML body: a paragraph per line and one call-to-action link. */
export function simpleHtml(lines: string[], cta?: { href: string; label: string }): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('');
  const button = cta
    ? `<p style="margin:20px 0"><a href="${esc(cta.href)}" style="background:#2f7d32;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#6b7280">Or paste this link into your browser: ${esc(cta.href)}</p>`
    : '';
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">${body}${button}</div>`;
}
