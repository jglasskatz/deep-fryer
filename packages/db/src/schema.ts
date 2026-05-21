import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  real,
  bigserial,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type {
  DimensionData,
  OutreachContactData,
  TenantBranding,
} from '@deep-fryer/core';

export const ringEnum = pgEnum('ring', ['social', 'ecological']);
export const roleEnum = pgEnum('role', ['owner', 'editor', 'viewer']);
export const versionStatusEnum = pgEnum('version_status', ['draft', 'published', 'archived']);

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
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => ({
    uniqDimVersion: unique('dimension_versions_dim_version_uniq').on(t.dimensionId, t.versionNum),
  }),
);

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

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
  dimensions: many(dimensions),
  outreachContacts: many(outreachContacts),
  customPages: many(customPages),
  auditEntries: many(auditLog),
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

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
export type Dimension = typeof dimensions.$inferSelect;
export type NewDimension = typeof dimensions.$inferInsert;
export type DimensionVersion = typeof dimensionVersions.$inferSelect;
export type NewDimensionVersion = typeof dimensionVersions.$inferInsert;
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
