import { describe, expect, it } from 'vitest';
import {
  failureCause,
  groupCauses,
  runStoppedCause,
  transcriptSignals,
  type FailureContext,
} from './run-failure';

const onPlan: FailureContext = { funding: 'plan', researchKeyConfigured: true, support: null };
const onOrgKey: FailureContext = { funding: 'organization_key', researchKeyConfigured: true, support: null };

/** A session stream as the worker stores it (apps/worker session.ts): one SDK message per line. */
const jsonl = (...frames: unknown[]) => frames.map((f) => JSON.stringify(f)).join('\n');
const init = { type: 'system', subtype: 'init', session_id: 's' };
const errorFrame = (error: string, text: string, parent: string | null = null) => ({
  type: 'assistant',
  message: { model: '<synthetic>', content: [{ type: 'text', text }] },
  parent_tool_use_id: parent,
  error,
});
const result = (subtype: string, isError = false) => ({ type: 'result', subtype, is_error: isError, result: 'x' });

// The worker's own reason for a run on the organization's key (apps/worker org-key.ts ORG_KEY_REMOVED).
const ORG_KEY_REMOVED =
  "This was started on this organization's own Anthropic API key, which was removed before it ran, so nothing ran — the deployment's own key is never used in its place. An organization owner can add the key again under Billing, then start this again; started again without a key, it uses the plan's research sessions.";

describe('transcriptSignals', () => {
  it('reads the session_error line, the main loop’s API error and the result — and ignores a scout’s error', () => {
    expect(transcriptSignals(null)).toBeNull();
    expect(transcriptSignals(jsonl({ type: 'session_error', message: 'Claude Code process exited with code 1' }))).toEqual({
      sessionError: 'Claude Code process exited with code 1',
    });
    const s = transcriptSignals(
      jsonl(init, errorFrame('rate_limit', 'scout limited', 'toolu_1'), errorFrame('billing_error', 'Credit balance is too low'), result('success', true)),
    )!;
    expect(s).toEqual({ apiError: 'billing_error', apiErrorText: 'Credit balance is too low', resultSubtype: 'success', resultIsError: true });
    expect(transcriptSignals(jsonl(init, errorFrame('overloaded', 'busy', 'toolu_2'), result('success')))).toEqual({
      resultSubtype: 'success',
      resultIsError: false,
    });
  });

  it('reads the API error a thrown session’s line carries, when the worker records it', () => {
    const s = transcriptSignals(
      jsonl({ type: 'session_error', message: 'Claude Code process exited with code 1', api_error: 'billing_error', api_error_text: 'Credit balance is too low' }),
    );
    expect(s).toEqual({ sessionError: 'Claude Code process exited with code 1', apiError: 'billing_error', apiErrorText: 'Credit balance is too low' });
    expect(failureCause(s, onPlan).kind).toBe('service_billing');
  });

  it('skips lines that are not JSON instead of failing', () => {
    expect(transcriptSignals('{"type":"result", truncated\n{"type":"session_error","message":"m"}')).toEqual({ sessionError: 'm' });
  });
});

describe('failureCause', () => {
  it('passes the worker’s own organization-key reason through as written, for an organization owner', () => {
    const c = failureCause({ sessionError: ORG_KEY_REMOVED }, onOrgKey);
    expect(c).toMatchObject({ kind: 'organization_key', actor: 'organization_owner', message: ORG_KEY_REMOVED });
  });

  it('calls a refused or missing server key "not configured", for whoever runs the server', () => {
    const refused = failureCause(transcriptSignals(jsonl(init, errorFrame('authentication_failed', 'Invalid API key · Please run /login'), result('success', true))), onPlan);
    expect(refused.kind).toBe('service_not_configured');
    expect(refused.message).toMatch(/^The research service isn't configured on this server/);
    expect(refused.message).toMatch(/for the people who run this server to fix, not you; let them know/);
    expect(refused.actor).toBe('operator');
    // A deployment with a support address names it.
    expect(failureCause({ apiError: 'authentication_failed' }, { ...onPlan, support: 'help@example.gov' }).message).toMatch(/to fix, not you: contact help@example.gov\.$/);
    // The two refusals the CLI reports as a plain invalid_request, told apart by their text.
    expect(failureCause({ apiError: 'invalid_request', apiErrorText: 'Your ANTHROPIC_API_KEY belongs to a disabled organization' }, onPlan).kind).toBe('service_not_configured');
    expect(failureCause({ apiError: 'invalid_request', apiErrorText: 'messages: text content blocks must be non-empty' }, onPlan).kind).toBe('stopped_unexpectedly');
  });

  it('explains a session that only says the CLI exited by the server having no research key, when that is so', () => {
    const exited = { sessionError: 'Claude Code process exited with code 1' };
    expect(failureCause(exited, { ...onPlan, researchKeyConfigured: false }).kind).toBe('service_not_configured');
    expect(failureCause(exited, onPlan).kind).toBe('stopped_unexpectedly');
    // The organization's key is not the server's: no research key on the server explains nothing there.
    expect(failureCause(exited, { ...onOrgKey, researchKeyConfigured: false }).kind).toBe('stopped_unexpectedly');
  });

  it('sends billing and model problems to whoever’s key it was', () => {
    expect(failureCause({ apiError: 'billing_error' }, onPlan)).toMatchObject({ kind: 'service_billing', actor: 'operator' });
    expect(failureCause({ apiError: 'billing_error' }, onOrgKey)).toMatchObject({ kind: 'organization_key', actor: 'organization_owner' });
    expect(failureCause({ apiError: 'model_not_found' }, onPlan)).toMatchObject({ kind: 'service_model', actor: 'operator' });
    expect(failureCause({ apiError: 'model_not_found' }, onOrgKey).message).toMatch(/organization owner can check/);
  });

  it('tells transient, turn-limit, unreadable and interrupted sessions apart, each worth running again', () => {
    expect(failureCause({ apiError: 'overloaded' }, onPlan).kind).toBe('provider_unavailable');
    expect(failureCause({ sessionError: 'API Error: 529 Overloaded' }, onPlan).kind).toBe('provider_unavailable');
    expect(failureCause({ sessionError: 'Connection closed mid-response' }, onPlan).kind).toBe('provider_unavailable');
    expect(failureCause({ resultSubtype: 'error_max_turns', resultIsError: true }, onPlan).kind).toBe('out_of_turns');
    expect(failureCause({ resultSubtype: 'success', resultIsError: false }, onPlan).kind).toBe('unreadable_output');
    expect(failureCause({ apiError: 'max_output_tokens' }, onPlan).kind).toBe('unreadable_output');
    expect(failureCause(null, onPlan)).toMatchObject({ kind: 'interrupted', actor: 'staff' });
    expect(failureCause({}, onPlan).kind).toBe('stopped_unexpectedly');
  });
});

describe('groupCauses', () => {
  it('says each distinct reason once, with the sessions it stopped', () => {
    const a = failureCause({ apiError: 'overloaded' }, onPlan);
    const b = failureCause(null, onPlan);
    const groups = groupCauses([
      { key: 'housing', cause: a },
      { key: 'water', cause: b },
      { key: 'energy', cause: a },
    ]);
    expect(groups.map((g) => [g.cause.kind, g.keys])).toEqual([
      ['provider_unavailable', ['housing', 'energy']],
      ['interrupted', ['water']],
    ]);
  });

  it('has a reason for a run that stopped before any session', () => {
    expect(runStoppedCause('help@example.gov').message).toMatch(/before any session started.*contact help@example.gov/);
  });
});
