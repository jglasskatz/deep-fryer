import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  smallint,
  jsonb,
  timestamp,
  real,
  bigserial,
  primaryKey,
  unique,
  index,
  customType,
  boolean,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import type {
  DimensionData,
  DimensionProjection,
  HazardDimensionImpact,
  PolicyAnalysisOutput,
  SessionTokenUsage,
  FindingPayload,
  FindingVerification,
  OutreachContactData,
  ResearchPlan,
  RunTokenUsage,
  PortraitConfig,
  TenantBranding,
} from '@deep-fryer/core';

export const ringEnum = pgEnum('ring', ['social', 'ecological']);
export const roleEnum = pgEnum('role', ['owner', 'editor', 'viewer', 'moderator']);
export const versionStatusEnum = pgEnum('version_status', ['draft', 'published', 'archived']);
export const versionOriginEnum = pgEnum('version_origin', ['research', 'human', 'import']);
export const researchRunStatusEnum = pgEnum('research_run_status', [
  'planned',
  'running',
  'complete',
  'failed',
]);
export const researchSessionStatusEnum = pgEnum('research_session_status', [
  'queued',
  'running',
  'complete',
  'failed',
]);
export const researchSessionKindEnum = pgEnum('research_session_kind', [
  'region_context',
  'dimension',
]);
export const moderationActionEnum = pgEnum('moderation_action', ['remove', 'restore', 'lock']);
export const orgRoleEnum = pgEnum('org_role', ['owner', 'billing']);
// Mirrors Stripe's subscription statuses so webhook sync is a straight copy;
// manual contracts use the same vocabulary (SPEC-v4 §3).
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);
export const collectionMethodEnum = pgEnum('collection_method', ['card', 'invoice', 'contract']);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ---- Accounts (SPEC-v3 §2.1: Auth.js v5 on our own Postgres) ----
// Column names follow the Auth.js Drizzle adapter contract; display_name and
// is_staff are ours.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }),
  image: text('image'),
  /** Public handle on discussion boards (SPEC §14 B: a display name suffices). */
  displayName: text('display_name'),
  /** Internal deep-fryer staff: may set contract plans and quotas. */
  isStaff: boolean('is_staff').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
    userIdx: index('accounts_user_idx').on(t.userId),
  }),
);

/** Database sessions: revocable server-side (remove a member → access ends now). */
export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

// ---- Organizations (SPEC-v4 §2): the billing account and the portrait family ----
// One organization owns one or more tenants. NYC is one organization with six
// portraits (the city + five boroughs); a small town is one with one.

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  billingEmail: text('billing_email'),
  /**
   * What the organization's portraits are called in family views
   * ("borough" for NYC, "district", "ward"…); null reads as "portrait".
   */
  memberNoun: text('member_noun'),
  /**
   * Language access contact shown on every translated public page
   * ("For free help in your language, contact: …") — NYC: "311". Short and
   * language-neutral: a phone number, short code, email, or URL. Public.
   */
  languageHelp: text('language_help'),
  /** Government buyers are usually tax-exempt; mirrored to the Stripe customer. */
  taxExempt: boolean('tax_exempt').notNull().default(false),
  stripeCustomerId: text('stripe_customer_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.organizationId, t.userId] }),
    userIdx: index('organization_members_user_idx').on(t.userId),
  }),
);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  region: text('region'),
  population: integer('population'),
  description: text('description'),
  branding: jsonb('branding').$type<TenantBranding>(),
  embedOrigins: text('embed_origins').array(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  /** Position in the organization's family nav and compare views. */
  familyOrder: integer('family_order').notNull().default(0),
  /** Compact label for family matrices ("BX", "SI"). */
  shortName: text('short_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

// §6 portrait + behavior layers, one row per (tenant, key).
export const tenantConfig = pgTable(
  'tenant_config',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.key] }),
  }),
);

export const tenantMembers = pgTable(
  'tenant_members',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
    userIdx: index('tenant_members_user_idx').on(t.userId),
  }),
);

