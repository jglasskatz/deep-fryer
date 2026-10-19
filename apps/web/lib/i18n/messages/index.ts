import type { Locale } from '../locales';
import { ar } from './ar';
import { bn } from './bn';
import { en, type Messages } from './en';
import { es } from './es';
import { fr } from './fr';
import { ht } from './ht';
import { ko } from './ko';
import { pl } from './pl';
import { ru } from './ru';
import { ur } from './ur';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';

export type { Messages };

/**
 * Every catalog, typed against the English source: adding a key to en.ts
 * fails the typecheck until each language has it. Translations are drafts
 * for certified review (docs/language-access.md) before an agency relies on
 * them under Local Law 30.
 */
const CATALOGS: Record<Locale, Messages> = {
  en,
  es,
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
  ru,
  bn,
  ht,
  ko,
  ar,
  ur,
  fr,
  pl,
};

export function messagesFor(locale: Locale): Messages {
  return CATALOGS[locale];
}

export const ALL_CATALOGS: Readonly<Record<Locale, Messages>> = CATALOGS;
