import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Reusable source-leak blocklist for benchmark and golden-set evaluations.
 *
 * Blocks answer-key reports, repositories, mirror pages, and spreadsheets at
 * three independent layers:
 * 1. Egress (`guardedFetch` / `assertPublicHttpsUrl`) throws `EgressBlockedError`
 *    before touching DNS or the network.
 * 2. Prompt instructions (`renderBlocklistInstructions`) forbid citing or
 *    fetching the blocked report and direct researchers to primary sources.
 * 3. Post-run audit (`auditSourceLeaks`) inspects all findings and transcripts
 *    deterministically and flags any blocked domain, URL, DOI, or citation.
 */

export interface SourceBlocklist {
  /** Exact domains and all subdomains to block (e.g. "caldec.org" blocks "www.caldec.org"). */
  domains?: readonly string[];
  /** Case-insensitive substrings matched against raw and URL-decoded candidate URLs/text. */
  urlSubstrings?: readonly string[];
  /** Regular expressions matched against raw and URL-decoded candidate URLs/text. */
  patterns?: readonly RegExp[];
  /** Human-readable name for logs, errors, and prompt instructions. */
  label?: string;
}

export interface BlockedSourceMatch {
  matched: true;
  url: string;
  ruleType: 'domain' | 'urlSubstring' | 'pattern';
  rule: string;
  label?: string;
  reason: string;
}

export interface SourceLeakRecord {
  location: 'finding' | 'tool_call' | 'transcript';
  indicatorSlug?: string;
  toolName?: string;
  field?: string;
  matchedText: string;
  match: BlockedSourceMatch;
}

export interface SourceLeakAuditResult {
  clean: boolean;
  leakCount: number;
  findingLeaks: SourceLeakRecord[];
  toolCallLeaks: SourceLeakRecord[];
  transcriptLeaks: SourceLeakRecord[];
  leaks: SourceLeakRecord[];
  leakedIndicatorSlugs: string[];
}

export const BLOCKLIST_INSTRUCTIONS_START = '<!-- SOURCE_BLOCKLIST_START -->';
export const BLOCKLIST_INSTRUCTIONS_END = '<!-- SOURCE_BLOCKLIST_END -->';

function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

