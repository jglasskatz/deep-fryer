'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  emergencyConfigSchema,
  emergencyPlanInputSchema,
  emergencyResourceInputSchema,
  hazardInputSchema,
  type EmergencyPlanInput,
  type EmergencyPlanInputDraft,
  type EmergencyResourceInput,
  type EmergencyResourceInputDraft,
  type HazardInput,
  type HazardInputDraft,
} from '@deep-fryer/core';
import {
  emergencyPlans,
  emergencyResources,
  hazards,
  tenantConfig,
  type DbExecutor,
  type Tenant,
} from '@deep-fryer/db';
import { action, UserError } from './action-result';
import { audit } from './audit';
import { getAuth, requireTenantRole } from './auth';
import { userDb } from './db';

/**
 * Staff curation of the emergency view (SPEC-v5 §3).
 *
 * - Hazards, plans, and help resources: editors. Writes run through userDb,
 *   so the database's editor-write policies (migration 0008) enforce the
 *   same rule the app checks first.
 * - The emergency config (NWS zones, sign-up link, phone numbers, time
 *   zone): owners, like every other tenant_config key — the table's write
 *   policy is owner-only, and these values decide which official alerts a
 *   whole city is shown.
 *
 * Inputs are validated by the shared core schemas (the NYC setup script
 * uses the same ones), every change is audited in the same transaction, and
 * both the public page and the admin page are revalidated.
 *
 * Visibility has one writer per record: a record may be published when it
 * is created, and afterwards only setEmergencyPublished changes it. The
 * update actions ignore `published`, so an edit form opened before someone
 * pressed Publish or Unpublish cannot silently undo that decision.
 */

const idSchema = z.string().uuid('unknown record');

// Edits never carry visibility (see above); zod drops the key if sent.
const hazardUpdateSchema = hazardInputSchema.omit({ published: true });
const planUpdateSchema = emergencyPlanInputSchema.omit({ published: true });
const resourceUpdateSchema = emergencyResourceInputSchema.omit({ published: true });

function revalidate(tenant: Tenant) {
  revalidatePath(`/${tenant.slug}/emergency`);
  revalidatePath(`/${tenant.slug}/admin/emergency`);
}

/** Postgres unique_violation, e.g. a second hazard with the same slug racing the pre-check. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Plans and resources may only point at hazards that exist on this portrait (published or not). */
async function assertHazardSlugs(db: DbExecutor, tenantId: string, slugs: string[]) {
  if (slugs.length === 0) return;
  const found = await db
    .select({ slug: hazards.slug })
    .from(hazards)
    .where(and(eq(hazards.tenantId, tenantId), inArray(hazards.slug, slugs)));
  const known = new Set(found.map((h) => h.slug));
  const missing = slugs.filter((s) => !known.has(s));
  if (missing.length) throw new UserError(`Unknown hazard: ${missing.join(', ')}.`);
}

/** Keep plan and resource links pointing at a hazard across a rename (or drop them on delete). */
async function rewriteHazardLinks(db: DbExecutor, tenantId: string, from: string, to: string | null) {
  for (const table of [emergencyPlans, emergencyResources]) {
    await db
      .update(table)
      .set({
        hazardSlugs:
          to === null
            ? sql`array_remove(${table.hazardSlugs}, ${from})`
            : sql`array_replace(${table.hazardSlugs}, ${from}, ${to})`,
        updatedAt: new Date(),
      })
      .where(and(eq(table.tenantId, tenantId), sql`${from} = ANY(${table.hazardSlugs})`));
  }
}

// ---- Config (owners) ----------------------------------------------------------------

export const saveEmergencyConfig = action(async (input: { tenantSlug: string; config: unknown }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const value = emergencyConfigSchema.parse(input.config);
  await userDb(async (db) => {
    const [existing] = await db
      .select({ value: tenantConfig.value })
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, 'emergency')));
    const auth = await getAuth();
    await db
      .insert(tenantConfig)
      .values({ tenantId: tenant.id, key: 'emergency', value, updatedBy: auth.userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [tenantConfig.tenantId, tenantConfig.key],
        set: { value, updatedBy: auth.userId, updatedAt: new Date() },
      });
    await audit(tenant.id, 'tenant_config', tenant.id, 'config:emergency', existing?.value ?? null, value, db);
  });
  revalidate(tenant);
  return value;
});

// ---- Hazards (editors) ---------------------------------------------------------------

