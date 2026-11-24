/**
 * Deterministic value-window extractor for finding triage (SPEC-JEV §4.0).
 *
 * Selects bounded ±1,500-character passages from archived source text around
 * occurrences of the claimed figure (or, when the figure is not printed
 * directly, around the highest-density indicator keyword windows), capped at
 * 6,000 characters total. Pure, deterministic, zero LLM calls.
 */

export const DEFAULT_WINDOW_RADIUS = 1_500;
export const DEFAULT_MAX_TOTAL_CHARS = 6_000;
export const DEFAULT_HEAD_CHARS = 1_500;
export const DEFAULT_MAX_WINDOWS = 6;

export interface PassageExtractionInput {
  sourceText: string;
  value: number | string;
  indicatorName?: string;
  indicatorSlug?: string;
  unit?: string;
  keywords?: readonly string[];
  windowRadius?: number;
  maxTotalChars?: number;
  headChars?: number;
  maxWindows?: number;
}

export interface ExtractedPassage {
  id: string;
  start: number;
  end: number;
  matchKind: 'value' | 'keyword' | 'head';
  text: string;
}

export interface PassageExtractionResult {
  documentHead: string;
  passages: ExtractedPassage[];
  valueFound: boolean;
  totalChars: number;
  sourceChars: number;
}

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

const SCALE_WORDS: Record<number, RegExp> = {
  1e3: /\bthousands?\b/i,
  1e6: /\bmillions?\b/i,
  1e9: /\bbillions?\b/i,
  1e12: /\btrillions?\b/i,
};

const PAGE_NUMBER =
  /(?<!\d)(?<!\d[.,])(?:(\d{1,3}(?:[,\u00A0\u202F]\d{3})+|\d+)(?:\.(\d+))?|\.(\d+))(?!\d)(?![.,]\d)(?:\s?([Tt]housand|[Mm]illion|[Bb]illion|[Tt]rillion|THOUSAND|MILLION|BILLION|TRILLION)\b|(K|k|M|B|bn)(?![A-Za-z]))?/g;

const CLAIMED_NUMBER =
  /^[~≈]?\s*[+\-−–]?\s*[$€£¥]?\s*(\d{1,3}(?:[,\u00A0\u202F ]\d{3})+|\d+)?(?:\.(\d+))?\s*(%|percent|per\s*cent|thousand|million|billion|trillion|bn|k|m|b)?\s*$/i;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'per', 'with', 'from', 'that', 'this', 'are', 'was',
  'were', 'has', 'have', 'had', 'not', 'all', 'who', 'into', 'over', 'under',
  'more', 'less', 'than', 'its', 'their', 'our', 'your', 'about', 'between',
  'among', 'within', 'without', 'using', 'based', 'share', 'rate', 'percent',
  'percentage', 'number', 'total', 'annual', 'year', 'years', 'population',
]);

interface ClaimedNumberSpec {
  figure: number;
  decimals: number | null;
  bare?: { base: number; scale: number };
}

interface TextHit {
  start: number;
  end: number;
  exact: boolean;
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function roundsToClaim(candidate: number, target: number, decimals: number): boolean {
  const factor = 10 ** decimals;
  return sameNumber(Math.round(candidate * factor) / factor, target);
}

function parseClaimedNumber(value: number | string): ClaimedNumberSpec | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const raw = String(Math.abs(value));
    const dot = raw.indexOf('.');
    const decimals = dot >= 0 ? raw.length - dot - 1 : 0;
    return { figure: Math.abs(value), decimals };
  }
  const match = CLAIMED_NUMBER.exec(value.trim());
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const whole = (match[1] ?? '0').replace(/[,\u00A0\u202F ]/g, '');
  const frac = match[2] ?? '';
  const base = Number(`${whole}.${frac || '0'}`);
  if (!Number.isFinite(base)) return null;
  const scale = SCALES[(match[3] ?? '').toLowerCase()];
  const decimals = frac.length;
  return scale
    ? { figure: base * scale, decimals: null, bare: { base, scale } }
    : { figure: base, decimals };
}

function isPercentAfter(text: string, end: number): boolean {
  return /^\s*(?:%|percent\b|per\s*cent\b)/i.test(text.slice(end, end + 12));
}

