import { LOCALES, type Locale } from './locales';

/**
 * The reader's preferred non-English language, if we can tell (SPEC-v7
 * §3.5): the language they chose on this site before (the df_lang cookie),
 * else the first browser language (Accept-Language, in q order) we have a
 * catalog for. Chinese picks its script by region: Taiwan, Hong Kong and
 * Macau read Traditional; other regions and bare "zh" read Simplified, unless
 * the tag names a script ("zh-Hant"). Returns null for English or no match.
 */
const CODES = new Set<string>(LOCALES.map((l) => l.code));

function fromTag(tag: string): Locale | null {
  const parts = tag.trim().split('-');
  const lang = parts[0]?.toLowerCase();
  if (!lang) return null;
  if (lang === 'zh') {
    const rest = parts.slice(1).map((p) => p.toLowerCase());
    if (rest.includes('hant') || rest.some((p) => ['tw', 'hk', 'mo'].includes(p))) return 'zh-Hant';
    return 'zh-Hans';
  }
  return CODES.has(lang) ? (lang as Locale) : null;
}

export function preferredLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale | null {
  if (cookie && CODES.has(cookie)) return cookie === 'en' ? null : (cookie as Locale);
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((entry, i) => {
      const [tag, ...params] = entry.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag ?? '', q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const locale = fromTag(tag);
    if (locale === 'en') return null;
    if (locale) return locale;
  }
  return null;
}
