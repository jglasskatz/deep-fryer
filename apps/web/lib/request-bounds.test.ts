import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REQUEST_LIMITS } from '@deep-fryer/core';
import { describe, expect, it, vi } from 'vitest';

/**
 * Lists and records a server action reads have a maximum, and one entry
 * more is refused before anything is looked up. The schemas shared with
 * core are walked entry by entry in packages/core request-limits.test.ts;
 * these are the ones the web app writes itself, and the core ones as an
 * action reads them.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
const untouchable = vi.hoisted(
  () =>
    new Proxy({}, {
      get(_, key) {
        throw new Error(`database used before the request was refused (${String(key)})`);
      },
    }),
);
vi.mock('@/lib/db', () => ({
  userDb: (fn: (db: unknown) => unknown) => fn(untouchable),
  systemDb: () => untouchable,
  systemTransaction: (fn: (db: unknown) => unknown) => fn(untouchable),
}));
vi.mock('@/lib/auth', () => ({
  getAuth: async () => ({ userId: 'u1', devMode: false }),
  requireTenantRole: async () => ({ tenant: { id: 't1', slug: 'somewhere' }, role: 'owner' }),
}));
const research = vi.hoisted(() => ({ createPlannedRun: vi.fn(), applyRun: vi.fn() }));
vi.mock('@/lib/research', () => research);

const list = <T>(n: number, entry: (i: number) => T) => Array.from({ length: n }, (_, i) => entry(i));
const refused = (result: unknown) => {
  expect(result).toMatchObject({ ok: false });
  expect((result as { error: string }).error).toMatch(/Too big/);
};

describe('action lists one entry over their maximum are refused', () => {
  it('a new dimension takes at most 30 indicator names', async () => {
    const { createDimension } = await import('./dimension-admin-actions');
    refused(await createDimension({ tenantSlug: 'somewhere', slug: 'water', name: 'Water', ring: 'social', indicatorNames: list(31, (i) => `n${i}`) }));
  });

  it('a reorder takes at most 200 dimensions', async () => {
    const { reorderDimensions } = await import('./dimension-admin-actions');
    const ids = list(201, (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    refused(await reorderDimensions({ tenantSlug: 'somewhere', dimensionIds: ids }));
  });

  it('an outreach contact takes at most 30 tags and 30 data needs', async () => {
    const { saveOutreachContact } = await import('./outreach-admin-actions');
    const contact = { org: 'Food bank', tags: [] as string[], data_needs: [] as string[] };
    refused(await saveOutreachContact({ tenantSlug: 'somewhere', data: { ...contact, tags: list(31, (i) => `t${i}`) } }));
    refused(await saveOutreachContact({ tenantSlug: 'somewhere', data: { ...contact, data_needs: list(31, (i) => `d${i}`) } }));
  });

  it('a research plan takes one dimension id, and one note, per dimension of the portrait', async () => {
    const { planResearchAction } = await import('./research-actions');
    const max = REQUEST_LIMITS.dimensions;
    refused(await planResearchAction({ tenantSlug: 'somewhere', dimensionIds: list(max + 1, (i) => `d${i}`) }));
    refused(
      await planResearchAction({
        tenantSlug: 'somewhere',
        reviewerNotes: Object.fromEntries(list(max + 1, (i) => [`d${i}`, 'note'])),
      }),
    );
    expect(research.createPlannedRun).not.toHaveBeenCalled();

    research.createPlannedRun.mockResolvedValue({ run: { id: 'r1' }, sessionCount: 3 });
    const notes = Object.fromEntries(list(max, (i) => [`d${i}`, 'note']));
    const ids = list(max, (i) => `d${i}`);
    expect(await planResearchAction({ tenantSlug: 'somewhere', dimensionIds: ids, reviewerNotes: notes })).toEqual({
      ok: true,
      data: { runId: 'r1', sessionCount: 3 },
    });
    expect(research.createPlannedRun).toHaveBeenCalledWith(expect.objectContaining({ dimensionIds: ids, reviewerNotes: notes }));
  });

  it('a dimension edit takes at most the indicators, gaps and actions a dimension can hold', async () => {
    const { saveDimensionEdit } = await import('./actions');
    const indicator = { name: 'x', value: null, unit: '', year: null, target: null, source: '', source_url: '', confidence: 'low', geographic_scale: 'city' };
    const base = { name: 'Water', icon: '', description: '', context: '', indicators: [], actions: [] };
    const edit = (changes: object) =>
      saveDimensionEdit({ tenantSlug: 'somewhere', dimensionId: 'd1', changeNote: 'bulk', data: { ...base, ...changes } as never });
    refused(await edit({ indicators: list(REQUEST_LIMITS.indicatorsPerDimension + 1, () => indicator) }));
    refused(await edit({ actions: list(REQUEST_LIMITS.actionsPerDimension + 1, () => 'act') }));
    refused(await edit({ gaps: list(REQUEST_LIMITS.gapsPerDimension + 1, () => ({})) }));
  });

  it('a settings write takes at most 1,000 threshold overrides', async () => {
    const { updateConfig } = await import('./actions');
    const overrides = Object.fromEntries(
      list(REQUEST_LIMITS.thresholdOverrides + 1, (i) => [`ref-${i}`, { target: 1, rationale: 'r' }]),
    );
    refused(await updateConfig({ tenantSlug: 'somewhere', key: 'threshold_overrides', value: overrides }));
  });
});

/**
 * The calls chained onto a schema expression starting at `from` (just past
 * its closing parenthesis): `.max(30).optional()` gives ['max', 'optional'].
 */
function chainedCalls(source: string, from: number): string[] {
  const names: string[] = [];
  let i = from;
  for (;;) {
    const match = /^\s*\.\s*([A-Za-z]+)\s*\(/.exec(source.slice(i));
    if (!match) return names;
    names.push(match[1]!);
    i = closingParen(source, i + match[0].length - 1) + 1;
  }
}

/** The index of the parenthesis closing the one at `open`. */
function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced parentheses');
}

describe('request schemas the web app writes', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  const files = [
    ...routeFiles(path.join(root, 'app/api')),
    ...readdirSync(import.meta.dirname)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => path.join(import.meta.dirname, f))
      .filter((f) => readFileSync(f, 'utf8').startsWith("'use server';")),
  ];

  it('covers the API routes and the server action modules', () => {
    expect(files.some((f) => f.endsWith(path.join('research', 'plan', 'route.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith('dimension-admin-actions.ts'))).toBe(true);
  });

  it('declare a maximum on every list, and read records only through boundedRecord', () => {
    const unbounded: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bz\s*\.\s*(array|record|map|set|tuple)\s*\(/g)) {
        const where = `${path.relative(root, file)}: ${match[0]}`;
        if (match[1] !== 'array') {
          unbounded.push(where);
          continue;
        }
        const calls = chainedCalls(source, closingParen(source, match.index + match[0].length - 1) + 1);
        const firstOther = calls.findIndex((name) => name !== 'min' && name !== 'max' && name !== 'length' && name !== 'nonempty');
        if (!calls.slice(0, firstOther === -1 ? calls.length : firstOther).includes('max')) unbounded.push(where);
      }
    }
    expect(unbounded).toEqual([]);
  });
});
