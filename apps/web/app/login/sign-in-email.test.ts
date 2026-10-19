import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, signInEmail, signInEmailPurpose } from './sign-in-email';

/**
 * The sign-in email names the product (never the server's host) and, for
 * the self-serve start flow, what the link is for; it is still one link and
 * no code.
 */

/** A magic link as Auth.js builds it (send-token.js), with callbackUrl already absolute. */
const magicLink = (callbackUrl: string, origin = 'http://localhost:3000') =>
  `${origin}/api/auth/callback/nodemailer?${new URLSearchParams({ callbackUrl, token: 'tok123', email: 'clerk@city.example.gov' })}`;

describe('signInEmailPurpose', () => {
  it('is the start flow when the link returns to /start, with or without its query', () => {
    expect(signInEmailPurpose(magicLink('http://localhost:3000/start'))).toBe('start');
    expect(signInEmailPurpose(magicLink('http://localhost:3000/start?portrait=gotham'))).toBe('start');
  });

  it('is a plain sign-in for every other destination, another origin, or a link it cannot read', () => {
    expect(signInEmailPurpose(magicLink('http://localhost:3000/nyc/dim/housing'))).toBe('sign-in');
    expect(signInEmailPurpose(magicLink('http://localhost:3000/starting'))).toBe('sign-in');
    expect(signInEmailPurpose(magicLink('http://localhost:3000/'))).toBe('sign-in');
    expect(signInEmailPurpose(magicLink('https://evil.example/start'))).toBe('sign-in');
    expect(signInEmailPurpose('http://localhost:3000/api/auth/callback/nodemailer?token=tok123')).toBe('sign-in');
    expect(signInEmailPurpose('not a url')).toBe('sign-in');
  });
});

describe('signInEmail', () => {
  it('names the product, not the host, and carries the link with its expiry', () => {
    const url = magicLink('http://localhost:3000/nyc');
    const mail = signInEmail(url, 15);
    expect(mail.subject).toBe(`Sign in to ${PRODUCT_NAME}`);
    expect(mail.subject).not.toMatch(/localhost/);
    expect(mail.text).toBe(
      `Use this link to sign in to ${PRODUCT_NAME}. It expires in 15 minutes and works once.\n\n${url}\n\nIf you did not ask to sign in, ignore this email.`,
    );
    // The only mention of the host is the link itself.
    expect(mail.text.replace(url, '')).not.toMatch(/localhost/);
    expect(mail.html).toContain(`Use the button below to sign in to ${PRODUCT_NAME}.`);
    expect(mail.html).toContain('>Sign in</a>');
    expect(mail.html).toContain(url.replace(/&/g, '&amp;'));
  });

  it('says what the link is for when it starts the self-serve flow', () => {
    const url = magicLink('https://doughnut.example.gov/start?portrait=gotham', 'https://doughnut.example.gov');
    const mail = signInEmail(url, 15);
    expect(mail.subject).toBe(`Sign in to ${PRODUCT_NAME} to set up your city’s doughnut`);
    expect(mail.text).toMatch(new RegExp(`^Use this link to sign in to ${PRODUCT_NAME} and set up your city’s doughnut\\. It expires in 15 minutes`));
    expect(mail.html).toContain(`sign in to ${PRODUCT_NAME} and set up your city’s doughnut.`);
  });

  it('is link-only: no code to type', () => {
    const mail = signInEmail(magicLink('http://localhost:3000/start'), 15);
    expect(mail.text.replace(/https?:\/\/\S+/g, '')).not.toMatch(/\b\d{6}\b|code/i);
  });
});
