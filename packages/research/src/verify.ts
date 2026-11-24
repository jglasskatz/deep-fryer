import type { PortraitConfig } from '@deep-fryer/contract';
import {
  acceptedScales,
  findingPayloadSchema,
  isFlagged,
  isHomeOrSectionPage,
  maxDataAgeYears,
  storedFindingPayloadSchema,
  type ContentSupported,
  type FindingPayload,
  type FindingVerification,
  type ValueOnPage,
} from '@deep-fryer/core';
import { getActiveEgressBlocklist, guardedFetch } from './egress.js';
import { valueOnPage } from './page-text.js';
import { matchBlockedSource, type SourceBlocklist } from './source-blocklist.js';

export { isFlagged };

export interface DeterministicCheckOptions {
  allowProxy?: boolean;
  /**
   * When set (and `fetchUrl` is the default live probe), a finding whose
   * `evidence.snapshot_path` was freshly captured during the current run
   * short-circuits `defaultUrlCheck` to `true` after confirming the URL is
   * public HTTPS — avoiding `.gov` WAF false `url_ok: false` flags after
   * Playwright already loaded and archived the document.
   */
  runStartedAt?: Date | string;
  /**
   * Optional allowlist of snapshot paths confirmed captured by the worker
   * during this run; when provided, `evidence.snapshot_path` must be in this set
   * for the fresh-capture URL short-circuit to apply.
   */
  capturedSnapshotPaths?: ReadonlySet<string>;
  /** Optional source blocklist; blocked URLs never pass `url_ok`. */
  blocklist?: SourceBlocklist;
}

const VALID_SNAPSHOT_PATH = /^evidence\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.png$/;
const FRESH_CAPTURE_CLOCK_SKEW_MS = 60_000;

/**
 * Pure: true when `sourceUrl` is an https:// URL whose hostname is not an
 * obvious loopback/private literal and `evidence.snapshot_path` was freshly
 * captured in the current run window (and present in `capturedSnapshotPaths`
 * when supplied).
 */
export function isFreshRunCapture(
  sourceUrl: string,
  evidence: { snapshot_path: string; captured_at: string },
  options: Pick<DeterministicCheckOptions, 'runStartedAt' | 'capturedSnapshotPaths' | 'blocklist'>,
  nowMs = Date.now(),
): boolean {
  if (!options.runStartedAt && !options.capturedSnapshotPaths) return false;
  if (!VALID_SNAPSHOT_PATH.test(evidence.snapshot_path)) return false;
  if (options.capturedSnapshotPaths && !options.capturedSnapshotPaths.has(evidence.snapshot_path)) {
    return false;
  }
  const activeBlocklist = options.blocklist ?? getActiveEgressBlocklist();
  if (activeBlocklist && matchBlockedSource(sourceUrl, activeBlocklist)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.')
  ) {
    return false;
  }
  if (options.runStartedAt) {
    const startMs =
      options.runStartedAt instanceof Date
        ? options.runStartedAt.getTime()
        : Date.parse(options.runStartedAt);
    const capturedMs = Date.parse(evidence.captured_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(capturedMs)) return false;
    if (capturedMs < startMs - FRESH_CAPTURE_CLOCK_SKEW_MS || capturedMs > nowMs + FRESH_CAPTURE_CLOCK_SKEW_MS) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic checks run before the verifier subagent (SPEC.md §8 Verify):
 * schema, URL resolution, recency policy, scale policy, and whether the
 * cited link is only a home or section page. Gap findings pass
 * url/recency/scale vacuously — a gap has nothing to fetch. A stand-in is
 * checked exactly as a sourced indicator is.
 *
 * Only the pass that proposes stand-ins passes `allowProxy`: from any other
 * session a stand-in fails the schema check, so research that should have
 * reported a gap cannot slip a substitute measure into review instead.
 */
export async function deterministicChecks(
  raw: unknown,
  config: PortraitConfig,
  dimensionSlug: string,
  fetchUrl: (url: string) => Promise<boolean> = defaultUrlCheck,
  options: DeterministicCheckOptions = {},
): Promise<{ payload: FindingPayload | null; checks: Omit<FindingVerification, 'content_supported' | 'verifier_note'> }> {
  const schema = options.allowProxy ? storedFindingPayloadSchema : findingPayloadSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      payload: null,
      checks: { schema_ok: false, url_ok: false, recency_ok: false, scale_ok: false },
    };
  }
  const payload = parsed.data as FindingPayload;

  if (payload.kind === 'gap') {
    return {
      payload,
      checks: { schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true },
    };
  }

  const maxAge = maxDataAgeYears(config.recency, dimensionSlug);
  // Projections are not observations. A future year used to pass because its
  // negative age was always below the recency limit.
  const age = new Date().getUTCFullYear() - payload.year;
  const recencyOk = age >= 0 && age <= maxAge;

  const scaleOk = acceptedScales(config.scale_policy, dimensionSlug).includes(
    payload.geographic_scale,
  );

  const urlOk =
    fetchUrl === defaultUrlCheck && isFreshRunCapture(payload.source_url, payload.evidence, options)
      ? true
      : fetchUrl === defaultUrlCheck
        ? await defaultUrlCheck(payload.source_url, options.blocklist)
        : await fetchUrl(payload.source_url);

  return {
    payload,
    checks: {
      schema_ok: true,
      url_ok: urlOk,
      recency_ok: recencyOk,
      scale_ok: scaleOk,
      home_page_link: isHomeOrSectionPage(payload.source_url),
    },
  };
}