function safeDecodeUri(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function safeRegex(re: RegExp): RegExp {
  const flags = re.flags.replace(/[gy]/g, '');
  return new RegExp(re.source, flags);
}

function hostMatchesDomain(hostname: string, blockedDomain: string): boolean {
  const host = normalizeHost(hostname);
  const domain = normalizeHost(blockedDomain).replace(/^https?:\/\//, '').split('/')[0] ?? '';
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Pure: test whether a candidate URL or source string matches any rule in `blocklist`.
 * Returns structured match details when blocked, or `null` when allowed.
 */
export function matchBlockedSource(
  candidate: string,
  blocklist?: SourceBlocklist | null,
): BlockedSourceMatch | null {
  if (!blocklist || !candidate || typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const decoded = safeDecodeUri(trimmed);
  const lowerRaw = trimmed.toLowerCase();
  const lowerDecoded = decoded.toLowerCase();
  const label = blocklist.label?.trim() || undefined;
  const labelPrefix = label ? `${label}: ` : '';

  // 1. Domain matching (URL host, or bare host-like token).
  let hostname: string | null = null;
  try {
    hostname = new URL(trimmed).hostname;
  } catch {
    // Also check if candidate starts with a bare host/path (e.g. "caldec.org/report")
    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed)) {
      try {
        hostname = new URL(`https://${trimmed}`).hostname;
      } catch {
        hostname = null;
      }
    }
  }

  if (hostname && blocklist.domains?.length) {
    for (const domain of blocklist.domains) {
      if (!domain.trim()) continue;
      if (hostMatchesDomain(hostname, domain)) {
        return {
          matched: true,
          url: trimmed,
          ruleType: 'domain',
          rule: domain,
          ...(label ? { label } : {}),
          reason: `${labelPrefix}domain "${domain}" is blocked`,
        };
      }
    }
  }

  // 2. Case-insensitive substring matching (raw and decoded URL forms).
  if (blocklist.urlSubstrings?.length) {
    for (const sub of blocklist.urlSubstrings) {
      const needle = sub.trim().toLowerCase();
      if (!needle) continue;
      if (lowerRaw.includes(needle) || lowerDecoded.includes(needle)) {
        return {
          matched: true,
          url: trimmed,
          ruleType: 'urlSubstring',
          rule: sub,
          ...(label ? { label } : {}),
          reason: `${labelPrefix}URL matches blocked substring "${sub}"`,
        };
      }
    }
  }

  // 3. RegExp matching (raw and decoded URL forms, stateless without /g or /y).
  if (blocklist.patterns?.length) {
    for (const pattern of blocklist.patterns) {
      const re = safeRegex(pattern);
      if (re.test(trimmed) || re.test(decoded)) {
        return {
          matched: true,
          url: trimmed,
          ruleType: 'pattern',
          rule: pattern.toString(),
          ...(label ? { label } : {}),
          reason: `${labelPrefix}URL matches blocked pattern ${pattern.toString()}`,
        };
      }
    }
  }

  return null;
}

interface CaliforniaManifestSubset {
  repository?: string;
}

interface CaliforniaReportAuditSubset {
  report?: {
    title?: string;
    doi?: string;
    record_url?: string;
    download_url?: string;
  };
  workbook?: {
    url?: string;
  };
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function defaultCaliforniaBlocklistData(): {
  domains: string[];
  urlSubstrings: string[];
  patterns: RegExp[];
} {
  return {
    domains: [
      'caldec.org',
      'californiadoughnut.org',
      'californiadoughnuteconomics.org',
      'cadoughnut.org',
      'ca-doughnut.org',
    ],
    urlSubstrings: [
      // Zenodo 2025 California Doughnut Snapshot & Report record + PDF download + DOI
      'zenodo.org/records/17540639',
      'zenodo.org/record/17540639',
      '10.5281/zenodo.17540639',
      'california doughnut economics report 2025',
      'california doughnut economics report',
      'california doughnut snapshot and report',
      'california-doughnut-economics-report',
      'california_doughnut_economics_report',
      // CalDEC live supporting workbook (report-audit.json)
      '1uDvJsNbIMJbEMhPio4KzxKuxeIAPaDr8HRmII_kk36w',
      // Imported California snapshot repository & raw files (manifest.json)
      'github.com/jglasskatz/ca-doughnut',
      'raw.githubusercontent.com/jglasskatz/ca-doughnut',
      'api.github.com/repos/jglasskatz/ca-doughnut',
      // Deep Fryer hosted pages & repository itself (prevents self-citation answer leak)
      'jglasskatz.github.io/deep-fryer',
      'github.com/jglasskatz/deep-fryer',
      'raw.githubusercontent.com/jglasskatz/deep-fryer',
      'api.github.com/repos/jglasskatz/deep-fryer',
    ],
    patterns: [
      /\bdoughnuteconomics\.org\/[^\s"'<>)]*(?:california|caldec|ca-doughnut)/i,
      /\b(?:www\.)?caldec\.org\b/i,
      /\bcalifornia[-_%20+\s]*doughnut(?:[-_%20+\s]*(?:economics|snapshot|report|coalition))?/i,
      /\bzenodo\.org\/records?\/17540639\b/i,
      /\b10\.5281\/zenodo\.17540639\b/i,
      /\bdocs\.google\.com\/spreadsheets\/d\/1uDvJsNbIMJbEMhPio4KzxKuxeIAPaDr8HRmII_kk36w\b/i,
      /\bjglasskatz\.github\.io\/deep-fryer\b/i,
      /\b(?:github\.com|raw\.githubusercontent\.com|api\.github\.com\/repos)\/jglasskatz\/(?:ca-doughnut|deep-fryer)\b/i,
    ],
  };
}

/**
 * Derive the California 2025 Report Answer-Key Blocklist directly from
 * `site/imports/california/manifest.json` and `site/imports/california/report-audit.json`
 * (when `repoRoot` is supplied or discoverable), merged with canonical CalDEC,
 * DEAL California report page, and Deep Fryer self-mirror blocks.
 */
export function buildCaliforniaReportBlocklist(repoRoot?: string): SourceBlocklist {
  const base = defaultCaliforniaBlocklistData();
  const extraSubstrings: string[] = [];

  if (repoRoot) {
    const manifestPath = path.join(repoRoot, 'site', 'imports', 'california', 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CaliforniaManifestSubset;
      if (manifest.repository) {
        const repoNoProto = stripProtocol(manifest.repository);
        extraSubstrings.push(repoNoProto);
        const ghMatch = /^github\.com\/([^/]+\/[^/]+)$/i.exec(repoNoProto);
        if (ghMatch?.[1]) {
          extraSubstrings.push(`raw.githubusercontent.com/${ghMatch[1]}`);
          extraSubstrings.push(`api.github.com/repos/${ghMatch[1]}`);
        }
      }
    }

    const auditPath = path.join(repoRoot, 'site', 'imports', 'california', 'report-audit.json');
    if (existsSync(auditPath)) {
      const audit = JSON.parse(readFileSync(auditPath, 'utf8')) as CaliforniaReportAuditSubset;
      if (audit.report?.record_url) extraSubstrings.push(stripProtocol(audit.report.record_url));
      if (audit.report?.download_url) {
        extraSubstrings.push(stripProtocol(audit.report.download_url).split('?')[0]!);
      }
      if (audit.report?.doi) extraSubstrings.push(audit.report.doi);
      if (audit.report?.title) extraSubstrings.push(audit.report.title);
      if (audit.workbook?.url) {
        const sheetMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(audit.workbook.url);
        if (sheetMatch?.[1]) extraSubstrings.push(sheetMatch[1]);
        extraSubstrings.push(stripProtocol(audit.workbook.url).replace(/\/edit$/, ''));
      }
    }
  }

  return Object.freeze({
    label: 'California 2025 Doughnut Report answer-key blocklist',
    domains: Object.freeze(dedupeStrings(base.domains)),
    urlSubstrings: Object.freeze(dedupeStrings([...base.urlSubstrings, ...extraSubstrings])),
    patterns: Object.freeze([...base.patterns]),
  });
}

/**
 * Canonical California 2025 Report Answer-Key Blocklist.
 *
 * Blocks the California Doughnut Economics Coalition (CalDEC) 2025 report
 * (Zenodo record 17540639 & PDF, CalDEC websites, live workbook), the
 * `jglasskatz/ca-doughnut` import repository, `doughnuteconomics.org`
 * California report pages, and `jglasskatz.github.io/deep-fryer` so benchmark
 * sessions must discover primary state and federal sources (U.S. Census ACS,
 * HUD, CARB, CalEPA, CDPH, EPA, BLS, PPIC, etc.).
 */
export const CALIFORNIA_REPORT_BLOCKLIST: SourceBlocklist = buildCaliforniaReportBlocklist();

/**
 * Render explicit, prompt-safe benchmark instructions forbidding fetching,
 * searching for, or citing any blocked answer-key source. Wrapped in sentinel
 * HTML comments so `auditSourceLeaks` never false-positives on its own rules.
 */
export function renderBlocklistInstructions(blocklist: SourceBlocklist): string {
  const label = blocklist.label ?? 'Benchmark answer-key blocklist';
  const lines: string[] = [
    BLOCKLIST_INSTRUCTIONS_START,
    `## STRICT BENCHMARK SOURCE ISOLATION (${label})`,
    '',
    'You are running an independent primary-source benchmark. You MUST NOT search for, fetch, quote, or cite any blocked answer-key report, mirror, spreadsheet, or repository.',
    'All HTTP requests to blocked sources are hard-blocked at the egress layer, and any finding or tool call referencing them will automatically FAIL the benchmark as a source leak.',
    '',
    'Instead, discover and cite primary state, federal, or authoritative institutional sources directly (for example: U.S. Census Bureau / ACS, HUD Point-in-Time reports, California Air Resources Board (CARB), CalEPA / OEHHA, CDPH, California State Water Resources Control Board, U.S. EPA, BLS, EIA, PPIC, CHCF, etc.).',
  ];

  if (blocklist.domains?.length) {
    lines.push('', 'Blocked domains (including all subdomains):');
    for (const d of blocklist.domains) lines.push(`- ${d}`);
  }
  if (blocklist.urlSubstrings?.length) {
    lines.push('', 'Blocked URLs, DOIs, and report identifiers:');
    for (const s of blocklist.urlSubstrings) lines.push(`- ${s}`);
  }
  if (blocklist.patterns?.length) {
    lines.push('', 'Additional blocked URL patterns:');
    for (const p of blocklist.patterns) lines.push(`- ${p.toString()}`);
  }
  lines.push(BLOCKLIST_INSTRUCTIONS_END);
  return lines.join('\n');
}

const URL_REGEX = /https?:\/\/[^\s"'<>)\]}]+/gi;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) ?? [];
  return matches.map((u) => u.replace(/[.,;:!?]+$/, ''));
}

function stripBlocklistInstructions(text: string): string {
  const startEsc = BLOCKLIST_INSTRUCTIONS_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEsc = BLOCKLIST_INSTRUCTIONS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${startEsc}[\\s\\S]*?${endEsc}`, 'g'), '');
}

function decodeTranscriptInput(transcript: string | Buffer | readonly unknown[] | null | undefined): {
  frames?: readonly unknown[];
  text?: string;
} {
  if (!transcript) return {};
  if (Array.isArray(transcript)) return { frames: transcript };
  let rawText: string;
  if (Buffer.isBuffer(transcript)) {
    const isGzip = transcript.length >= 2 && transcript[0] === 0x1f && transcript[1] === 0x8b;
    rawText = (isGzip ? gunzipSync(transcript) : transcript).toString('utf8');
  } else if (typeof transcript === 'string') {
    rawText = transcript;
  } else {
    return {};
  }
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return {};
  const parsedFrames: unknown[] = [];
  let allJson = true;
  for (const line of lines) {
    if (!line.startsWith('{') && !line.startsWith('[')) {
      allJson = false;
      break;
    }
    try {
      parsedFrames.push(JSON.parse(line));
    } catch {
      allJson = false;
      break;
    }
  }
  if (allJson && parsedFrames.length > 0) {
    return { frames: parsedFrames };
  }
  return { text: rawText };
}

function checkTextForLeak(
  text: string,
  blocklist: SourceBlocklist,
): { matchedText: string; match: BlockedSourceMatch } | null {
  const cleaned = stripBlocklistInstructions(text);
  if (!cleaned.trim()) return null;

  // Prefer matching concrete URLs embedded in the string first for crisp reporting.
  for (const url of extractUrls(cleaned)) {
    const m = matchBlockedSource(url, blocklist);
    if (m) return { matchedText: url, match: m };
  }

  // Also test the full string (catches bare DOIs, domain names, or report titles in source_name / queries).
  const direct = matchBlockedSource(cleaned, blocklist);
  if (direct) return { matchedText: cleaned.slice(0, 240), match: direct };

  // Test bare domain mentions (e.g. "caldec.org" in a WebSearch query or source_name).
  if (blocklist.domains?.length) {
    const lower = cleaned.toLowerCase();
    for (const domain of blocklist.domains) {
      const norm = normalizeHost(domain);
      if (!norm) continue;
      const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?:^|[^a-z0-9.-])${escaped}(?:$|[^a-z0-9-])`, 'i').test(lower)) {
        const m = matchBlockedSource(`https://${norm}`, blocklist);
        if (m) return { matchedText: norm, match: m };
      }
    }
  }

  return null;
}

