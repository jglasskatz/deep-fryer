import type { RefusalFallbackEvent, RunTokenUsage, SessionTokenUsage } from '@deep-fryer/core';
// Type only: this module is also bundled into the review card, which runs in the browser.
import type { RunExecution } from '@deep-fryer/db';

/**
 * Which provider and model produced a run's research, in words, for the
 * people who check it: the review queue, the run page and the cost export.
 * Built from what the run recorded (its `execution`, written when it was
 * applied) and what each session's usage record says answered it (`model`,
 * and any `refusal_fallbacks`: a turn the configured model declined and
 * another model answered). Nothing here is shown on public pages, and
 * nothing is copied onto the published data.
 *
 * Plain module, no server or client marker: the review card, a server page
 * and a route handler all import it.
 */

/** What one session's usage record says about the model that answered it. */
export interface SessionModels {
  model?: string;
  refusal_fallbacks?: RefusalFallbackEvent[];
}

/** What a finding's row needs to say where it came from. */
export interface FindingProvenance {
  execution: RunExecution | null;
  /** The usage record of the session that produced the finding, or null when none was recorded. */
  session: SessionModels | null;
}

export const PROVIDER_NOT_RECORDED = 'provider not recorded';

const PROVIDER_NAMES: Record<RunExecution['provider'], string> = { anthropic: 'Anthropic' };
const EXECUTOR_NAMES: Record<RunExecution['executor'], string> = { shared_worker: 'shared server' };

/** "Anthropic", or "provider not recorded" for a run applied before this was kept. */
export function providerName(execution: RunExecution | null | undefined): string {
  return execution ? (PROVIDER_NAMES[execution.provider] ?? execution.provider) : PROVIDER_NOT_RECORDED;
}

/** "shared server", or null when the run did not record what ran it. */
export function executorName(execution: RunExecution | null | undefined): string | null {
  return execution ? (EXECUTOR_NAMES[execution.executor] ?? execution.executor) : null;
}

/** "on Anthropic, shared server", or "provider not recorded". */
export function whereItRan(execution: RunExecution | null | undefined): string {
  if (!execution) return PROVIDER_NOT_RECORDED;
  const executor = executorName(execution);
  return `on ${providerName(execution)}${executor ? `, ${executor}` : ''}`;
}

function namedModel(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * The fallbacks that name both models. The record is stored JSON, so a value
 * that is not a list, or an entry missing either name, is left out rather
 * than printed as a blank or "undefined".
 */
function namedFallbacks(value: unknown): RefusalFallbackEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is RefusalFallbackEvent =>
    typeof event === 'object' && event !== null
    && namedModel((event as RefusalFallbackEvent).original_model)
    && namedModel((event as RefusalFallbackEvent).fallback_model));
}

/** The session's recorded model, picked out of its usage record (nothing else from it travels further). */
export function sessionModels(usage: SessionTokenUsage | null | undefined): SessionModels | null {
  if (!usage) return null;
  const fallbacks = namedFallbacks(usage.refusal_fallbacks);
  return {
    ...(namedModel(usage.model) ? { model: usage.model } : {}),
    ...(fallbacks.length ? { refusal_fallbacks: fallbacks } : {}),
  };
}

/** A finding's provenance: its run's execution and its own session's models. */
export function findingProvenance(
  run: { execution: RunExecution | null; tokenUsage: RunTokenUsage | null },
  sessionId: string,
): FindingProvenance {
  return { execution: run.execution ?? null, session: sessionModels(run.tokenUsage?.[sessionId]) };
}

/** Each distinct model that answered after another declined, with the model it stood in for. */
export function fallbackPairs(session: SessionModels | null | undefined): { from: string; to: string }[] {
  const seen = new Set<string>();
  const pairs: { from: string; to: string }[] = [];
  for (const event of session?.refusal_fallbacks ?? []) {
    const key = `${event.original_model}\u0000${event.fallback_model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ from: event.original_model, to: event.fallback_model });
  }
  return pairs;
}

/** "When claude-sonnet-5 declined part of the work, claude-opus-5 answered", one sentence per fallback, or null. */
export function fallbackSentence(session: SessionModels | null | undefined): string | null {
  const pairs = fallbackPairs(session);
  if (pairs.length === 0) return null;
  return pairs.map(({ from, to }) => `When ${from} declined part of the work, ${to} answered`).join('. ');
}

/**
 * "Researched with claude-sonnet-5 on Anthropic, shared server", followed by
 * any model that answered a turn the first one declined. An older run reads
 * "…; provider not recorded", and a session with no usage record says its
 * model was not recorded rather than naming one.
 */
export function provenanceSentence(provenance: FindingProvenance | null | undefined): string {
  const model = provenance?.session?.model;
  return sentence(model ? [model] : [], provenance?.execution ?? null, provenance?.session ?? null);
}

/**
 * The same sentence for a whole run, over its research sessions' usage
 * records (verification and audit records are not research): every model
 * that answered one, and every fallback. Before any record is written — the
 * worker writes them when the run ends — it says only where the run goes.
 */
export function runProvenanceSentence(
  run: { execution: RunExecution | null; tokenUsage: RunTokenUsage | null },
  researchSessionIds: readonly string[],
): string {
  const records = researchSessionIds.flatMap((id) =>
    [id, `correction:${id}`, `escalation:${id}`].flatMap((key) => run.tokenUsage?.[key] ?? []),
  );
  if (records.length === 0) {
    return run.execution ? `Runs ${whereItRan(run.execution)}` : capitalizeFirst(PROVIDER_NOT_RECORDED);
  }
  const models = [...new Set(records.flatMap((record) => (namedModel(record.model) ? [record.model] : [])))];
  const fallbacks = records.flatMap((record) => namedFallbacks(record.refusal_fallbacks));
  return sentence(models, run.execution ?? null, { refusal_fallbacks: fallbacks });
}

function sentence(models: string[], execution: RunExecution | null, session: SessionModels | null): string {
  const where = execution ? ` ${whereItRan(execution)}` : `; ${PROVIDER_NOT_RECORDED}`;
  const main = models.length
    ? `Researched with ${joinWords(models)}${where}`
    : `Researched with a model that was not recorded${where}`;
  const fallback = fallbackSentence(session);
  return fallback ? `${main}. ${fallback}.` : main;
}

function joinWords(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Only for our own fixed wording: a model id is never re-cased. */
function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
