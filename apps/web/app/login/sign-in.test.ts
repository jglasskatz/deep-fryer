import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/messages/en';
import { localizeHref } from '@/lib/i18n/routing';
import {
  afterEmailSignIn,
  checkEmailHref,
  isPlausibleEmail,
  isStartPath,
  loginErrorHref,
  loginErrorMessage,
  loginHref,
  MAX_EMAIL_LENGTH,
  returnPath,
  signInHref,
} from './sign-in';

const spanish = (path: string) => localizeHref('es', path);

describe('signInHref (the header link, SPEC-v6 §2.2)', () => {
  it('returns the reader to the page they are on', () => {
    expect(signInHref('/nyc/dim/housing')).toBe('/login?next=%2Fnyc%2Fdim%2Fhousing');
  });

  it('keeps the query string', () => {
    expect(signInHref('/nyc/dim/housing?sort=new')).toBe(
      `/login?next=${encodeURIComponent('/nyc/dim/housing?sort=new')}`,
    );
  });

  it('keeps the reader’s language on public pages', () => {
    expect(signInHref('/nyc/dim/housing', spanish)).toBe(`/login?next=${encodeURIComponent('/es/nyc/dim/housing')}`);
  });

  it('leaves staff pages unprefixed (they exist only in English)', () => {
    expect(signInHref('/nyc/admin/review', spanish)).toBe(`/login?next=${encodeURIComponent('/nyc/admin/review')}`);
  });

  it('never points back at a sign-in page', () => {
    expect(signInHref('/login')).toBe('/login');
    expect(signInHref('/login/check-email?provider=nodemailer&type=email')).toBe('/login');
  });

  it('on the sign-in page, keeps the next it already carries', () => {
    expect(signInHref('/login?next=%2Fnyc%2Fdim%2Fhousing&error=Verification')).toBe(
      '/login?next=%2Fnyc%2Fdim%2Fhousing',
    );
    // …unless that next is itself a sign-in page or off-site.
    expect(signInHref('/login?next=%2Flogin')).toBe('/login');
    expect(signInHref('/login?next=%2F%2Fevil.example')).toBe('/login');
  });

  it('sends the front page to the account page (no next)', () => {
    expect(signInHref('/')).toBe('/login');
    expect(signInHref('/?utm=x')).toBe('/login');
  });

  it('ignores a path that is not same-site', () => {
    expect(signInHref('//evil.example/x')).toBe('/login');
    expect(signInHref('/\\evil.example')).toBe('/login');
    expect(signInHref('')).toBe('/login');
  });

  it('does not treat a page merely starting with "login" as a sign-in page', () => {
    expect(signInHref('/loginville')).toBe('/login?next=%2Floginville');
  });
});