function hazardValues(data: Omit<HazardInput, 'published'>) {
  return {
    slug: data.slug,
    name: data.name,
    kind: data.kind,
    description: data.description,
    likelihood: data.likelihood,
    severity: data.severity,
    dimensions: data.dimensions,
    nwsEvents: data.nws_events,
    displayOrder: data.display_order,
  };
}

const duplicateSlug = (slug: string) => new UserError(`A hazard with the slug "${slug}" already exists on this portrait.`);

export const createHazard = action(async (input: { tenantSlug: string; hazard: HazardInputDraft }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const data = hazardInputSchema.parse(input.hazard);
  const id = await userDb(async (db) => {
    const [clash] = await db
      .select({ id: hazards.id })
      .from(hazards)
      .where(and(eq(hazards.tenantId, tenant.id), eq(hazards.slug, data.slug)));
    if (clash) throw duplicateSlug(data.slug);
    const [row] = await db
      .insert(hazards)
      .values({ tenantId: tenant.id, ...hazardValues(data), published: data.published })
      .returning()
      .catch((err) => {
        throw isUniqueViolation(err) ? duplicateSlug(data.slug) : err;
      });
    await audit(tenant.id, 'hazard', row!.id, 'create', null, row, db);
    return row!.id;
  });
  revalidate(tenant);
  return { id };
});

export const updateHazard = action(
  async (input: { tenantSlug: string; id: string; hazard: Omit<HazardInputDraft, 'published'> }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const id = idSchema.parse(input.id);
    const data = hazardUpdateSchema.parse(input.hazard);
    await userDb(async (db) => {
      const [before] = await db.select().from(hazards).where(and(eq(hazards.id, id), eq(hazards.tenantId, tenant.id)));
      if (!before) throw new UserError('Unknown hazard.');
      if (data.slug !== before.slug) {
        const [clash] = await db
          .select({ id: hazards.id })
          .from(hazards)
          .where(and(eq(hazards.tenantId, tenant.id), eq(hazards.slug, data.slug)));
        if (clash) throw duplicateSlug(data.slug);
      }
      const [after] = await db
        .update(hazards)
        .set({ ...hazardValues(data), updatedAt: new Date() })
        .where(eq(hazards.id, before.id))
        .returning()
        .catch((err) => {
          throw isUniqueViolation(err) ? duplicateSlug(data.slug) : err;
        });
      if (data.slug !== before.slug) await rewriteHazardLinks(db, tenant.id, before.slug, data.slug);
      await audit(tenant.id, 'hazard', before.id, 'update', before, after, db);
    });
    revalidate(tenant);
  },
);

export const deleteHazard = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const id = idSchema.parse(input.id);
  await userDb(async (db) => {
    const [before] = await db
      .delete(hazards)
      .where(and(eq(hazards.id, id), eq(hazards.tenantId, tenant.id)))
      .returning();
    if (!before) throw new UserError('Unknown hazard.');
    await rewriteHazardLinks(db, tenant.id, before.slug, null);
    await audit(tenant.id, 'hazard', before.id, 'delete', before, null, db);
  });
  revalidate(tenant);
});

// ---- Plans (editors) ---------------------------------------------------------------------

function planValues(data: Omit<EmergencyPlanInput, 'published'>) {
  return {
    title: data.title,
    agency: data.agency,
    url: data.url,
    adoptedYear: data.adopted_year,
    summary: data.summary,
    languages: data.languages,
    hazardSlugs: data.hazard_slugs,
    displayOrder: data.display_order,
  };
}

export const createPlan = action(
  async (input: { tenantSlug: string; plan: EmergencyPlanInputDraft }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const data = emergencyPlanInputSchema.parse(input.plan);
    const id = await userDb(async (db) => {
      await assertHazardSlugs(db, tenant.id, data.hazard_slugs);
      const [row] = await db
        .insert(emergencyPlans)
        .values({ tenantId: tenant.id, ...planValues(data), published: data.published })
        .returning();
      await audit(tenant.id, 'emergency_plan', row!.id, 'create', null, row, db);
      return row!.id;
    });
    revalidate(tenant);
    return { id };
  },
);

export const updatePlan = action(
  async (input: { tenantSlug: string; id: string; plan: Omit<EmergencyPlanInputDraft, 'published'> }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const id = idSchema.parse(input.id);
    const data = planUpdateSchema.parse(input.plan);
    await userDb(async (db) => {
      const [before] = await db
        .select()
        .from(emergencyPlans)
        .where(and(eq(emergencyPlans.id, id), eq(emergencyPlans.tenantId, tenant.id)));
      if (!before) throw new UserError('Unknown plan.');
      await assertHazardSlugs(db, tenant.id, data.hazard_slugs);
      const [after] = await db
        .update(emergencyPlans)
        .set({ ...planValues(data), updatedAt: new Date() })
        .where(eq(emergencyPlans.id, before.id))
        .returning();
      await audit(tenant.id, 'emergency_plan', before.id, 'update', before, after, db);
    });
    revalidate(tenant);
  },
);