export const dimensions = pgTable(
  'dimensions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ring: ringEnum('ring').notNull(),
    slug: text('slug').notNull(),
    canonicalSlug: text('canonical_slug'),
    displayOrder: integer('display_order').notNull().default(0),
    publishedVersionId: uuid('published_version_id'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => ({
    uniqTenantRingSlug: unique('dimensions_tenant_ring_slug_uniq').on(t.tenantId, t.ring, t.slug),
  }),
);

export const dimensionVersions = pgTable(
  'dimension_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimensions.id, { onDelete: 'cascade' }),
    versionNum: integer('version_num').notNull(),
    status: versionStatusEnum('status').notNull(),
    data: jsonb('data').$type<DimensionData>().notNull(),
    vizLevel: real('viz_level'),
    origin: versionOriginEnum('origin').notNull().default('human'),
    researchRunId: uuid('research_run_id').references(() => researchRuns.id),
    changeNote: text('change_note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    uniqDimVersion: unique('dimension_versions_dim_version_uniq').on(t.dimensionId, t.versionNum),
  }),
);

// ---- Research plane (SPEC.md §7–8) ----

export const researchRuns = pgTable('research_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  status: researchRunStatusEnum('status').notNull().default('planned'),
  plan: jsonb('plan').$type<ResearchPlan>().notNull(),
  configSnapshot: jsonb('config_snapshot').$type<PortraitConfig>().notNull(),
  requestedBy: uuid('requested_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set when the run is handed to the worker: the moment it counts against the plan. */
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  tokenUsage: jsonb('token_usage').$type<RunTokenUsage>(),
}, (t) => ({
  tenantAppliedIdx: index('research_runs_tenant_applied_idx').on(t.tenantId, t.appliedAt),
}));

export const researchSessions = pgTable(
  'research_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    dimensionId: uuid('dimension_id').references(() => dimensions.id),
    kind: researchSessionKindEnum('kind').notNull(),
    status: researchSessionStatusEnum('status').notNull().default('queued'),
    reviewerNotes: text('reviewer_notes'),
    transcript: bytea('transcript'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    runIdx: index('research_sessions_run_idx').on(t.runId),
  }),
);

// Immutable: the audit spine. Never updated, never deleted.
export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => researchSessions.id),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    indicatorSlug: text('indicator_slug').notNull(),
    payload: jsonb('payload').$type<FindingPayload>().notNull(),
    verification: jsonb('verification').$type<FindingVerification>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dimensionIdx: index('findings_dimension_idx').on(t.dimensionId),
    sessionIdx: index('findings_session_idx').on(t.sessionId),
  }),
);

// ---- Discussion board (SPEC.md §7, §10) ----

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dimensionId: uuid('dimension_id')
      .notNull()
      .references(() => dimensions.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: uuid('removed_by'),
  },
  (t) => ({
    dimensionIdx: index('comments_dimension_idx').on(t.tenantId, t.dimensionId),
  }),
);

export const commentVotes = pgTable(
  'comment_votes',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vote: smallint('vote').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.commentId, t.userId] }),
  }),
);

export const moderationActions = pgTable('moderation_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id')
    .notNull()
    .references(() => comments.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull(),
  action: moderationActionEnum('action').notNull(),
  reason: text('reason'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Unchanged from v0 ----

export const outreachContacts = pgTable('outreach_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  publishedVersionId: uuid('published_version_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const outreachContactVersions = pgTable('outreach_contact_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => outreachContacts.id, { onDelete: 'cascade' }),
  versionNum: integer('version_num').notNull(),
  status: versionStatusEnum('status').notNull(),
  data: jsonb('data').$type<OutreachContactData>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const customPages = pgTable(
  'custom_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    publishedVersionId: uuid('published_version_id'),
  },
  (t) => ({
    uniqTenantSlug: unique('custom_pages_tenant_slug_uniq').on(t.tenantId, t.slug),
  }),
);

export const customPageVersions = pgTable('custom_page_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id')
    .notNull()
    .references(() => customPages.id, { onDelete: 'cascade' }),
  versionNum: integer('version_num').notNull(),
  status: versionStatusEnum('status').notNull(),
  title: text('title').notNull(),
  mdxBody: text('mdx_body').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  entity: text('entity').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Invitations (SPEC-v4 §2) ----
// Exactly one scope: a tenant role (owner/editor/viewer/moderator) or an
// organization role (owner/billing). Bound to the invited email — accepting
// requires a signed-in account with that verified address, so a forwarded
// link is useless. Only the token's sha256 is stored.

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    oneScope: check(
      'invitations_one_scope',
      sql`(${t.tenantId} IS NOT NULL AND ${t.organizationId} IS NULL AND ${t.role} IN ('owner','editor','viewer','moderator'))
        OR (${t.organizationId} IS NOT NULL AND ${t.tenantId} IS NULL AND ${t.role} IN ('owner','billing'))`,
    ),
    emailIdx: index('invitations_email_idx').on(t.email),
  }),
);