describe('returnPath', () => {
  it('accepts same-site paths that are not sign-in pages', () => {
    expect(returnPath('/nyc')).toBe('/nyc');
    expect(returnPath('/es/nyc/dim/food?x=1')).toBe('/es/nyc/dim/food?x=1');
  });

  it('rejects everything else', () => {
    for (const bad of [undefined, null, '', 'nyc', 'https://evil.example', '//evil.example', '/\\evil', '/login', '/login?next=/nyc', '/login/check-email']) {
      expect(returnPath(bad)).toBeNull();
    }
  });

  it('rejects paths a browser would read as another site, or as a sign-in page', () => {
    // `?next=/%09/evil.example` and its kin, decoded: browsers drop the tab
    // or newline and read `\` as `/`, so each is //evil.example.
    for (const bad of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\t\\evil.example', '/login\t', '/log\nin/check-email']) {
      expect(returnPath(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(loginHref('/\t/evil.example')).toBe('/login');
    expect(signInHref('/login?next=%2F%09%2Fevil.example')).toBe('/login');
  });
});

describe('isStartPath (the staff-facing sign-in page and email)', () => {
  it('is the start flow and the pages under it, with any query', () => {
    for (const ok of ['/start', '/start?portrait=gotham', '/start?portrait=gotham&checkout=success&at=1', '/start/', '/start#build']) {
      expect(isStartPath(ok), ok).toBe(true);
    }
  });

  it('is nothing else: other pages, look-alikes, missing and off-site next values', () => {
    for (const no of [undefined, null, '', '/', '/nyc', '/starting', '/started?x=1', '/es/start', '/nyc/start', '//start', 'https://evil.example/start', '/login?next=/start']) {
      expect(isStartPath(no), String(no)).toBe(false);
    }
  });
});

describe('sign-in page links', () => {
  it('loginHref carries next only when worth returning to', () => {
    expect(loginHref('/nyc')).toBe('/login?next=%2Fnyc');
    expect(loginHref(null)).toBe('/login');
    expect(loginHref('/login/check-email')).toBe('/login');
  });

  it('loginErrorHref names the error and keeps next', () => {
    expect(loginErrorHref('EmailSignin', '/nyc')).toBe('/login?error=EmailSignin&next=%2Fnyc');
    expect(loginErrorHref('EmailSignin')).toBe('/login?error=EmailSignin');
  });

  it('checkEmailHref is the well-formed verify-request page', () => {
    expect(checkEmailHref()).toBe('/login/check-email');
    expect(checkEmailHref('/nyc/dim/housing')).toBe('/login/check-email?next=%2Fnyc%2Fdim%2Fhousing');
  });
});

describe('isPlausibleEmail (the email form, before Auth.js and nodemailer)', () => {
  it('accepts ordinary addresses', () => {
    for (const ok of ['owner@nyc.example.gov', 'first.last+tag@sub.example.org', "o'brien@example.ie", 'x@ex-ample.co']) {
      expect(isPlausibleEmail(ok), ok).toBe(true);
    }
  });

  it('rejects what is not one address', () => {
    for (const bad of ['', 'owner', 'owner@example', '@example.org', 'a@b@example.org', 'a b@example.org', 'a@example.org\n']) {
      expect(isPlausibleEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects address-list and display-name syntax, which makes the To header a list', () => {
    // Auth.js keeps commas before the @, so this reached nodemailer whole.
    expect(isPlausibleEmail(`${'a,'.repeat(5000)}x@example.com`)).toBe(false);
    for (const bad of [
      'a,x@example.com',
      'a;x@example.com',
      'g:x@example.com',
      'Name<x@example.com>',
      'x@example.com(comment)',
      '"a b"@example.com',
      'x@[127.0.0.1].example',
      'a\\b@example.com',
    ]) {
      expect(isPlausibleEmail(bad), bad).toBe(false);
    }
  });

  it('caps the length at what SMTP carries, before the pattern runs', () => {
    const local = 'a'.repeat(64);
    const fits = `${local}@${'d'.repeat(MAX_EMAIL_LENGTH - local.length - 5)}.com`;
    expect(fits).toHaveLength(MAX_EMAIL_LENGTH);
    expect(isPlausibleEmail(fits)).toBe(true);
    expect(isPlausibleEmail(`a${fits}`)).toBe(false);
    // A form field's worth of dots: the pattern alone backtracks for minutes
    // on this; the length check answers at once.
    const started = performance.now();
    expect(isPlausibleEmail(`a@${'.'.repeat(1_000_000)}@`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('afterEmailSignIn', () => {
  it('goes to the check-email page when Auth.js sent the link', () => {
    expect(
      afterEmailSignIn('https://df.example/api/auth/verify-request?provider=nodemailer&type=email', '/nyc/dim/housing'),
    ).toBe('/login/check-email?next=%2Fnyc%2Fdim%2Fhousing');
    // The page Auth.js would have redirected to, if it answers with that instead.
    expect(afterEmailSignIn('/login/check-email?provider=nodemailer&type=email', null)).toBe('/login/check-email');
  });

  it('returns to the form with the error and next when Auth.js reports one', () => {
    expect(afterEmailSignIn('https://df.example/login?error=Configuration', '/nyc')).toBe(
      '/login?error=Configuration&next=%2Fnyc',
    );
  });

  it('treats an unparsable answer as a failed send', () => {
    expect(afterEmailSignIn('http://', '/nyc')).toBe('/login?error=EmailSignin&next=%2Fnyc');
  });
});

describe('loginErrorMessage', () => {
  const errors = en.login.errors;

  it('maps Auth.js codes to the catalog', () => {
    expect(loginErrorMessage('Verification', errors)).toBe(errors.Verification);
    expect(loginErrorMessage('EmailSignin', errors)).toBe(errors.EmailSignin);
  });

  it('uses the default for unknown codes, including prototype names', () => {
    expect(loginErrorMessage('Nope', errors)).toBe(errors.default);
    expect(loginErrorMessage('constructor', errors)).toBe(errors.default);
    expect(loginErrorMessage('toString', errors)).toBe(errors.default);
  });

  it('is null without an error', () => {
    expect(loginErrorMessage(undefined, errors)).toBeNull();
    expect(loginErrorMessage('', errors)).toBeNull();
  });
});