function namesScaleNearby(text: string, start: number, end: number, scale: number): boolean {
  const word = SCALE_WORDS[scale];
  if (!word) return false;
  const around = text.slice(Math.max(0, start - 300), end + 60);
  return word.test(around);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function flexibleDigits(digits: string): string {
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  }
  return groups.join('[,\u00A0\u202F]?');
}

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
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('')}(?![\\p{L}\\p{N}])`, 'giu');
}

function normalizeSourceText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findValueHits(text: string, value: number | string): TextHit[] {
  const spec = parseClaimedNumber(value);
  if (spec) {
    const exactHits: TextHit[] = [];
    const roundedHits: TextHit[] = [];
    for (const match of text.matchAll(PAGE_NUMBER)) {
      const start = match.index;
      const end = start + match[0].length;
      const whole = match[3] !== undefined ? '0' : match[1]!.replace(/[,\u00A0\u202F]/g, '');
      const fraction = match[3] ?? match[2] ?? '';
      const base = Number(`${whole}.${fraction || '0'}`);
      if (!Number.isFinite(base)) continue;
      const scale = SCALES[(match[4] ?? match[5] ?? '').toLowerCase()];

      if (sameNumber(spec.figure, base)) {
        exactHits.push({ start, end, exact: true });
        continue;
      }
      if (scale && sameNumber(spec.figure, base * scale)) {
        exactHits.push({ start, end, exact: true });
        continue;
      }
      if (
        spec.bare &&
        !scale &&
        sameNumber(spec.bare.base, base) &&
        !isPercentAfter(text, end) &&
        namesScaleNearby(text, start, end, spec.bare.scale)
      ) {
        exactHits.push({ start, end, exact: true });
        continue;
      }
      // Rounded variant: only when the source has strictly more precision than the claim
      // (e.g., source prints 61.24% while claim reports 61.2%), avoiding integer collisions.
      if (
        !scale &&
        spec.decimals !== null &&
        spec.decimals >= 1 &&
        fraction.length > spec.decimals &&
        roundsToClaim(base, spec.figure, spec.decimals)
      ) {
        roundedHits.push({ start, end, exact: false });
      }
    }
    return exactHits.length > 0 ? exactHits : roundedHits;
  }

  const phrase = String(value).trim();
  if (!phrase) return [];
  const pattern = phrasePattern(phrase);
  const hits: TextHit[] = [];
  for (const match of text.matchAll(pattern)) {
    hits.push({ start: match.index, end: match.index + match[0].length, exact: true });
  }
  return hits;
}

interface RawWindow {
  start: number;
  end: number;
  anchor: number;
  score: number;
}

function mergeWindows(windows: RawWindow[]): RawWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RawWindow[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const prev = merged[merged.length - 1]!;
    if (cur.start <= prev.end) {
      prev.end = Math.max(prev.end, cur.end);
      if (cur.score > prev.score) {
        prev.score = cur.score;
        prev.anchor = cur.anchor;
      }
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function extractKeywords(input: PassageExtractionInput): string[] {
  const rawParts = [
    input.indicatorName ?? '',
    (input.indicatorSlug ?? '').replace(/[-_]+/g, ' '),
    input.unit ?? '',
    ...(input.keywords ?? []),
  ];
  const terms = new Set<string>();
  for (const part of rawParts) {
    for (const token of part.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
      if (!STOPWORDS.has(token) && !/^\d+$/.test(token)) {
        terms.add(token);
      }
    }
  }
  return [...terms];
}

function findKeywordWindows(
  text: string,
  keywords: readonly string[],
  windowRadius: number,
): RawWindow[] {
  if (keywords.length === 0) return [];
  const hits: { pos: number; term: string }[] = [];
  for (const term of keywords) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}`, 'gi');
    let count = 0;
    for (const match of text.matchAll(re)) {
      hits.push({ pos: match.index, term });
      count++;
      if (count >= 40) break;
    }
  }
  if (hits.length === 0) return [];
  hits.sort((a, b) => a.pos - b.pos);

  // Cluster nearby keyword hits within windowRadius and score by distinct term coverage.
  const candidates: RawWindow[] = [];
  let clusterStart = 0;
  for (let i = 0; i < hits.length; i++) {
    while (hits[i]!.pos - hits[clusterStart]!.pos > windowRadius) {
      clusterStart++;
    }
    const distinct = new Set<string>();
    for (let j = clusterStart; j <= i; j++) distinct.add(hits[j]!.term);
    const totalHits = i - clusterStart + 1;
    const mid = Math.floor((hits[clusterStart]!.pos + hits[i]!.pos) / 2);
    candidates.push({
      start: Math.max(0, mid - windowRadius),
      end: Math.min(text.length, mid + windowRadius),
      anchor: mid,
      score: distinct.size * 10 + totalHits,
    });
  }

  // Greedily pick highest-scoring non-overlapping windows.
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked: RawWindow[] = [];
  for (const cand of candidates) {
    if (picked.some((p) => cand.start < p.end && cand.end > p.start)) continue;
    picked.push(cand);
    if (picked.length >= 12) break;
  }
  return picked;
}