// ---- Billing (SPEC-v4 §3) ----
// One subscription per organization. Our row is the entitlement source of
// truth: Stripe webhooks sync card/invoice subscriptions into it, and manual
// government contracts (collection 'contract') live here with no Stripe ids.

export const subscriptions = pgTable('subscriptions', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull(),
  status: subscriptionStatusEnum('status').notNull(),
  collection: collectionMethodEnum('collection').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripePriceId: text('stripe_price_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  poNumber: text('po_number'),
  /** Contract terms set by staff; null means the plan's catalog limit. */
  researchSessionsOverride: integer('research_sessions_override'),
  portraitsOverride: integer('portraits_override'),
  seatsOverride: integer('seats_override'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Processed Stripe webhook events: the idempotency ledger (event id is the key). */
export const billingEvents = pgTable('billing_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'set null',
  }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb('payload').notNull(),
});

// ---- Relations ----

// ---- Policy analysis (SPEC-v5 §2) ----------------------------------------------

export const policyAnalysisStatusEnum = pgEnum('policy_analysis_status', [
  'queued',
  'running',
  'complete',
  'failed',
]);

/**
 * A policy brief and its AI-drafted projected impacts — staff plane only.
 * Counts as one research session against the organization's plan while
 * queued, running, or complete (failed analyses are not billed).
 */
export const policyAnalyses = pgTable(
  'policy_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    brief: text('brief').notNull(),
    sourceUrl: text('source_url'),
    status: policyAnalysisStatusEnum('status').notNull().default('queued'),
    /** Schema-validated model output (core policyAnalysisOutputSchema). */
    result: jsonb('result').$type<PolicyAnalysisOutput>(),
    /** Per-dimension projections re-scored with the published thresholds. */
    projections: jsonb('projections').$type<DimensionProjection[]>(),
    /**
     * What the worker changed to fit the model's answer to the output
     * contract before validating it (a non-https source dropped, an impact
     * on an unknown dimension set aside, an over-long summary shortened),
     * one plain sentence each, shown to staff with the result. Null or empty
     * when the answer fit as given. (Migration 0009.)
     */
    adjustments: jsonb('adjustments').$type<string[]>(),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    tokenUsage: jsonb('token_usage').$type<SessionTokenUsage>(),
    /** Gzipped session transcript; not readable by the app role (migration 0008). */
    transcript: bytea('transcript'),
  },
  (t) => ({
    tenantCreatedIdx: index('policy_analyses_tenant_created_idx').on(t.tenantId, t.createdAt),
    briefLength: check('policy_analyses_brief_length', sql`char_length(${t.brief}) BETWEEN 1 AND 60000`),
  }),
);

// ---- Emergency view (SPEC-v5 §3) --------------------------------------------------

export const hazardKindEnum = pgEnum('hazard_kind', [
  'coastal_storm',
  'flooding',
  'extreme_heat',
  'winter_weather',
  'high_winds',
  'air_quality',
  'drought',
  'wildfire',
  'earthquake',
  'infectious_disease',
  'infrastructure_failure',
  'other',
]);

export const resourceKindEnum = pgEnum('emergency_resource_kind', [
  'cooling_center',
  'shelter',
  'hotline',
  'mutual_aid',
  'food',
  'medical',
  'other',
]);

/** A threat to the jurisdiction, rated by staff; public once published. */
export const hazards = pgTable(
  'hazards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: hazardKindEnum('kind').notNull(),
    description: text('description').notNull().default(''),
    likelihood: smallint('likelihood').notNull(),
    severity: smallint('severity').notNull(),
    /** Doughnut dimensions this hazard threatens, with impact level. */
    dimensions: jsonb('dimensions').$type<HazardDimensionImpact[]>().notNull().default([]),
    /** NWS event names that mean this hazard is happening now ("Heat Advisory"). */
    nwsEvents: text('nws_events').array().notNull().default(sql`'{}'::text[]`),
    displayOrder: integer('display_order').notNull().default(0),
    published: boolean('published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSlug: unique('hazards_tenant_slug').on(t.tenantId, t.slug),
    likelihoodRange: check('hazards_likelihood_range', sql`${t.likelihood} BETWEEN 1 AND 5`),
    severityRange: check('hazards_severity_range', sql`${t.severity} BETWEEN 1 AND 5`),
  }),
);