export const deletePlan = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const id = idSchema.parse(input.id);
  await userDb(async (db) => {
    const [before] = await db
      .delete(emergencyPlans)
      .where(and(eq(emergencyPlans.id, id), eq(emergencyPlans.tenantId, tenant.id)))
      .returning();
    if (!before) throw new UserError('Unknown plan.');
    await audit(tenant.id, 'emergency_plan', before.id, 'delete', before, null, db);
  });
  revalidate(tenant);
});

// ---- Help and mutual-aid resources (editors) ------------------------------------------------

function resourceValues(data: Omit<EmergencyResourceInput, 'published'>) {
  return {
    name: data.name,
    kind: data.kind,
    description: data.description,
    phone: data.phone,
    url: data.url,
    hazardSlugs: data.hazard_slugs,
    displayOrder: data.display_order,
  };
}

export const createResource = action(
  async (input: { tenantSlug: string; resource: EmergencyResourceInputDraft }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const data = emergencyResourceInputSchema.parse(input.resource);
    const id = await userDb(async (db) => {
      await assertHazardSlugs(db, tenant.id, data.hazard_slugs);
      const [row] = await db
        .insert(emergencyResources)
        .values({ tenantId: tenant.id, ...resourceValues(data), published: data.published })
        .returning();
      await audit(tenant.id, 'emergency_resource', row!.id, 'create', null, row, db);
      return row!.id;
    });
    revalidate(tenant);
    return { id };
  },
);

export const updateResource = action(
  async (input: { tenantSlug: string; id: string; resource: Omit<EmergencyResourceInputDraft, 'published'> }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const id = idSchema.parse(input.id);
    const data = resourceUpdateSchema.parse(input.resource);
    await userDb(async (db) => {
      const [before] = await db
        .select()
        .from(emergencyResources)
        .where(and(eq(emergencyResources.id, id), eq(emergencyResources.tenantId, tenant.id)));
      if (!before) throw new UserError('Unknown resource.');
      await assertHazardSlugs(db, tenant.id, data.hazard_slugs);
      const [after] = await db
        .update(emergencyResources)
        .set({ ...resourceValues(data), updatedAt: new Date() })
        .where(eq(emergencyResources.id, before.id))
        .returning();
      await audit(tenant.id, 'emergency_resource', before.id, 'update', before, after, db);
    });
    revalidate(tenant);
  },
);

export const deleteResource = action(async (input: { tenantSlug: string; id: string }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  const id = idSchema.parse(input.id);
  await userDb(async (db) => {
    const [before] = await db
      .delete(emergencyResources)
      .where(and(eq(emergencyResources.id, id), eq(emergencyResources.tenantId, tenant.id)))
      .returning();
    if (!before) throw new UserError('Unknown resource.');
    await audit(tenant.id, 'emergency_resource', before.id, 'delete', before, null, db);
  });
  revalidate(tenant);
});

// ---- Publishing (editors) ------------------------------------------------------------------------

const ENTITIES = {
  hazard: hazards,
  emergency_plan: emergencyPlans,
  emergency_resource: emergencyResources,
} as const;
export type EmergencyEntity = keyof typeof ENTITIES;

/**
 * The published toggle on every list: one field, so the admin page can
 * flip it without resending (and re-validating) the whole record.
 */
export const setEmergencyPublished = action(
  async (input: { tenantSlug: string; entity: EmergencyEntity; id: string; published: boolean }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    const id = idSchema.parse(input.id);
    // Own keys only: the entity name arrives from the client.
    if (!Object.hasOwn(ENTITIES, input.entity)) throw new UserError('Unknown record type.');
    const table = ENTITIES[input.entity];
    const published = z.boolean().parse(input.published);
    await userDb(async (db) => {
      const [row] = await db
        .update(table)
        .set({ published, updatedAt: new Date() })
        .where(and(eq(table.id, id), eq(table.tenantId, tenant.id)))
        .returning({ id: table.id });
      if (!row) throw new UserError('Unknown record.');
      await audit(tenant.id, input.entity, row.id, published ? 'publish' : 'unpublish', { published: !published }, { published }, db);
    });
    revalidate(tenant);
  },
);
