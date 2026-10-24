'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { OutreachContactData } from '@deep-fryer/core';
import { outreachContacts, outreachContactVersions, tenantConfig } from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { userDb } from './db';

const text = z.string().trim().max(1200).optional();
const contactData = z.object({ org: z.string().trim().min(1).max(200), person: text, phone: z.string().max(100).optional(),
  email: z.union([z.string().email(), z.literal('')]).optional(), website: z.union([z.string().url().regex(/^https:\/\//i), z.literal('')]).optional(),
  address: text, tags: z.array(z.string().trim().min(1).max(100)).max(30), data_needs: z.array(z.string().trim().min(1).max(400)).max(30), why: text, draft_message: z.string().max(6000).optional() });
function refresh(slug: string) { revalidatePath(`/${slug}/outreach`); revalidatePath(`/${slug}/admin/outreach`); }

export const saveOutreachContact = action(async (input: { tenantSlug: string; contactId?: string; data: OutreachContactData }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const parsed = z.object({ contactId: z.string().uuid().optional(), data: contactData }).parse(input);
  const auth = await getAuth();
  const saved = await userDb(async db => {
    let contact;
    if (parsed.contactId) [contact] = await db.select().from(outreachContacts).where(and(eq(outreachContacts.id, parsed.contactId), eq(outreachContacts.tenantId, tenant.id))).for('update');
    else [contact] = await db.insert(outreachContacts).values({ tenantId: tenant.id }).returning();
    if (!contact) throw new UserError('Unknown contact.');
    const [last] = await db.select({ versionNum: outreachContactVersions.versionNum }).from(outreachContactVersions).where(eq(outreachContactVersions.contactId, contact.id)).orderBy(desc(outreachContactVersions.versionNum)).limit(1);
    const [version] = await db.insert(outreachContactVersions).values({ contactId: contact.id, versionNum: (last?.versionNum ?? 0) + 1, status: 'draft', data: parsed.data, createdBy: auth.userId }).returning();
    if (!version) throw new Error('contact version insert failed');
    await audit(tenant.id, 'outreach_contact', contact.id, 'save_draft', null, { version_id: version.id, version_num: version.versionNum }, db);
    return { contactId: contact.id, versionId: version.id };
  });
  refresh(tenant.slug);
  return saved;
});

export const publishOutreachContact = action(async (input: { tenantSlug: string; contactId: string; versionId: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const ids = z.object({ contactId: z.string().uuid(), versionId: z.string().uuid() }).parse(input);
  const auth = await getAuth();
  await userDb(async db => {
    const [contact] = await db.select().from(outreachContacts).where(and(eq(outreachContacts.id, ids.contactId), eq(outreachContacts.tenantId, tenant.id))).for('update');
    if (!contact) throw new UserError('Unknown contact.');
    if (contact.archivedAt) throw new UserError('Restore this contact before publishing it.');
    const [version] = await db.select().from(outreachContactVersions).where(and(eq(outreachContactVersions.id, ids.versionId), eq(outreachContactVersions.contactId, contact.id)));
    if (!version) throw new UserError('That version does not belong to this contact.');
    const [review] = await db.select({ value: tenantConfig.value }).from(tenantConfig).where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'review_policy')));
    if (!version.publishedAt && (review?.value as { dual_review_on_edits?: unknown } | undefined)?.dual_review_on_edits === true && (!auth.userId || !version.createdBy || auth.userId === version.createdBy)) throw new UserError('Dual review is enabled. Another signed-in editor must publish this version.');
    await db.update(outreachContactVersions).set({ status: 'published', publishedAt: version.publishedAt ?? new Date() }).where(eq(outreachContactVersions.id, version.id));
    await db.update(outreachContacts).set({ publishedVersionId: version.id }).where(eq(outreachContacts.id, contact.id));
    if (contact.publishedVersionId && contact.publishedVersionId !== version.id) await db.update(outreachContactVersions).set({ status: 'archived' }).where(eq(outreachContactVersions.id, contact.publishedVersionId));
    await audit(tenant.id, 'outreach_contact', contact.id, 'publish', { published_version_id: contact.publishedVersionId }, { published_version_id: version.id }, db);
  });
  refresh(tenant.slug);
});

export const setOutreachArchived = action(async (input: { tenantSlug: string; contactId: string; archived: boolean }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const parsed = z.object({ contactId: z.string().uuid(), archived: z.boolean() }).parse(input);
  await userDb(async db => {
    const [contact] = await db.select().from(outreachContacts).where(and(eq(outreachContacts.id, parsed.contactId), eq(outreachContacts.tenantId, tenant.id))).for('update');
    if (!contact) throw new UserError('Unknown contact.');
    await db.update(outreachContacts).set({ archivedAt: parsed.archived ? new Date() : null }).where(eq(outreachContacts.id, contact.id));
    await audit(tenant.id, 'outreach_contact', contact.id, parsed.archived ? 'archive' : 'restore', { archived_at: contact.archivedAt }, { archived: parsed.archived }, db);
  });
  refresh(tenant.slug);
});