/** An adopted plan residents should know about (hazard mitigation, heat, coastal storm…). */
export const emergencyPlans = pgTable(
  'emergency_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    agency: text('agency').notNull(),
    url: text('url').notNull(),
    adoptedYear: integer('adopted_year'),
    summary: text('summary').notNull().default(''),
    /** BCP 47 codes of the languages the plan itself is published in. */
    languages: text('languages').array().notNull().default(sql`'{}'::text[]`),
    hazardSlugs: text('hazard_slugs').array().notNull().default(sql`'{}'::text[]`),
    displayOrder: integer('display_order').notNull().default(0),
    published: boolean('published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    httpsUrl: check('emergency_plans_https_url', sql`${t.url} LIKE 'https://%'`),
  }),
);

/** Help during an emergency: cooling centers, shelters, hotlines, mutual aid. */
export const emergencyResources = pgTable(
  'emergency_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: resourceKindEnum('kind').notNull(),
    description: text('description').notNull().default(''),
    phone: text('phone'),
    url: text('url'),
    hazardSlugs: text('hazard_slugs').array().notNull().default(sql`'{}'::text[]`),
    displayOrder: integer('display_order').notNull().default(0),
    published: boolean('published').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    httpsUrl: check('emergency_resources_https_url', sql`${t.url} IS NULL OR ${t.url} LIKE 'https://%'`),
  }),
);

/** Official alerts as issued (NWS CAP), refreshed by the worker's alerts_sync cron. */
export const emergencyAlerts = pgTable(
  'emergency_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    event: text('event').notNull(),
    severity: text('severity').notNull(),
    urgency: text('urgency').notNull(),
    certainty: text('certainty').notNull(),
    headline: text('headline'),
    description: text('description').notNull(),
    instruction: text('instruction'),
    areaDesc: text('area_desc').notNull(),
    senderName: text('sender_name').notNull(),
    url: text('url').notNull(),
    effective: timestamp('effective', { withTimezone: true }).notNull(),
    expires: timestamp('expires', { withTimezone: true }),
    ends: timestamp('ends', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceUnique: unique('emergency_alerts_source_unique').on(t.tenantId, t.source, t.sourceId),
  }),
);

/** Per-portrait sync health, so the page can say when it last checked. */
export const emergencyAlertSyncs = pgTable('emergency_alert_syncs', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
});

export type PolicyAnalysis = typeof policyAnalyses.$inferSelect;
export type Hazard = typeof hazards.$inferSelect;
export type EmergencyPlan = typeof emergencyPlans.$inferSelect;
export type EmergencyResource = typeof emergencyResources.$inferSelect;
export type EmergencyAlert = typeof emergencyAlerts.$inferSelect;

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  tenants: many(tenants),
  members: many(organizationMembers),
  subscription: one(subscriptions, {
    fields: [organizations.id],
    references: [subscriptions.organizationId],
  }),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [organizationMembers.userId], references: [users.id] }),
}));

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tenants.organizationId],
    references: [organizations.id],
  }),
  members: many(tenantMembers),
  config: many(tenantConfig),
  dimensions: many(dimensions),
  researchRuns: many(researchRuns),
  comments: many(comments),
  outreachContacts: many(outreachContacts),
  customPages: many(customPages),
  auditEntries: many(auditLog),
}));

export const tenantConfigRelations = relations(tenantConfig, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantConfig.tenantId],
    references: [tenants.id],
  }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
}));

export const dimensionsRelations = relations(dimensions, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [dimensions.tenantId],
    references: [tenants.id],
  }),
  versions: many(dimensionVersions),
  findings: many(findings),
  comments: many(comments),
  publishedVersion: one(dimensionVersions, {
    fields: [dimensions.publishedVersionId],
    references: [dimensionVersions.id],
    relationName: 'dimension_published_version',
  }),
}));

export const dimensionVersionsRelations = relations(dimensionVersions, ({ one }) => ({
  dimension: one(dimensions, {
    fields: [dimensionVersions.dimensionId],
    references: [dimensions.id],
  }),
  researchRun: one(researchRuns, {
    fields: [dimensionVersions.researchRunId],
    references: [researchRuns.id],
  }),
}));