function sliceWithinBudget(
  text: string,
  windows: RawWindow[],
  matchKind: 'value' | 'keyword',
  maxWindows: number,
  maxTotalChars: number,
): ExtractedPassage[] {
  const passages: ExtractedPassage[] = [];
  let remaining = maxTotalChars;
  for (const w of windows.slice(0, maxWindows)) {
    if (remaining <= 0) break;
    let start = Math.max(0, w.start);
    let end = Math.min(text.length, w.end);
    if (end - start > remaining) {
      // Keep the anchor centered inside the trimmed window when budget is tight.
      const half = Math.floor(remaining / 2);
      start = Math.max(w.start, w.anchor - half);
      end = Math.min(w.end, start + remaining);
      if (end - start < remaining) {
        start = Math.max(w.start, end - remaining);
      }
    }
    const slice = text.slice(start, end);
    if (!slice.trim()) continue;
    passages.push({
      id: `p${passages.length + 1}`,
      start,
      end,
      matchKind,
      text: slice,
    });
    remaining -= slice.length;
  }
  return passages;
}

/**
 * Extract bounded ±1,500-char value windows (falling back to top keyword
 * windows) from archived readable source text. Total passage text never
 * exceeds `maxTotalChars` (default 6,000 chars).
 */
export function extractValuePassages(input: PassageExtractionInput): PassageExtractionResult {
  const windowRadius = Math.max(100, input.windowRadius ?? DEFAULT_WINDOW_RADIUS);
  const maxTotalChars = Math.max(200, input.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS);
  const headChars = Math.max(0, input.headChars ?? DEFAULT_HEAD_CHARS);
  const maxWindows = Math.max(1, input.maxWindows ?? DEFAULT_MAX_WINDOWS);

  const normalized = normalizeSourceText(input.sourceText);
  if (!normalized) {
    return { documentHead: '', passages: [], valueFound: false, totalChars: 0, sourceChars: 0 };
  }

  const documentHead = normalized.slice(0, headChars);
  const valueHits = findValueHits(normalized, input.value);

  if (valueHits.length > 0) {
    const rawWindows: RawWindow[] = valueHits.map((hit) => ({
      start: Math.max(0, hit.start - windowRadius),
      end: Math.min(normalized.length, hit.end + windowRadius),
      anchor: Math.floor((hit.start + hit.end) / 2),
      score: hit.exact ? 2 : 1,
    }));
    const merged = mergeWindows(rawWindows);
    const passages = sliceWithinBudget(normalized, merged, 'value', maxWindows, maxTotalChars);
    const totalChars = passages.reduce((sum, p) => sum + p.text.length, 0);
    return {
      documentHead,
      passages,
      valueFound: true,
      totalChars,
      sourceChars: normalized.length,
    };
  }

  // Fallback: top indicator keyword windows.
  const keywords = extractKeywords(input);
  const keywordWindows = findKeywordWindows(normalized, keywords, windowRadius);
  if (keywordWindows.length > 0) {
    const passages = sliceWithinBudget(normalized, keywordWindows, 'keyword', maxWindows, maxTotalChars);
    const totalChars = passages.reduce((sum, p) => sum + p.text.length, 0);
    return {
      documentHead,
      passages,
      valueFound: false,
      totalChars,
      sourceChars: normalized.length,
    };
  }

  // Last-resort fallback: leading excerpt so unreadable/bot-block pages are still inspectable.
  const headSlice = normalized.slice(0, Math.min(maxTotalChars, windowRadius * 2));
  return {
    documentHead,
    passages: [{ id: 'p1', start: 0, end: headSlice.length, matchKind: 'head', text: headSlice }],
    valueFound: false,
    totalChars: headSlice.length,
    sourceChars: normalized.length,
  };
}