function collectStrings(value: unknown, prefix = ''): Array<{ field: string; text: string }> {
  if (typeof value === 'string') {
    return [{ field: prefix || 'value', text: value }];
  }
  if (Array.isArray(value)) {
    const out: Array<{ field: string; text: string }> = [];
    for (let i = 0; i < value.length; i++) {
      out.push(...collectStrings(value[i], `${prefix}[${i}]`));
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Array<{ field: string; text: string }> = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      out.push(...collectStrings(v, next));
    }
    return out;
  }
  return [];
}

function extractToolCallsFromFrame(frame: unknown): Array<{ toolName: string; input: unknown }> {
  if (!frame || typeof frame !== 'object') return [];
  const obj = frame as Record<string, unknown>;
  const calls: Array<{ toolName: string; input: unknown }> = [];

  // Anthropic SDK assistant message: { type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } }
  const contentBlocks =
    Array.isArray(obj.content)
      ? obj.content
      : obj.message && typeof obj.message === 'object' && Array.isArray((obj.message as Record<string, unknown>).content)
        ? ((obj.message as Record<string, unknown>).content as unknown[])
        : [];
  for (const block of contentBlocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'tool_use' && typeof b.name === 'string') {
      calls.push({ toolName: b.name, input: b.input });
    }
    if (b.type === 'server_tool_use' && typeof b.name === 'string') {
      calls.push({ toolName: b.name, input: b.input });
    }
  }

  // OpenAI tool_calls: { tool_calls: [{ function: { name, arguments } }] }
  if (Array.isArray(obj.tool_calls)) {
    for (const tc of obj.tool_calls) {
      if (!tc || typeof tc !== 'object') continue;
      const t = tc as Record<string, unknown>;
      const fn = t.function as Record<string, unknown> | undefined;
      if (fn && typeof fn.name === 'string') {
        calls.push({ toolName: fn.name, input: fn.arguments });
      }
    }
  }

  // Direct tool-call frame formats (e.g., Gemini functionCall or custom worker transcript events)
  if (obj.type === 'tool_use' || obj.type === 'tool_call' || obj.type === 'function_call') {
    const name = typeof obj.name === 'string' ? obj.name : typeof obj.tool === 'string' ? obj.tool : 'tool';
    calls.push({ toolName: name, input: obj.input ?? obj.arguments ?? obj.args ?? obj.params });
  }
  if (obj.functionCall && typeof obj.functionCall === 'object') {
    const fc = obj.functionCall as Record<string, unknown>;
    if (typeof fc.name === 'string') {
      calls.push({ toolName: fc.name, input: fc.args });
    }
  }
  // Gemini candidates/parts structure
  if (Array.isArray(obj.parts)) {
    for (const part of obj.parts) {
      calls.push(...extractToolCallsFromFrame(part));
    }
  }

  return calls;
}

