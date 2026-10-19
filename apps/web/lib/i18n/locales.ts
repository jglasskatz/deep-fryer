/**
 * Languages of the public plane (SPEC-v4 §7). English plus the ten
 * designated citywide languages of NYC Local Law 30 of 2017 — Spanish,
 * Chinese, Russian, Bengali, Haitian Creole, Korean, Arabic, Urdu, French,
 * Polish — with Chinese offered in both Traditional and Simplified script,
 * as NYC agencies publish it. Other cities' most-requested languages are
 * nearly always within this set.
 *
 * `code` is the BCP 47 tag used for `<html lang>`, hreflang, and
 * Intl.PluralRules; `prefix` is the URL segment (`/es/nyc`), lowercase so
 * URLs are case-stable. English is the default and has no prefix.
 */
export const LOCALES = [
  { code: 'en', prefix: '', name: 'English', english: 'English', dir: 'ltr' },
  { code: 'es', prefix: 'es', name: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'zh-Hant', prefix: 'zh-hant', name: '繁體中文', english: 'Chinese (Traditional)', dir: 'ltr' },
  { code: 'zh-Hans', prefix: 'zh-hans', name: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'ru', prefix: 'ru', name: 'Русский', english: 'Russian', dir: 'ltr' },
  { code: 'bn', prefix: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr' },
  { code: 'ht', prefix: 'ht', name: 'Kreyòl Ayisyen', english: 'Haitian Creole', dir: 'ltr' },
  { code: 'ko', prefix: 'ko', name: '한국어', english: 'Korean', dir: 'ltr' },
  { code: 'ar', prefix: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl' },
  { code: 'ur', prefix: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl' },
  { code: 'fr', prefix: 'fr', name: 'Français', english: 'French', dir: 'ltr' },
  { code: 'pl', prefix: 'pl', name: 'Polski', english: 'Polish', dir: 'ltr' },
] as const;

export type LocaleInfo = (typeof LOCALES)[number];
export type Locale = LocaleInfo['code'];

export const DEFAULT_LOCALE: Locale = 'en';

const BY_CODE = new Map<string, LocaleInfo>(LOCALES.map((l) => [l.code, l]));
const BY_PREFIX = new Map<string, LocaleInfo>(
  LOCALES.filter((l) => l.prefix !== '').map((l) => [l.prefix, l]),
);

/** Narrow an untrusted string (header, cookie) to a supported locale. */
export function asLocale(value: string | null | undefined): Locale {
  return (value && BY_CODE.get(value)?.code) || DEFAULT_LOCALE;
}

export function localeInfo(locale: Locale): LocaleInfo {
  return BY_CODE.get(locale)!;
}

/** The locale a URL prefix names (case-insensitive), or null. */
export function localeForPrefix(segment: string): Locale | null {
  return BY_PREFIX.get(segment.toLowerCase())?.code ?? null;
}

/** Every non-English URL prefix — reserved as portrait/organization slugs. */
export const LOCALE_PREFIXES: readonly string[] = [...BY_PREFIX.keys()];
