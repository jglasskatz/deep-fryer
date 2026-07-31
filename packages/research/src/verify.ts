import type { PortraitConfig } from '@deep-fryer/contract';
import {
  findingPayloadSchema,
  type ContentSupported,
  type FindingPayload,
  type FindingVerification,
} from '@deep-fryer/core';

/**
 * Deterministic checks run before the verifier subagent (SPEC.md §8 Verify):
 * schema, URL resolution, recency policy, scale policy. Gap findings pass
 * url/recency/scale vacuously — a gap has nothing to fetch.
 */
export async function deterministicChecks(
  raw: unknown,
  config: PortraitConfig,
  dimensionSlug: string,
  fetchUrl: (url: string) => Promise<boolean> = defaultUrlCheck,
): Promise<{ payload: FindingPayload | null; checks: Omit<FindingVerification, 'content_supported' | 'verifier_note'> }> {
  const parsed = findingPayloadSchema.safeParse(raw);
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

  const maxAge =
    config.recency.per_dimension?.[dimensionSlug] ?? config.recency.default_max_age_years;
  const recencyOk = new Date().getFullYear() - payload.year <= maxAge;

  const scales =
    config.scale_policy.per_dimension?.[dimensionSlug] ?? config.scale_policy.default_accepted;
  const scaleOk = scales.includes(payload.geographic_scale);

  const urlOk = await fetchUrl(payload.source_url);

  return {
    payload,
    checks: { schema_ok: true, url_ok: urlOk, recency_ok: recencyOk, scale_ok: scaleOk },
  };
}

async function defaultUrlCheck(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    }
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function mergeVerification(
  checks: Omit<FindingVerification, 'content_supported' | 'verifier_note'>,
  verdict: { content_supported: ContentSupported; verifier_note?: string } | null,
): FindingVerification {
  return {
    ...checks,
    content_supported: verdict?.content_supported ?? 'uncertain',
    verifier_note:
      verdict?.verifier_note ??
      (verdict ? undefined : 'verifier session did not return a verdict'),
  };
}

/** A finding is red-flagged for review when any check fails (never dropped). */
export function isFlagged(v: FindingVerification): boolean {
  return (
    !v.schema_ok || !v.url_ok || !v.recency_ok || !v.scale_ok || v.content_supported !== 'pass'
  );
}
