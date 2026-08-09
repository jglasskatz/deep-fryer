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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type {
  DimensionData,
  FindingPayload,
  FindingVerification,
  OutreachContactData,
  ResearchPlan,
  ReviewAnnotation,
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
export const reviewDispositionEnum = pgEnum('review_disposition', [
  'verified',
  'rejected',
  'needs_rework',
]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  region: text('region'),
  population: integer('population'),
  description: text('description'),
  branding: jsonb('branding').$type<TenantBranding>(),
  embedOrigins: text('embed_origins').array(),
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
    userId: uuid('user_id').notNull(),
    role: roleEnum('role').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
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
  completedAt: timestamp('completed_at', { withTimezone: true }),
  tokenUsage: jsonb('token_usage').$type<RunTokenUsage>(),
});

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

/**
 * Reviewer notes & dispositions (verification admin mode, SPEC.md §9).
 * Append-only like findings — re-dispositioning appends a new row and the
 * latest row per (run, finding) wins, so the full who-overrode-whom history
 * survives. A row without a disposition is pure commentary: a reviewer
 * jotting thoughts at run, dimension, or finding scope. Structured
 * machine-readable content rides in `annotation`; prose in `note`.
 * Substance CHECKs, the immutability trigger, and RLS live in migration
 * 0003_review_note_policies.
 */
export const reviewNotes = pgTable(
  'review_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => researchRuns.id, { onDelete: 'cascade' }),
    dimensionId: uuid('dimension_id').references(() => dimensions.id),
    findingId: uuid('finding_id').references(() => findings.id),
    disposition: reviewDispositionEnum('disposition'),
    annotation: jsonb('annotation').$type<ReviewAnnotation>(),
    note: text('note'),
    reviewerId: uuid('reviewer_id'),
    /** Email or name at disposition time — the identity survives member churn. */
    reviewerLabel: text('reviewer_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('review_notes_run_idx').on(t.runId),
    findingIdx: index('review_notes_finding_idx').on(t.runId, t.findingId, t.createdAt),
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
    authorId: uuid('author_id').notNull(),
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
    userId: uuid('user_id').notNull(),
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

// ---- Relations ----

export const tenantsRelations = relations(tenants, ({ many }) => ({
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

export const findingsRelations = relations(findings, ({ one, many }) => ({
  session: one(researchSessions, {
    fields: [findings.sessionId],
    references: [researchSessions.id],
  }),
  dimension: one(dimensions, {
    fields: [findings.dimensionId],
    references: [dimensions.id],
  }),
  reviewNotes: many(reviewNotes),
}));

export const reviewNotesRelations = relations(reviewNotes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [reviewNotes.tenantId],
    references: [tenants.id],
  }),
  run: one(researchRuns, {
    fields: [reviewNotes.runId],
    references: [researchRuns.id],
  }),
  dimension: one(dimensions, {
    fields: [reviewNotes.dimensionId],
    references: [dimensions.id],
  }),
  finding: one(findings, {
    fields: [reviewNotes.findingId],
    references: [findings.id],
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
export type ReviewNote = typeof reviewNotes.$inferSelect;
export type NewReviewNote = typeof reviewNotes.$inferInsert;
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
