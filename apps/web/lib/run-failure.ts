/**
 * Why a research session failed, in plain words for staff (SPEC.md §8) —
 * pure, so the run page, the review queue and the tests share one reading.
 *
 * The worker records a failed session's reason only in its transcript
 * (apps/worker research-apply.ts, session.ts): either the Agent SDK's
 * message stream, whose main-loop assistant frames carry the API error that
 * stopped the session (SDKAssistantMessage.error), or — when the session
 * threw, or never started — a single `{"type":"session_error","message"}`
 * line. Transcripts are owner-only audit material (migration 0005), so
 * lib/review-data.ts reads them in the system context and hands only the
 * signals below to failureCause, which answers from a fixed set of causes.
 * The one message passed through verbatim is the worker's own staff-facing
 * reason for a run on the organization's own key (apps/worker org-key.ts),
 * which is written to be shown and never contains the key.
 */

import type { ResearchFunding } from '@deep-fryer/db';

/** What a transcript says about how its session ended; all optional, since a transcript may hold none of it. */
export interface TranscriptSignals {
  /** The worker's `session_error` line: the session threw, or was failed before it started. */
  sessionError?: string;
  /** The last API error on one of the session's own (main-loop) assistant frames. */
  apiError?: string;
  /** That frame's text: two refusals arrive as a plain invalid_request and only the text tells them apart. */
  apiErrorText?: string;
  /** The SDK result's subtype ('success', 'error_max_turns', …), if a result arrived. */
  resultSubtype?: string;
  resultIsError?: boolean;
}

/**
 * Pure: the signals in a decoded transcript (JSONL), or null for a session
 * with no transcript — one the worker failed without recording anything
 * (an interrupted run, or sessions still open when the run stopped on an
 * error). Lines are parsed only when they can matter, so a long transcript
 * of web searches costs one substring scan per line; malformed lines are
 * skipped, never fatal.
 */
export function transcriptSignals(jsonl: string | null): TranscriptSignals | null {
  if (jsonl === null) return null;
  const signals: TranscriptSignals = {};
  for (const line of jsonl.split('\n')) {
    const isSessionError = line.includes('"session_error"');
    const isResult = line.startsWith('{"type":"result"');
    const isErrorFrame = line.startsWith('{"type":"assistant"') && line.includes('"error":');
    if (!isSessionError && !isResult && !isErrorFrame) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (frame.type === 'session_error' && typeof frame.message === 'string') {
      signals.sessionError = frame.message;
      // A thrown session's line may also carry the API error that preceded
      // the throw (the CLI reports the error frame, then exits non-zero), in
      // the worker's own field names; without them the cause is inferred.
      if (typeof frame.api_error === 'string') signals.apiError = frame.api_error;
      if (typeof frame.api_error_text === 'string') signals.apiErrorText = frame.api_error_text.slice(0, 1000);
    } else if (frame.type === 'result') {
      if (typeof frame.subtype === 'string') signals.resultSubtype = frame.subtype;
      signals.resultIsError = frame.is_error === true;
    } else if (frame.type === 'assistant' && typeof frame.error === 'string' && !frame.parent_tool_use_id) {
      // A scout subagent's error (parent_tool_use_id set) did not stop the session.
      signals.apiError = frame.error;
      signals.apiErrorText = frameText(frame.message);
    }
  }
  return signals;
}

