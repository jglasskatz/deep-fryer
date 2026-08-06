import { defaultPortraitConfig } from '@deep-fryer/contract';
import type {
  FeaturesConfig,
  NotificationConfig,
  RetentionConfig,
  ReviewPolicyConfig,
  TenantConfigMap,
} from './types.js';

/** Behavior-layer defaults (SPEC.md §6): everything human-gated, 7-year transcripts. */
export const defaultReviewPolicy: ReviewPolicyConfig = {
  require_approval: 'all',
  dual_review_on_edits: false,
  first_post_requires_approval: false,
};

export const defaultRetention: RetentionConfig = {
  transcript_days: 365 * 7,
};

export const defaultFeatures: FeaturesConfig = {
  request_research: false,
};

export const defaultNotifications: NotificationConfig = {
  email_on_run_complete: true,
  email_on_flagged_finding: true,
};

/**
 * The complete §6 config a new tenant starts with — the single source of the
 * key list. Provisioning inserts exactly these entries; settings UI falls
 * back to these values for unset keys.
 */
export function defaultTenantConfig(regionName: string, regionDefinition: string): TenantConfigMap {
  const portrait = defaultPortraitConfig(regionName, regionDefinition);
  return {
    region: portrait.region,
    source_priority: portrait.source_priority,
    recency: portrait.recency,
    scale_policy: portrait.scale_policy,
    threshold_overrides: {},
    review_policy: defaultReviewPolicy,
    retention: defaultRetention,
    notifications: defaultNotifications,
    features: defaultFeatures,
  };
}
