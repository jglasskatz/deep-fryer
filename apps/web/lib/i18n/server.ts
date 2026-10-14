import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { asLocale, localeInfo, type Locale, type LocaleInfo } from './locales';
import { messagesFor, type Messages } from './messages';
import { localizeHref } from './routing';

/**
 * The request's language, as middleware resolved it from the URL prefix
 * (`x-df-locale`, always overwritten by middleware, so a client cannot
 * choose it by sending the header). Staff and product pages are always
 * English: middleware never gives them another locale.
 */
export const getLocale = cache(async (): Promise<Locale> => asLocale((await headers()).get('x-df-locale')));

/** The unprefixed path and query of this request, for the language switcher. */
export const getRequestPath = cache(async (): Promise<string> => (await headers()).get('x-df-path') ?? '/');

export interface I18n {
  locale: Locale;
  info: LocaleInfo;
  m: Messages;
  /** Same-language link: public-plane paths gain this request's prefix. */
  href: (path: string) => string;
}

export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return {
    locale,
    info: localeInfo(locale),
    m: messagesFor(locale),
    href: (path: string) => localizeHref(locale, path),
  };
});