function frameText(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((block) => ((block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : ''))
    .join(' ')
    .trim();
  return text ? text.slice(0, 1000) : undefined;
}

/**
 * The causes staff can be told about. Each names who can act, because the
 * people reading it are not always the people who can fix it: the server's
 * own research key and model settings are for whoever runs the server; the
 * organization's own key is for an organization owner; the rest is worth
 * running again.
 */
export type FailureCauseKind =
  | 'organization_key'
  | 'service_not_configured'
  | 'service_billing'
  | 'service_model'
  | 'provider_unavailable'
  | 'out_of_turns'
  | 'unreadable_output'
  | 'interrupted'
  | 'stopped_unexpectedly';

export type FailureActor = 'operator' | 'organization_owner' | 'staff';

export interface FailureCause {
  kind: FailureCauseKind;
  /** A few words, beside the session's "failed" chip. */
  label: string;
  /** The full reason and what to do, said once per distinct cause. */
  message: string;
  actor: FailureActor;
}

export interface FailureContext {
  /** Whose key the run used (research_runs.funding). */
  funding: ResearchFunding;
  /**
   * Whether this deployment has a research key of its own
   * (DF_RESEARCH_KEY_CONFIGURED, lib/env.ts). Only used to explain a session
   * whose transcript gives no reason: on a plan-funded run with no key on the
   * server, that is why.
   */
  researchKeyConfigured: boolean;
  /** SUPPORT_EMAIL, for the causes only the people running the server can fix. */
  support: string | null;
}

/**
 * The worker's staff-facing reasons for a run on the organization's own key
 * (apps/worker org-key.ts ORG_KEY_* and orgKeyRejected) all end their first
 * sentence with this, and nothing else it records does.
 */
const ORG_KEY_REASON_MARK = "the deployment's own key is never used in its place";

/** Transient: Anthropic busy, rate limiting, or the connection dropping. The worker already retried once. */
const TRANSIENT_ERRORS = new Set(['rate_limit', 'overloaded', 'server_error']);
const TRANSIENT_TEXT =
  /overloaded|rate.?limit|\b(429|500|502|503|504|529)\b|timed? ?out|ECONNRESET|ETIMEDOUT|socket hang up|connection (closed|reset|error)/i;

/** The key itself refused (org-key.ts keyRejection) — on a plan-funded run, the server's key. */
const KEY_REFUSED_ERRORS = new Set(['authentication_failed', 'oauth_org_not_allowed']);
const KEY_REFUSED_TEXT = /belongs to a disabled organization|has disabled api key authentication/i;

/** How to reach the people who run this server: SUPPORT_EMAIL when the deployment has one. */
const operatorContact = (support: string | null) =>
  support ? `contact ${support}` : 'tell the people who run this server';

/** The closing sentence of every cause only the people who run the server can fix. */
const operatorFix = (support: string | null) =>
  support
    ? `This is for the people who run this server to fix, not you: contact ${support}.`
    : 'This is for the people who run this server to fix, not you; let them know.';

/**
 * Pure: the cause of one failed session, from its transcript's signals
 * (null: no transcript) and the run's context. Always answers: a failure
 * nothing explains is "stopped unexpectedly", and — on a plan-funded run
 * while the server has no research key — "not configured".
 */
export function failureCause(signals: TranscriptSignals | null, ctx: FailureContext): FailureCause {
  const notConfigured = (): FailureCause => ({
    kind: 'service_not_configured',
    label: 'research service not configured',
    message: `The research service isn't configured on this server — it has no working Anthropic key, so these sessions could not run. ${operatorFix(ctx.support)}`,
    actor: 'operator',
  });
  const unexpected = (): FailureCause => ({
    kind: 'stopped_unexpectedly',
    label: 'stopped unexpectedly',
    message: `These sessions stopped unexpectedly, without a reason the research service could name. Running them again usually works; if it keeps happening, ${operatorContact(ctx.support)}.`,
    actor: 'staff',
  });
  const onPlan = ctx.funding === 'plan';

  if (signals === null) {
    return {
      kind: 'interrupted',
      label: 'interrupted',
      message:
        'These sessions were stopped before they recorded anything: the research worker was interrupted (for example, restarted during the run), or the run stopped after another error. Running them again usually works.',
      actor: 'staff',
    };
  }

  if (signals.sessionError?.includes(ORG_KEY_REASON_MARK)) {
    return {
      kind: 'organization_key',
      label: "organization's own key",
      message: signals.sessionError.slice(0, 600),
      actor: 'organization_owner',
    };
  }

  const error = signals.apiError;
  if (error && (KEY_REFUSED_ERRORS.has(error) || (error === 'invalid_request' && KEY_REFUSED_TEXT.test(signals.apiErrorText ?? '')))) {
    if (onPlan) return notConfigured();
    return {
      kind: 'organization_key',
      label: "organization's own key",
      message:
        "Anthropic refused this organization's own API key, so these sessions stopped — the server's own key is never used in its place. An organization owner can enter a working key under Billing, then run them again.",
      actor: 'organization_owner',
    };
  }
  if (error === 'billing_error') {
    if (onPlan) {
      return {
        kind: 'service_billing',
        label: "research service's account",
        message: `The research service's Anthropic account reported a billing problem (usually no credit left), so these sessions stopped. ${operatorFix(ctx.support)}`,
        actor: 'operator',
      };
    }
    return {
      kind: 'organization_key',
      label: "organization's own key",
      message:
        "Anthropic reported a billing problem on the account behind this organization's own API key (usually no credit left). An organization owner can add credit in the Anthropic Console, or enter another key under Billing, then run these again.",
      actor: 'organization_owner',
    };
  }
  if (error === 'model_not_found') {
    return {
      kind: 'service_model',
      label: 'model setting',
      message: onPlan
        ? `Anthropic didn't find the model the research service asked for: a model setting on this server is wrong. ${operatorFix(ctx.support)}`
        : `Anthropic didn't find the model the research service asked for on this organization's own API key: the key may not be allowed to use it (an organization owner can check in the Anthropic Console), or a model setting on this server is wrong (${operatorContact(ctx.support)}).`,
      actor: onPlan ? 'operator' : 'organization_owner',
    };
  }
  if ((error && TRANSIENT_ERRORS.has(error)) || TRANSIENT_TEXT.test(signals.sessionError ?? '')) {
    return {
      kind: 'provider_unavailable',
      label: 'Anthropic busy or unreachable',
      message:
        'Anthropic was overloaded or could not be reached, and a second try failed the same way. Running these again later usually works.',
      actor: 'staff',
    };
  }
  if (signals.resultSubtype === 'error_max_turns') {
    return {
      kind: 'out_of_turns',
      label: 'ran out of turns',
      message:
        'These sessions used all of their turns before they finished researching. Running them again usually works; reviewer notes that narrow what to look for help.',
      actor: 'staff',
    };
  }
  if (error === 'max_output_tokens' || (signals.resultSubtype === 'success' && !signals.resultIsError && !error && !signals.sessionError)) {
    return {
      kind: 'unreadable_output',
      label: 'answer not readable',
      message:
        "These sessions finished, but their answers couldn't be read as findings, so nothing was recorded from them. Running them again usually works.",
      actor: 'staff',
    };
  }
  // Nothing in the transcript names a reason (the CLI exiting with an error
  // code is the usual case). With no research key on the server, a run on
  // the plan's allowance could not have run at all, so that is the reason.
  if (onPlan && !ctx.researchKeyConfigured) return notConfigured();
  return unexpected();
}

/**
 * Pure: the reason given for a failed run none of whose sessions explains
 * it — it stopped before any session started (the worker failed on its own:
 * a missing portrait, storage it could not open), so there is no transcript
 * to read.
 */
export function runStoppedCause(support: string | null): FailureCause {
  return {
    kind: 'stopped_unexpectedly',
    label: 'stopped before any session',
    message: `The run stopped before any session started: the research worker hit an error of its own. Running it again usually works; if it keeps happening, ${operatorContact(support)}.`,
    actor: 'staff',
  };
}

export interface CauseGroup {
  cause: FailureCause;
  /** The plan keys (dimension slug, or 'region_context') of the sessions it stopped. */
  keys: string[];
}

/**
 * Pure: one entry per distinct cause (by kind and message) in first-seen
 * order, with the sessions it stopped — the page says each reason once
 * instead of repeating it under every failed session.
 */
export function groupCauses(entries: readonly { key: string; cause: FailureCause }[]): CauseGroup[] {
  const groups = new Map<string, CauseGroup>();
  for (const { key, cause } of entries) {
    const id = `${cause.kind}\u0000${cause.message}`;
    const group = groups.get(id) ?? { cause, keys: [] };
    group.keys.push(key);
    groups.set(id, group);
  }
  return [...groups.values()];
}
