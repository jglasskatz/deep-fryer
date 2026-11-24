import type { ValueOnPage } from '@deep-fryer/core';

/**
 * A cheap check run before the verifier: does the number a finding claims
 * appear in the readable text kept with its captured page? It looks for the
 * usual ways a figure is written (12.3, 12.30, 12.3%, 12.3 percent, 45,000,
 * 1.2 million, $1.2M), as a whole number on the page, never as part of a
 * longer one: 12 is not found inside 2012 or 12.5. "Found" means only that
 * the figure is on the page; whether it is the right figure for the right
 * place and year is still the verifier's judgement.
 *
 * A claim with a scale ("1.2 million", "45K") is also found as its bare
 * figure when the page names that scale beside it, as a table headed
 * "(millions)" does; the bare figure alone is not enough, since "1.2%" or
 * "Table 45" would then count.
 *
 * A value that is words rather than a number ("Yes", "1 in 5",
 * "12.3 per 1,000", "50–60%") is looked for as that phrase, ignoring case
 * and spacing, with its numbers' thousands separators, its dashes and its
 * percent sign written any of the usual ways.
 */

const SCALES: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
};

/**
 * One number as written on a page: digits with optional comma or narrow
 * space thousands groups and an optional decimal part (or a bare ".5"),
 * then optionally a scale word ("1.2 million") or an attached letter ("45K",
 * "1.2M", "3bn"). The lookbehinds keep it from starting inside a longer
 * number ("2012", "3.12"); the lookaheads keep it from stopping inside one.
 */
const PAGE_NUMBER =
  /(?<!\d)(?<!\d[.,])(?:(\d{1,3}(?:[,  ]\d{3})+|\d+)(?:\.(\d+))?|\.(\d+))(?!\d)(?![.,]\d)(?:\s?([Tt]housand|[Mm]illion|[Bb]illion|[Tt]rillion|THOUSAND|MILLION|BILLION|TRILLION)\b|(K|k|M|B|bn)(?![A-Za-z]))?/g;

/** A claimed value written as a number, with any approximate or minus sign, currency, percent sign or scale around it. */
const CLAIMED_NUMBER =
  /^[~≈]?\s*[+\-−–]?\s*[$€£¥]?\s*(\d{1,3}(?:[,   ]\d{3})+|\d+)?(?:\.(\d+))?\s*(%|percent|per\s*cent|thousand|million|billion|trillion|bn|k|m|b)?\s*$/i;

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** The figure a claimed value stands for and, if it carried a scale, the bare figure before that scale. */
interface Claimed {
  figure: number;
  bare?: { base: number; scale: number };
}

function claimedNumber(value: number | string): Claimed | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { figure: Math.abs(value) } : null;
  const match = CLAIMED_NUMBER.exec(value.trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const whole = (match[1] ?? '0').replace(/[,\u00A0\u202F ]/g, '');
  const base = Number(`${whole}.${match[2] ?? '0'}`);
  if (!Number.isFinite(base)) return null;
  const scale = SCALES[(match[3] ?? '').toLowerCase()];
  return scale ? { figure: base * scale, bare: { base, scale } } : { figure: base };
}

/** One number written in the text: its figure as written, its scale if one was attached, and where it sits. */
interface PageNumber {
  base: number;
  scale?: number;
  start: number;
  end: number;
}

function* pageNumbers(text: string): Generator<PageNumber> {
  for (const match of text.matchAll(PAGE_NUMBER)) {
    const whole = match[3] !== undefined ? '0' : match[1]!.replace(/[,\u00A0\u202F]/g, '');
    const fraction = match[3] ?? match[2] ?? '0';
    const base = Number(`${whole}.${fraction}`);
    if (!Number.isFinite(base)) continue;
    const scale = SCALES[(match[4] ?? match[5] ?? '').toLowerCase()];
    yield { base, scale, start: match.index, end: match.index + match[0].length };
  }
}

const SCALE_WORDS: Record<number, RegExp> = {
  1e3: /\bthousands?\b/i,
  1e6: /\bmillions?\b/i,
  1e9: /\bbillions?\b/i,
  1e12: /\btrillions?\b/i,
};

/** How far from a bare figure a scale word may sit and still name its scale: a table heading or the words just after it. */
const SCALE_WORD_BEFORE = 300;
const SCALE_WORD_AFTER = 60;

/** Whether a bare page figure is followed by a percent sign, which no scale word can turn into a count. */
function isPercent(text: string, end: number): boolean {
  return /^\s*(?:%|percent\b|per\s*cent\b)/i.test(text.slice(end, end + 12));
}

function namesScaleNearby(text: string, found: PageNumber, scale: number): boolean {
  const word = SCALE_WORDS[scale];
  if (!word) return false;
  const around = text.slice(Math.max(0, found.start - SCALE_WORD_BEFORE), found.end + SCALE_WORD_AFTER);
  return word.test(around);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A digit run written with or without thousands separators: "1,000", "1 000" and "1000" match one another. */
function flexibleDigits(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return groups.join('[,\u00A0\u202F]?');
}

/** A phrase as a pattern: any spacing, numbers with or without separators, any dash, and % or "percent". */
function phrasePattern(phrase: string): RegExp {
  const parts: string[] = [];
  const token = /(\d{1,3}(?:[,\u00A0\u202F]\d{3})+|\d+)|(\s*[-–—]\s*)|(\s*%)|(\s+)|([^\d\s\-–—%]+)/gu;
  for (const [, number, dash, percent, space, other] of phrase.matchAll(token)) {
    if (number !== undefined) parts.push(flexibleDigits(number.replace(/[,\u00A0\u202F]/g, '')));
    else if (dash !== undefined) parts.push('\\s*[-–—]\\s*');
    else if (percent !== undefined) parts.push('\\s*(?:%|percent|per\\s*cent)');
    else if (space !== undefined) parts.push('\\s+');
    else parts.push(escapeRegExp(other!));
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('')}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Whether a claimed value appears in the text in one of its usual written forms. */
export function valueAppearsInText(value: number | string, text: string): boolean {
  const wanted = claimedNumber(value);
  if (wanted) {
    for (const found of pageNumbers(text)) {
      // A claim of 1.2 (in a unit of millions) is on a page that says "1.2 million".
      if (sameNumber(wanted.figure, found.base)) return true;
      if (found.scale && sameNumber(wanted.figure, found.base * found.scale)) return true;
      // "1.2 million" is on a page that says a bare "1.2" only beside the word "million(s)".
      const bare = wanted.bare;
      if (
        bare && !found.scale && sameNumber(bare.base, found.base) &&
        !isPercent(text, found.end) && namesScaleNearby(text, found, bare.scale)
      ) return true;
    }
    return false;
  }
  const phrase = String(value).trim();
  if (!phrase) return false;
  return phrasePattern(phrase).test(text);
}

/**
 * The value check's answer for one finding: `no_text` when there is no
 * stored text to look in (none was kept, it could not be read, or it holds
 * no words), otherwise whether the value was found.
 */
export function valueOnPage(value: number | string, text: string | null | undefined): ValueOnPage {
  if (text == null || !text.trim()) return 'no_text';
  return valueAppearsInText(value, text) ? 'found' : 'not_found';
}
