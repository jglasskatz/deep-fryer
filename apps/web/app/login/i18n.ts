import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { asLocale, localeInfo } from '@/lib/i18n/locales';
import { messagesFor } from '@/lib/i18n/messages';
import { localizeHref } from '@/lib/i18n/routing';
import type { I18n } from '@/lib/i18n/server';

/**
 * The reader's remembered language (middleware.ts LANG_COOKIE: set whenever
 * they read a translated page or pick a language in the switcher).
 */
const LANG_COOKIE = 'df_lang';

/**
 * The sign-in pages' language (SPEC-v6 §2.2).
 *
 * /login has a single URL — Auth.js redirects to it, and magic links,
 * errors, and the verify-request page all land on it — so it is not a
 * localizable path (lib/i18n/routing.ts) and middleware gives it English
 * (getI18n() would always answer `en` here). Residents reach it from
 * translated pages, though, and NYC Local Law 30 covers them, so these
 * pages speak the language the reader last chose, from the cookie
 * middleware keeps — all of them: the root layout stamps this locale on
 * <html> (so the localized <title> is read in its own language), the site
 * header's sign-in variant takes its labels from here, and the pages put
 * the same lang/dir on their <main>.
 */
export const loginI18n = cache(async (): Promise<I18n> => {
  const locale = asLocale((await cookies()).get(LANG_COOKIE)?.value);
  return {
    locale,
    info: localeInfo(locale),
    m: messagesFor(locale),
    href: (path: string) => localizeHref(locale, path),
  };
});
