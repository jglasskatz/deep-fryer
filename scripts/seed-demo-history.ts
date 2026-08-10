#!/usr/bin/env tsx
/**
 * Seed publication history + source-library rows so /{tenant}/progress and
 * /{tenant}/sources are demoable offline: two backdated eras on a few
 * dimensions covering all three vintage-rule cases (year-advance improving,
 * year-advance worsening, same-year revision), plus sources rows with real
 * text and quotes wired into the current published indicators.
 *
 *   pnpm seed-demo-history [--tenant santacruz]
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { normalizeForMatch, type Indicator } from '@deep-fryer/core';
import {
  appendDimensionVersion,
  dimensions,
  dimensionVersions,
  getDb,
  latestVersion,
  recordSource,
  tenantBySlug,
} from '@deep-fryer/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Shift an indicator into a past vintage with a plausibly different value. */
function backdate(ind: Indicator, yearsBack: number, factor: number): Indicator {
  const value =
    typeof ind.value === 'number' ? Number((ind.value * factor).toFixed(1)) : ind.value;
  const level =
    ind.level_pct !== undefined ? Number((ind.level_pct + yearsBack * 12).toFixed(1)) : undefined;
  return {
    ...ind,
    value,
    year: ind.year !== null ? ind.year - yearsBack : ind.year,
    level_pct: level,
    scoring: undefined, // historical eras in this demo carry no worked math
  };
}

async function main() {
  const db = getDb();
  const tenantSlug = arg('tenant') ?? 'santacruz';
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) throw new Error(`tenant ${tenantSlug} missing`);

  const dims = await db
    .select()
    .from(dimensions)
    .where(eq(dimensions.tenantId, tenant.id))
    .orderBy(dimensions.displayOrder);

  const eras = [
    { at: new Date('2024-03-01T12:00:00Z'), yearsBack: 2, factor: 1.18 },
    { at: new Date('2025-03-01T12:00:00Z'), yearsBack: 1, factor: 1.08 },
  ];

  let seeded = 0;
  for (const dim of dims.slice(0, 6)) {
    const current = await latestVersion(db, dim.id);
    if (!current || !current.publishedAt || current.data.indicators.length === 0) continue;

    for (const era of eras) {
      // Idempotency: skip if this dimension already has a version on that day.
      const existing = await db
        .select({ publishedAt: dimensionVersions.publishedAt })
        .from(dimensionVersions)
        .where(eq(dimensionVersions.dimensionId, dim.id));
      if (
        existing.some(
          (v) => v.publishedAt && v.publishedAt.toISOString().slice(0, 10) === era.at.toISOString().slice(0, 10),
        )
      ) {
        continue;
      }
      await appendDimensionVersion(db, {
        dimensionId: dim.id,
        status: 'archived',
        data: {
          ...current.data,
          indicators: current.data.indicators.map((ind) => backdate(ind, era.yearsBack, era.factor)),
        },
        // viz_level rides the -100..150 site scale; past eras sit a bit
        // further outside the safe zone so the doughnuts visibly differ.
        vizLevel:
          current.vizLevel !== null
            ? Math.min(150, Math.round(current.vizLevel + era.yearsBack * 15))
            : null,
        origin: 'import',
        publishedAt: era.at,
      });
      seeded += 1;
    }
  }

  // A same-year revision on the first seeded dimension's 2025 era: one more
  // version published later the same quarter with the same vintage but a
  // corrected value — must render as "revised", never an arrow.
  const revDim = dims[0];
  if (revDim) {
    const current = await latestVersion(db, revDim.id);
    if (current?.data.indicators.length) {
      const marker = new Date('2025-05-15T12:00:00Z');
      const existing = await db
        .select({ publishedAt: dimensionVersions.publishedAt })
        .from(dimensionVersions)
        .where(eq(dimensionVersions.dimensionId, revDim.id));
      if (
        !existing.some(
          (v) => v.publishedAt && v.publishedAt.toISOString().slice(0, 10) === marker.toISOString().slice(0, 10),
        )
      ) {
        await appendDimensionVersion(db, {
          dimensionId: revDim.id,
          status: 'archived',
          data: {
            ...current.data,
            indicators: current.data.indicators.map((ind, i) =>
              i === 0
                ? {
                    ...backdate(ind, 1, 1.08),
                    value:
                      typeof ind.value === 'number'
                        ? Number((ind.value * 1.02).toFixed(1))
                        : ind.value,
                  }
                : backdate(ind, 1, 1.08),
            ),
          },
          vizLevel: current.vizLevel,
          origin: 'import',
          publishedAt: marker,
        });
        seeded += 1;
      }
    }
  }

  // Source-library rows with searchable text + quotes for currently
  // published indicators that carry evidence (drives /sources and ?q=).
  let sourceRows = 0;
  for (const dim of dims.slice(0, 6)) {
    const current = await latestVersion(db, dim.id);
    for (const ind of current?.data.indicators ?? []) {
      if (!ind.evidence?.snapshot_path || !ind.source_url) continue;
      const text =
        `${ind.name} — official data release. ` +
        `In ${ind.year}, the reported figure for ${ind.name.toLowerCase()} was ${ind.value}${ind.unit ? ` ${ind.unit}` : ''} ` +
        `for the ${tenant.name} area. The methodology and full tables are published by ${ind.source}. ` +
        `This synthetic passage stands in for the archived page text in local demos.`;
      const inserted = await recordSource(db, {
        tenantId: tenant.id,
        url: ind.source_url,
        urlHash: createHash('sha256').update(ind.source_url).digest('hex').slice(0, 12),
        contentHash: createHash('sha256').update(normalizeForMatch(text)).digest('hex'),
        title: `${ind.source}: ${ind.name}`,
        mediaType: 'html',
        text,
        textSource: 'html',
        extraction: 'backfill',
        snapshotPath: ind.evidence.snapshot_path,
        pdfPath: ind.evidence.pdf_path ?? null,
        capturedAt: new Date(ind.evidence.captured_at),
        dimensionId: dim.id,
        sourceTier: ind.source_tier ?? 1,
      });
      if (inserted) sourceRows += 1;
    }
  }

  console.log(
    `Seeded ${seeded} backdated versions and ${sourceRows} source rows for ${tenantSlug}.`,
  );
  console.log(`Explore: /${tenantSlug}/progress and /${tenantSlug}/sources`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