/**
 * The value check, run before the verifier: is the claimed value in the
 * readable text kept with the finding's captured page? `readText` returns
 * the stored text at a storage path; the caller supplies it, so this module
 * never touches storage. Evidence with no stored text, or text that cannot
 * be read, answers `no_text`: the check could not look, which is not the
 * same as the value being absent. A gap has no value and gets no answer.
 */
export async function checkValueOnPage(
  payload: FindingPayload,
  readText: (textPath: string) => Promise<string>,
): Promise<ValueOnPage | undefined> {
  if (payload.kind === 'gap') return undefined;
  const textPath = payload.evidence.text_path;
  if (!textPath) return 'no_text';
  let text: string;
  try {
    text = await readText(textPath);
  } catch {
    return 'no_text';
  }
  return valueOnPage(payload.value, text);
}

/**
 * Does the cited URL resolve? Goes through the egress guard: a citation
 * pointing at an internal address fails the check (url_ok: false) and is
 * red-flagged for review instead of being fetched.
 */
async function defaultUrlCheck(url: string, blocklist?: SourceBlocklist): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const fetchOpts = blocklist ? { blocklist } : {};
  try {
    let res = await guardedFetch(url, { method: 'HEAD', signal: controller.signal }, undefined, fetchOpts);
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await guardedFetch(url, { method: 'GET', signal: controller.signal }, undefined, fetchOpts);
    }
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function mergeVerification(
  checks: Omit<FindingVerification, 'content_supported' | 'verifier_note'>,
  verdict: {
    content_supported: ContentSupported;
    verifier_note?: string;
    narrative_supported?: ContentSupported;
    fail_reason?: string;
    suggested_disposition?: 'approve' | 'edit' | 're_research' | 'reject';
  } | null,
): FindingVerification {
  return {
    ...checks,
    content_supported: verdict?.content_supported ?? 'uncertain',
    verifier_note: verdict ? verdict.verifier_note : 'verifier session did not return a verdict',
    ...(verdict?.narrative_supported ? { narrative_supported: verdict.narrative_supported } : {}),
    ...(verdict?.fail_reason ? { fail_reason: verdict.fail_reason } : {}),
    ...(verdict?.suggested_disposition ? { suggested_disposition: verdict.suggested_disposition } : {}),
  };
}
