import type { NotificationConfig, RetentionConfig, ReviewPolicyConfig } from './types.js';

/** Behavior-layer defaults (SPEC.md §6): everything human-gated, 7-year transcripts. */
export const defaultReviewPolicy: ReviewPolicyConfig = {
  require_approval: 'all',
  dual_review_on_edits: false,
  first_post_requires_approval: false,
};

export const defaultRetention: RetentionConfig = {
  transcript_days: 365 * 7,
};

export const defaultNotifications: NotificationConfig = {
  email_on_run_complete: true,
  email_on_flagged_finding: true,
};