export const researchRunsRelations = relations(researchRuns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [researchRuns.tenantId],
    references: [tenants.id],
  }),
  sessions: many(researchSessions),
}));

export const researchSessionsRelations = relations(researchSessions, ({ one, many }) => ({
  run: one(researchRuns, {
    fields: [researchSessions.runId],
    references: [researchRuns.id],
  }),
  dimension: one(dimensions, {
    fields: [researchSessions.dimensionId],
    references: [dimensions.id],
  }),
  findings: many(findings),
}));

export const findingsRelations = relations(findings, ({ one }) => ({
  session: one(researchSessions, {
    fields: [findings.sessionId],
    references: [researchSessions.id],
  }),
  dimension: one(dimensions, {
    fields: [findings.dimensionId],
    references: [dimensions.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [comments.tenantId],
    references: [tenants.id],
  }),
  dimension: one(dimensions, {
    fields: [comments.dimensionId],
    references: [dimensions.id],
  }),
  parent: one(comments, {
    fields: [comments.parentId],
    references: [comments.id],
    relationName: 'comment_parent',
  }),
  replies: many(comments, { relationName: 'comment_parent' }),
  votes: many(commentVotes),
  moderationActions: many(moderationActions),
}));

export const commentVotesRelations = relations(commentVotes, ({ one }) => ({
  comment: one(comments, {
    fields: [commentVotes.commentId],
    references: [comments.id],
  }),
}));

export const moderationActionsRelations = relations(moderationActions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [moderationActions.tenantId],
    references: [tenants.id],
  }),
  comment: one(comments, {
    fields: [moderationActions.commentId],
    references: [comments.id],
  }),
}));

export const outreachContactsRelations = relations(outreachContacts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [outreachContacts.tenantId],
    references: [tenants.id],
  }),
  versions: many(outreachContactVersions),
  publishedVersion: one(outreachContactVersions, {
    fields: [outreachContacts.publishedVersionId],
    references: [outreachContactVersions.id],
    relationName: 'outreach_contact_published_version',
  }),
}));

export const outreachContactVersionsRelations = relations(outreachContactVersions, ({ one }) => ({
  contact: one(outreachContacts, {
    fields: [outreachContactVersions.contactId],
    references: [outreachContacts.id],
  }),
}));

export const customPagesRelations = relations(customPages, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [customPages.tenantId],
    references: [tenants.id],
  }),
  versions: many(customPageVersions),
  publishedVersion: one(customPageVersions, {
    fields: [customPages.publishedVersionId],
    references: [customPageVersions.id],
    relationName: 'custom_page_published_version',
  }),
}));

export const customPageVersionsRelations = relations(customPageVersions, ({ one }) => ({
  page: one(customPages, {
    fields: [customPageVersions.pageId],
    references: [customPages.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  tenant: one(tenants, {
    fields: [auditLog.tenantId],
    references: [tenants.id],
  }),
}));

// ---- Row types ----

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantConfigRow = typeof tenantConfig.$inferSelect;
export type NewTenantConfigRow = typeof tenantConfig.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
export type Dimension = typeof dimensions.$inferSelect;
export type NewDimension = typeof dimensions.$inferInsert;
export type DimensionVersion = typeof dimensionVersions.$inferSelect;
export type NewDimensionVersion = typeof dimensionVersions.$inferInsert;
export type ResearchRun = typeof researchRuns.$inferSelect;
export type NewResearchRun = typeof researchRuns.$inferInsert;
export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;
export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type CommentVote = typeof commentVotes.$inferSelect;
export type NewCommentVote = typeof commentVotes.$inferInsert;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type NewModerationActionRow = typeof moderationActions.$inferInsert;
export type OutreachContact = typeof outreachContacts.$inferSelect;
export type NewOutreachContact = typeof outreachContacts.$inferInsert;
export type OutreachContactVersion = typeof outreachContactVersions.$inferSelect;
export type NewOutreachContactVersion = typeof outreachContactVersions.$inferInsert;
export type CustomPage = typeof customPages.$inferSelect;
export type NewCustomPage = typeof customPages.$inferInsert;
export type CustomPageVersion = typeof customPageVersions.$inferSelect;
export type NewCustomPageVersion = typeof customPageVersions.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
