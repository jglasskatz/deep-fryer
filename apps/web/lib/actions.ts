'use server';

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import {
  assignIndicatorKeys,
  computeScoring,
  deriveVizLevel,
  dimensionDataSchema,
  frameworkIndicatorKeys,
  resolveThreshold,
  tenantConfigSchemas,
  type DimensionData,
  type Indicator,
  type TenantConfigKey,
} from '@deep-fryer/core';
import { frameworkDimension } from '@deep-fryer/contract';
import {
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  latestVersion,
  tenantConfig,
  tenants,
} from '@deep-fryer/db';
import { tenantStorage } from '@deep-fryer/research';
import {
  LOGO_TOO_LARGE,
  LOGO_WRONG_TYPE,
  MAX_LOGO_BYTES,
  brandingInputSchema,
  logoStoragePath,
  nextBranding,
  sniffLogo,
} from '@/components/site-header/branding';
import { isOrigin } from './csp';
import { getAuth, requireTenantRole } from './auth';
import { audit } from './audit';
import { configValueIn } from './admin-data';
import { action, UserError } from './action-result';
import { publishVersionFor } from './publish';
import { userDb } from './db';

/**
 * Re-run the thresholds engine over numeric indicators (SPEC.md §8 Scoring):
 * threshold comes from the contract, overridden by tenant config; the worked
 * arithmetic is stored on the indicator.
 */
function rescore(
  data: DimensionData,
  dimensionSlug: string,
  canonicalSlug: string | null,
  overrides: Record<string, { target: number; rationale: string }> | null,
): DimensionData {
  const frameworkDim = frameworkDimension(dimensionSlug, canonicalSlug);
  const indicators: Indicator[] = data.indicators.map((ind) => {
    const ref =
      ind.scoring?.threshold_ref ??
      (frameworkDim?.indicators.find((fi) => fi.slug === ind.key) ??
        frameworkDim?.indicators.find((fi) => fi.name === ind.name))?.threshold_ref;
    if (!ref || typeof ind.value !== 'number') return ind;
    const threshold = resolveThreshold(ref, overrides ?? undefined);
    if (!threshold) return ind;
    try {
      const { level_pct, scoring } = computeScoring(ind.value, ref, threshold);
      return {
        ...ind,
        level_pct,
        scoring,
        target: typeof ind.target === 'number' || ind.target === null ? threshold.target : ind.target,
      };
    } catch {
      return ind;
    }
  });
  return { ...data, indicators };
}

export interface SaveDimensionEditInput {
  tenantSlug: string;
  dimensionId: string;
  data: DimensionData;
  changeNote: string;
}

/**
 * Human edit → new immutable version, origin 'human' (SPEC.md §7):
 * change_note required, and any indicator whose value changed must carry a
 * supporting_source_url — human edits meet the same provenance bar as
 * research. Rows are matched to the previous version by key (core
 * assignIndicatorKeys), so renaming an indicator is not a value change; a
 * row with no key yet is matched by name.
 */
export const saveDimensionEdit = action(async (input: SaveDimensionEditInput) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
  return userDb(async (db) => {
    const changeNote = input.changeNote.trim();
    if (!changeNote) throw new UserError('A change note is required for human edits.');

    const submitted = dimensionDataSchema.parse(input.data) as DimensionData;

    const [dimension] = await db
      .select()
      .from(dimensions)
      .where(and(eq(dimensions.id, input.dimensionId), eq(dimensions.tenantId, tenant.id)));
    if (!dimension) throw new UserError('Unknown dimension.');

    const previous = await latestVersion(db, dimension.id);
    const known = frameworkIndicatorKeys(dimension.slug, dimension.canonicalSlug);
    const previousRows = assignIndicatorKeys(previous?.data.indicators ?? [], [], known);
    const parsed: DimensionData = {
      ...submitted,
      indicators: assignIndicatorKeys(submitted.indicators, previousRows, known),
    };

    // Value changes need supporting sources (SPEC.md §7 immutability contract).
    if (previous) {
      const prevByKey = new Map(previousRows.map((i) => [i.key, i]));
      for (const ind of parsed.indicators) {
        const prev = prevByKey.get(ind.key);
        const valueChanged = !prev || String(prev.value ?? '') !== String(ind.value ?? '');
        if (valueChanged && ind.value !== null && !ind.supporting_source_url?.trim()) {
          throw new UserError(
            `Indicator '${ind.name}': value changes require a supporting source URL.`,
          );
        }
      }
    }

    // On this transaction: configValue would open a second one, waiting for
    // another pooled connection while this one is held (lib/admin-data.ts).
    const overrides = await configValueIn(db, tenant.id, 'threshold_overrides');
    const rescored = rescore(parsed, dimension.slug, dimension.canonicalSlug, overrides);
    const vizLevel = deriveVizLevel(rescored);

    const auth = await getAuth();
    const version = await appendDimensionVersion(db, {
      dimensionId: dimension.id,
      status: 'draft',
      data: rescored,
      vizLevel,
      origin: 'human',
      changeNote,
      createdBy: auth.userId,
    });

    await audit(
      tenant.id,
      'dimension_version',
      version.id,
      'create_human_version',
      null,
      { dimension: dimension.slug, version_num: version.versionNum, change_note: changeNote },
      db,
    );

    revalidatePath(`/${tenant.slug}/admin`);
    return { versionId: version.id, versionNum: version.versionNum };
  });
});