function isPromptOrSystemFrame(frame: unknown): boolean {
  if (!frame || typeof frame !== 'object') return false;
  const obj = frame as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  const role = typeof obj.role === 'string' ? obj.role.toLowerCase() : '';
  return type === 'system' || role === 'system' || type === 'init';
}

function extractAssistantTextFromFrame(frame: unknown): string[] {
  if (!frame || typeof frame !== 'object') return [];
  const obj = frame as Record<string, unknown>;
  if (isPromptOrSystemFrame(obj)) return [];
  const role = typeof obj.role === 'string' ? obj.role.toLowerCase() : '';
  const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
  // Skip raw user prompt frames unless they contain tool calls (user prompt holds our blocklist instructions).
  if (role === 'user' || type === 'user') return [];

  const texts: string[] = [];
  if (typeof obj.result === 'string') texts.push(obj.result);
  if (typeof obj.text === 'string') texts.push(obj.text);
  if (typeof obj.content === 'string') texts.push(obj.content);

  const blocks =
    Array.isArray(obj.content)
      ? obj.content
      : obj.message && typeof obj.message === 'object' && Array.isArray((obj.message as Record<string, unknown>).content)
        ? ((obj.message as Record<string, unknown>).content as unknown[])
        : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      texts.push(b.text);
    }
  }
  return texts;
}

