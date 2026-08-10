import { and, eq, isNotNull } from 'drizzle-orm';
import type { Indicator } from '@deep-fryer/core';
import {
  dimensions,
  dimensionVersions,
  getDb,
  publishedDoughnutAsOf,
  publishedSnapshotDates,
  tenantBySlug,
} from '@deep-fryer/db';
import type { PublishedPortrait } from './portrait';

/**
 * Era selection for /{tenant}/progress: up to four snapshots from the
 * tenant's distinct publish days — earliest, latest, and evenly spaced
 * intermediates — resolved through published_doughnut_asof at end-of-day so
 * everything published that day is included. `?at=YYYY-MM-DD,…` overrides.
 */
export interface Era {
  at: Date;
  label: string;
  portrait: PublishedPortrait;
}

const MAX_ERAS = 4;

function endOfDay(d: Date): Date {
  const t = new Date(d);
  t.setUTCHours(23, 59, 59, 999);
  return t;
}

function pickEras(days: Date[]): Date[] {
  if (days.length <= MAX_ERAS) return days;
  const picked = [days[0]!];
  for (let i = 1; i < MAX_ERAS - 1; i++) {
    picked.push(days[Math.round((i * (days.length - 1)) / (MAX_ERAS - 1))]!);
  }
  picked.push(days[days.length - 1]!);
  return [...new Set(picked.map((d) => +d))].map((t) => new Date(t));
}

export async function progressEras(
  tenantSlug: string,
  atOverride?: string,
): Promise<Era[] | null> {
  const db = getDb();
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) return null;

  let days: Date[];
  if (atOverride) {
    days = atOverride
      .split(',')
      .map((s) => new Date(s.trim()))
      .filter((d) => !Number.isNaN(+d));
  } else {
    days = pickEras(await publishedSnapshotDates(db, tenant.id));
  }
  if (days.length === 0) return [];

  const eras = await Promise.all(
    days.map(async (day) => {
      const portrait = await publishedDoughnutAsOf<PublishedPortrait>(
        db,
        tenantSlug,
        endOfDay(day),
      );
      return portrait
        ? { at: day, label: day.toISOString().slice(0, 10), portrait }
        : null;
    }),
  );
  return eras.filter((e): e is Era => e !== null && e.portrait.dimensions.length > 0);
}

export interface DimensionHistoryPoint {
  at: Date;
  versionNum: number;
  vizLevel: number | null;
  indicators: Indicator[];
}

/** Publication history of one dimension (public slug), oldest first. */
export async function dimensionHistory(
  tenantSlug: string,
  dimSlug: string,
): Promise<DimensionHistoryPoint[]> {
  const db = getDb();
  const tenant = await tenantBySlug(db, tenantSlug);
  if (!tenant) return [];
  const [dim] = await db
    .select()
    .from(dimensions)
    .where(and(eq(dimensions.tenantId, tenant.id), eq(dimensions.slug, dimSlug)));
  if (!dim) return [];
  const rows = await db
    .select()
    .from(dimensionVersions)
    .where(
      and(eq(dimensionVersions.dimensionId, dim.id), isNotNull(dimensionVersions.publishedAt)),
    )
    .orderBy(dimensionVersions.publishedAt);
  return rows.map((v) => ({
    at: v.publishedAt!,
    versionNum: v.versionNum,
    vizLevel: v.vizLevel,
    indicators: v.data.indicators,
  }));
}
