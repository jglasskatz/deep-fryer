import { POLICY_BRIEF_MAX_CHARS } from '@deep-fryer/core';

/**
 * Input limits for a policy analysis (SPEC-v5 §2), shared by the server
 * action that enforces them (lib/policy-actions.ts) and the form that shows
 * them as you type (components/policy/NewPolicyForm.tsx), so the live
 * character count and the server's refusal can never disagree. A plain
 * module: 'use server' files may export only actions, and lib/policy.ts is
 * server-only.
 */
export const POLICY_LIMITS = {
  titleMin: 3,
  titleMax: 200,
  briefMin: 50,
  /** The brief column's CHECK (migration 0008) holds the same ceiling. */
  briefMax: POLICY_BRIEF_MAX_CHARS,
  sourceUrlMax: 2000,
} as const;

/**
 * Length as the server measures it: trimmed, in UTF-16 code units (JS
 * string length). That is never fewer than the code points the database's
 * char_length() counts, so passing here always passes the CHECK.
 */
export function briefLength(brief: string): number {
  return brief.trim().length;
}