function resolveFindingSlug(finding: unknown): string | undefined {
  if (!finding || typeof finding !== 'object') return undefined;
  const obj = finding as Record<string, unknown>;
  if (typeof obj.indicatorSlug === 'string' && obj.indicatorSlug) return obj.indicatorSlug;
  if (typeof obj.indicator_slug === 'string' && obj.indicator_slug) return obj.indicator_slug;
  if (obj.payload && typeof obj.payload === 'object') {
    const p = obj.payload as Record<string, unknown>;
    if (typeof p.indicator_slug === 'string' && p.indicator_slug) return p.indicator_slug;
  }
  return undefined;
}

/**
 * Deterministic post-run leak audit: inspects every finding (URLs, source
 * names, notes, gaps, narratives) AND every tool call / assistant output in
 * the transcript (gzipped JSONL, raw JSONL, structured array, or plain text),
 * flagging ANY reference to a blocked domain, URL, DOI, or report artifact.
 */
export function auditSourceLeaks(
  findings: readonly unknown[],
  transcript: string | Buffer | readonly unknown[] | null | undefined,
  blocklist: SourceBlocklist,
): SourceLeakAuditResult {
  const findingLeaks: SourceLeakRecord[] = [];
  const toolCallLeaks: SourceLeakRecord[] = [];
  const transcriptLeaks: SourceLeakRecord[] = [];
  const leakedSlugs = new Set<string>();
  const seenKey = new Set<string>();

  const pushUnique = (target: SourceLeakRecord[], rec: SourceLeakRecord) => {
    const key = `${rec.location}|${rec.indicatorSlug ?? ''}|${rec.toolName ?? ''}|${rec.field ?? ''}|${rec.matchedText}`;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    target.push(rec);
  };

  // 1. Audit every finding object recursively.
  for (const finding of findings) {
    const slug = resolveFindingSlug(finding);
    for (const { field, text } of collectStrings(finding)) {
      const hit = checkTextForLeak(text, blocklist);
      if (hit) {
        if (slug) leakedSlugs.add(slug);
        pushUnique(findingLeaks, {
          location: 'finding',
          ...(slug ? { indicatorSlug: slug } : {}),
          field,
          matchedText: hit.matchedText,
          match: hit.match,
        });
      }
    }
  }

  // 2. Audit transcript tool calls & assistant text.
  const decoded = decodeTranscriptInput(transcript);
  if (decoded.frames) {
    for (const frame of decoded.frames) {
      for (const call of extractToolCallsFromFrame(frame)) {
        for (const { field, text } of collectStrings(call.input, 'input')) {
          const hit = checkTextForLeak(text, blocklist);
          if (hit) {
            pushUnique(toolCallLeaks, {
              location: 'tool_call',
              toolName: call.toolName,
              field,
              matchedText: hit.matchedText,
              match: hit.match,
            });
          }
        }
      }
      for (const text of extractAssistantTextFromFrame(frame)) {
        const hit = checkTextForLeak(text, blocklist);
        if (hit) {
          pushUnique(transcriptLeaks, {
            location: 'transcript',
            matchedText: hit.matchedText,
            match: hit.match,
          });
        }
      }
    }
  } else if (decoded.text) {
    const cleaned = stripBlocklistInstructions(decoded.text);
    const urls = extractUrls(cleaned);
    let foundAnyUrl = false;
    for (const url of urls) {
      const m = matchBlockedSource(url, blocklist);
      if (m) {
        foundAnyUrl = true;
        pushUnique(transcriptLeaks, {
          location: 'transcript',
          matchedText: url,
          match: m,
        });
      }
    }
    if (!foundAnyUrl) {
      const hit = checkTextForLeak(cleaned, blocklist);
      if (hit) {
        pushUnique(transcriptLeaks, {
          location: 'transcript',
          matchedText: hit.matchedText,
          match: hit.match,
        });
      }
    }
  }

  const leaks = [...findingLeaks, ...toolCallLeaks, ...transcriptLeaks];
  return {
    clean: leaks.length === 0,
    leakCount: leaks.length,
    findingLeaks,
    toolCallLeaks,
    transcriptLeaks,
    leaks,
    leakedIndicatorSlugs: [...leakedSlugs].sort(),
  };
}