export const publishVersion = action(
  async (input: { tenantSlug: string; versionId: string; revert?: boolean }) => {
    const { tenant } = await requireTenantRole(input.tenantSlug, 'editor');
    await userDb((db) => publishVersionFor(db, tenant, input.versionId, input.revert));
  },
);

/** Validated write to a §6 config key; every change is audited. */
export const updateConfig = action(async (input: {
  tenantSlug: string;
  key: TenantConfigKey;
  value: unknown;
}) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  return userDb(async (db) => {
    const schema = tenantConfigSchemas[input.key];
    if (!schema) throw new UserError(`Unknown config key '${input.key}'.`);
    const value = schema.parse(input.value);

    const [existing] = await db
      .select()
      .from(tenantConfig)
      .where(and(eq(tenantConfig.tenantId, tenant.id), eq(tenantConfig.key, input.key)));

    const auth = await getAuth();
    await db
      .insert(tenantConfig)
      .values({
        tenantId: tenant.id,
        key: input.key,
        value,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [tenantConfig.tenantId, tenantConfig.key],
        set: { value, updatedBy: auth.userId, updatedAt: new Date() },
      });

    await audit(tenant.id, 'tenant_config', tenant.id, `config:${input.key}`, existing?.value, value, db);

    revalidatePath(`/${tenant.slug}/admin/settings`);
    revalidatePath(`/${tenant.slug}/methodology`);
  });
});

/**
 * The portrait's logo, colour and font (components/site-header/branding.ts),
 * from the settings form as form data, since it can carry a file:
 * `tenantSlug`, `colour` (#rrggbb, or empty for none), `font` (a key from
 * the fixed list), `logo` (a file, optional) and `remove_logo` ("on").
 *
 * The colour must show against both page themes and the font must be on the
 * list; the logo's kind is read from its bytes. A new logo is stored first,
 * under a fresh name (storage never overwrites), then the branding row is
 * written and audited in one transaction.
 */
export const updateBranding = action(async (request: FormData) => {
  // Anything but form data is read as empty fields: it names no portrait, so
  // the role check refuses it before anything else is read.
  const form: Pick<FormData, 'get'> =
    typeof (request as Partial<FormData> | null)?.get === 'function' ? request : { get: () => null };
  const text = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : '';
  };
  const { tenant } = await requireTenantRole(text('tenantSlug'), 'owner');
  const parsed = brandingInputSchema.safeParse({ colour: text('colour'), font: text('font') });
  // The rules' own messages are written for the owner; they are shown as they are.
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? 'These settings could not be saved.');
  const input = parsed.data;

  let logoPath: string | null | undefined;
  const file = form.get('logo');
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_LOGO_BYTES) throw new UserError(LOGO_TOO_LARGE);
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = sniffLogo(bytes);
    if (!kind) throw new UserError(LOGO_WRONG_TYPE);
    const storage = await tenantStorage(tenant.slug, {
      // Without object storage, files sit where the app serves them locally
      // (lib/data.ts evidenceBase), as the worker's do.
      localFallbackDir: path.resolve(process.cwd(), 'public', 'evidence', tenant.slug),
    });
    logoPath = await storage.put(logoStoragePath(kind, new Date(), randomBytes(4).toString('hex')), bytes, kind.contentType);
  } else if (text('remove_logo') === 'on') {
    logoPath = null;
  }

  await userDb(async (db) => {
    const [current] = await db.select({ branding: tenants.branding }).from(tenants).where(eq(tenants.id, tenant.id));
    const before = current?.branding ?? null;
    const branding = nextBranding(before, { ...input, logoPath });
    await db.update(tenants).set({ branding }).where(eq(tenants.id, tenant.id));
    await audit(tenant.id, 'tenant', tenant.id, 'branding', before, branding, db);
  });
  revalidatePath(`/${tenant.slug}/admin/settings`);
  revalidatePath(`/${tenant.slug}`, 'layout');
});

/**
 * The embed allowlist (SPEC.md §10): origins allowed to frame /embed/{tenant}.
 * Enforced by the browser via CSP frame-ancestors (middleware.ts), so each
 * entry must be a bare origin — scheme, host, optional port; https in
 * production.
 */
export const updateEmbedOrigins = action(async (input: { tenantSlug: string; origins: string[] }) => {
  const { tenant } = await requireTenantRole(input.tenantSlug, 'owner');
  const cleaned = [...new Set(input.origins.map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean))];
  if (cleaned.length > 20) throw new UserError('At most 20 embedding sites.');
  for (const origin of cleaned) {
    if (!isOrigin(origin)) {
      throw new UserError(`"${origin}" is not an origin — use the form https://www.example.gov`);
    }
    if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
      throw new UserError(`"${origin}" must use https.`);
    }
  }
  const before = tenant.embedOrigins ?? [];
  await userDb(async (db) => {
    await db.update(tenants).set({ embedOrigins: cleaned }).where(eq(tenants.id, tenant.id));
    await audit(tenant.id, 'tenant', tenant.id, 'embed_origins', before, cleaned, db);
  });
  revalidatePath(`/${tenant.slug}/admin/settings`);
});
