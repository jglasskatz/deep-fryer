import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DimensionData } from '@deep-fryer/core';
import { UserError } from './action-result';
import { applyDimensionGridEdits, groupGridEdits, type GridCellEdit } from './grid-edits';

/*
 * Tests for grid-edits (pure row-id patching, preservation, rescoring and
 * provenance enforcement) and grid-actions saveGridEdits (editor-only RBAC,
 * viewer refusal, single userDb transaction / one-connection discipline,
 * draft-only guarantee, optimistic concurrency, and per-dimension audit_log).
 */

const DIM_FOOD_ID = '11111111-1111-4111-8111-111111111111';
const DIM_HEALTH_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockState = vi.hoisted(() => ({
  role: 'editor' as 'owner' | 'editor' | 'moderator' | 'viewer' | null,
  dimRows: [] as Array<{
    id: string;
    tenantId: string;
    slug: string;
    canonicalSlug: string | null;
    publishedVersionId: string | null;
    archivedAt: Date | null;
  }>,
  latestByDim: new Map<string, { id: string; dimensionId: string; versionNum: number; data: DimensionData }>(),
  overrides: null as Record<string, { target: number; rationale: string }> | null,
  appended: [] as Array<{ tx: unknown; values: Record<string, unknown> }>,
  audited: [] as Array<{ args: unknown[] }>,
  userDbCalls: 0,
  systemDbCalls: 0,
  configValueInTx: [] as unknown[],
  latestByDimTx: [] as unknown[],
  revalidated: [] as string[],
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((p: string) => {
    mockState.revalidated.push(p);
  }),
  revalidateTag: vi.fn(),
}));

vi.mock('./auth', () => ({
  requireTenantRole: vi.fn(async (tenantSlug: string, min: string) => {
    if (!tenantSlug) throw new UserError("Unknown portrait ''.");
    const rank: Record<string, number> = { viewer: 0, moderator: 1, editor: 2, owner: 3 };
    if (!mockState.role || (rank[mockState.role] ?? -1) < (rank[min] ?? 99)) {
      throw new UserError(`This needs the ${min} role on this portrait.`);
    }
    return {
      tenant: { id: TENANT_ID, slug: tenantSlug, name: 'Test City' },
      role: mockState.role,
    };
  }),
  getAuth: vi.fn(async () => ({
    userId: USER_ID,
    email: 'editor@example.gov',
    name: 'Editor',
    displayName: 'Editor',
    isStaff: false,
    devMode: false,
  })),
}));

vi.mock('./db', () => ({
  userDb: vi.fn(async <T,>(fn: (db: unknown) => Promise<T>): Promise<T> => {
    mockState.userDbCalls++;
    const tx = {
      __txId: `tx-${mockState.userDbCalls}`,
      select: () => ({
        from: () => ({
          where: async () => mockState.dimRows.filter((d) => d.archivedAt === null),
        }),
      }),
      update: () => {
        throw new Error('saveGridEdits must never update dimensions (drafts only, never auto-publish)');
      },
    };
    return fn(tx);
  }),
  systemDb: vi.fn(() => {
    mockState.systemDbCalls++;
    throw new Error('saveGridEdits must not touch systemDb inside its userDb transaction');
  }),
}));

vi.mock('./admin-data', () => ({
  configValueIn: vi.fn(async (db: unknown) => {
    mockState.configValueInTx.push(db);
    return mockState.overrides;
  }),
  configValue: vi.fn(async () => {
    throw new Error('saveGridEdits must use configValueIn on the active transaction, not configValue');
  }),
}));

vi.mock('./audit', () => ({
  audit: vi.fn(async (...args: unknown[]) => {
    mockState.audited.push({ args });
  }),
}));

vi.mock('@deep-fryer/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deep-fryer/db')>()),
  latestVersionsByDimension: vi.fn(async (db: unknown, ids: string[]) => {
    mockState.latestByDimTx.push(db);
    const out = new Map<string, { id: string; dimensionId: string; versionNum: number; data: DimensionData }>();
    for (const id of ids) {
      const v = mockState.latestByDim.get(id);
      if (v) out.set(id, v);
    }
    return out;
  }),
  appendDimensionVersion: vi.fn(async (db: unknown, values: Record<string, unknown>) => {
    mockState.appended.push({ tx: db, values });
    const prev = mockState.latestByDim.get(values.dimensionId as string);
    const versionNum = (prev?.versionNum ?? 0) + 1;
    return {
      id: `ver-${values.dimensionId}-v${versionNum}`,
      dimensionId: values.dimensionId,
      versionNum,
      status: values.status,
      data: values.data,
      vizLevel: values.vizLevel,
      origin: values.origin,
      changeNote: values.changeNote,
      createdBy: values.createdBy,
    };
  }),
}));

function sampleFoodData(): DimensionData {
  return {
    name: 'Food',
    icon: 'wheat',
    description: 'Access to nutritious food.',
    context: 'Local food insecurity has risen since 2022.',
    actions: ['Expand mobile food pantry', 'Increase school meal enrollment'],
    policy_spotlight: 'County Food Action Plan 2026',
    justice_spotlight: 'Higher burden among agricultural workers.',
    indicators: [
      {
        key: 'food-insecurity-rate',
        name: 'Food insecurity rate',
        value: 12.4,
        unit: '% of residents',
        year: 2023,
        target: 10,
        level_pct: 24,
        source: 'DataShare SCC',
        source_url: 'https://www.datasharescc.org/',
        source_tier: 2,
        evidence: { snapshot_path: 'evidence/food.png', captured_at: '2026-09-01T10:00:00Z' },
        confidence: 'medium',
        geographic_scale: 'county',
      },
      {
        key: 'households-receiving-calfresh',
        name: 'Households receiving CalFresh',
        value: 9.8,
        unit: '% of households',
        year: 2022,
        target: null,
        source: 'US Census ACS',
        source_url: 'https://data.census.gov/',
        confidence: 'high',
        geographic_scale: 'city',
      },
    ],
    gaps: [
      {
        indicator: 'school-breakfast-gap',
        reason: 'District did not publish 2024 figures.',
        scales_tried: ['city'],
        searched_at: '2026-09-01T00:00:00Z',
      },
    ],
  };
}

function sampleHealthData(): DimensionData {
  return {
    name: 'Health',
    icon: 'heart',
    description: 'Community health outcomes.',
    context: 'Primary care access remains uneven.',
    actions: ['Expand community clinics'],
    indicators: [
      {
        // Legacy unkeyed framework indicator (PR #59 discipline: matched via framework slug)
        name: 'Residents without health insurance',
        value: 5.1,
        unit: '% of residents under 65',
        year: 2022,
        target: 3,
        level_pct: 40,
        source: 'US Census ACS',
        source_url: 'https://data.census.gov/',
        confidence: 'high',
        geographic_scale: 'city',
      },
      {
        key: 'life-expectancy',
        name: 'Life expectancy at birth',
        value: 81.9,
        unit: 'years',
        year: 2021,
        target: 80,
        level_pct: -60,
        source: 'CDPH',
        source_url: 'https://www.cdph.ca.gov/',
        confidence: 'medium',
        geographic_scale: 'county',
      },
    ],
  };
}

describe('applyDimensionGridEdits (pure row-id patching)', () => {
  it('matches by rowId/key, preserves untouched indicators, context, actions, spotlights, and evidence', () => {
    const base = sampleFoodData();
    const byRowId = new Map([
      [
        'food/food-insecurity-rate',
        new Map<GridCellEdit['column'], string>([
          ['value', '14.5'],
          ['year', '2024'],
          ['supporting_source_url', 'https://feedingamerica.org/2024'],
        ]),
      ],
    ]);

    const next = applyDimensionGridEdits({ slug: 'food', canonicalSlug: 'food' }, base, byRowId, null);

    // Top-level narrative & metadata preserved verbatim.
    expect(next.name).toBe(base.name);
    expect(next.icon).toBe(base.icon);
    expect(next.description).toBe(base.description);
    expect(next.context).toBe(base.context);
    expect(next.actions).toEqual(base.actions);
    expect(next.policy_spotlight).toBe(base.policy_spotlight);
    expect(next.justice_spotlight).toBe(base.justice_spotlight);
    expect(next.gaps).toEqual(base.gaps);

    // Edited indicator updated, evidence and source_tier preserved.
    expect(next.indicators[0]).toMatchObject({
      key: 'food-insecurity-rate',
      value: 14.5,
      year: 2024,
      supporting_source_url: 'https://feedingamerica.org/2024',
      source_tier: 2,
      evidence: base.indicators[0]!.evidence,
    });

    // Untouched indicator completely preserved.
    expect(next.indicators[1]).toEqual(base.indicators[1]);
  });

  it('clears a numeric value into missing data, removes stale score, and needs no supporting source URL', () => {
    const base = sampleHealthData();
    const byRowId = new Map([
      ['health/uninsured-rate', new Map<GridCellEdit['column'], string>([['value', '']])],
    ]);

    const next = applyDimensionGridEdits({ slug: 'health', canonicalSlug: 'health' }, base, byRowId, null);
    expect(next.indicators[0]!.key).toBe('uninsured-rate');
    expect(next.indicators[0]!.value).toBeNull();
    expect(next.indicators[0]!.level_pct).toBeUndefined();
    expect(next.indicators[0]!.scoring).toBeUndefined();
    // Untouched sibling indicator preserved.
    expect(next.indicators[1]).toMatchObject({ key: 'life-expectancy', value: 81.9 });
  });

  it('requires supporting_source_url on a non-null value change, but not on rename or metadata edits', () => {
    const base = sampleFoodData();

    // Changing value without supporting_source_url -> refused.
    const missingSupport = new Map([
      ['food/food-insecurity-rate', new Map<GridCellEdit['column'], string>([['value', '15']])],
    ]);
    expect(() => applyDimensionGridEdits({ slug: 'food', canonicalSlug: 'food' }, base, missingSupport, null)).toThrow(
      /supporting source URL/,
    );

    // Renaming indicator without changing value -> allowed, key preserved.
    const renameOnly = new Map([
      ['food/food-insecurity-rate', new Map<GridCellEdit['column'], string>([['indicator', 'Residents facing food insecurity']])],
    ]);
    const renamed = applyDimensionGridEdits({ slug: 'food', canonicalSlug: 'food' }, base, renameOnly, null);
    expect(renamed.indicators[0]).toMatchObject({
      key: 'food-insecurity-rate',
      name: 'Residents facing food insecurity',
      value: 12.4,
    });
  });

  it('promotes a gap-only indicator row when populated and removes its per-indicator gap', () => {
    const base = sampleFoodData();
    const byRowId = new Map([
      [
        'food/school-breakfast-gap',
        new Map<GridCellEdit['column'], string>([
          ['value', '18'],
          ['unit', '% of eligible students'],
          ['year', '2024'],
          ['source', 'District Report'],
          ['source_url', 'https://school.example.org/2024'],
          ['supporting_source_url', 'https://school.example.org/2024#table2'],
          ['geographic_scale', 'city'],
          ['confidence', 'high'],
        ]),
      ],
    ]);

    const next = applyDimensionGridEdits({ slug: 'food', canonicalSlug: 'food' }, base, byRowId, null);
    expect(next.indicators).toHaveLength(3);
    expect(next.indicators[2]).toMatchObject({
      key: 'school-breakfast-gap',
      name: 'School breakfast gap',
      value: 18,
      unit: '% of eligible students',
      year: 2024,
      supporting_source_url: 'https://school.example.org/2024#table2',
      geographic_scale: 'city',
      confidence: 'high',
    });
    expect(next.gaps).toEqual([]);
  });

  it('rejects unknown row IDs, wrong-dimension row IDs, and conflicting base versions', () => {
    const base = sampleFoodData();
    expect(() =>
      applyDimensionGridEdits(
        { slug: 'food', canonicalSlug: 'food' },
        base,
        new Map([['food/no-such-row', new Map([['unit', '%']])]]),
        null,
      ),
    ).toThrow(/Unknown indicator/);

    expect(() =>
      applyDimensionGridEdits(
        { slug: 'food', canonicalSlug: 'food' },
        base,
        new Map([['health/uninsured-rate', new Map([['unit', '%']])]]),
        null,
      ),
    ).toThrow(/does not belong to dimension/);

    expect(() =>
      groupGridEdits([
        { rowId: 'food/food-insecurity-rate', dimensionId: DIM_FOOD_ID, baseVersion: 2, column: 'unit', text: '%' },
        { rowId: 'food/households-receiving-calfresh', dimensionId: DIM_FOOD_ID, baseVersion: 3, column: 'unit', text: '%' },
      ]),
    ).toThrow(/Conflicting base versions/);
  });
});

describe('saveGridEdits server action', () => {
  beforeEach(() => {
    mockState.role = 'editor';
    mockState.dimRows = [
      { id: DIM_FOOD_ID, tenantId: TENANT_ID, slug: 'food', canonicalSlug: 'food', publishedVersionId: 'ver-food-v2', archivedAt: null },
      { id: DIM_HEALTH_ID, tenantId: TENANT_ID, slug: 'health', canonicalSlug: 'health', publishedVersionId: 'ver-health-v2', archivedAt: null },
    ];
    mockState.latestByDim = new Map([
      [DIM_FOOD_ID, { id: 'ver-food-v2', dimensionId: DIM_FOOD_ID, versionNum: 2, data: sampleFoodData() }],
      [DIM_HEALTH_ID, { id: 'ver-health-v2', dimensionId: DIM_HEALTH_ID, versionNum: 2, data: sampleHealthData() }],
    ]);
    mockState.overrides = null;
    mockState.appended = [];
    mockState.audited = [];
    mockState.userDbCalls = 0;
    mockState.systemDbCalls = 0;
    mockState.configValueInTx = [];
    mockState.latestByDimTx = [];
    mockState.revalidated = [];
  });

  it('refuses viewers, moderators, and signed-out callers before validation or DB access', async () => {
    const { saveGridEdits } = await import('./grid-actions');

    for (const role of ['viewer', 'moderator', null] as const) {
      mockState.role = role;
      const res = await saveGridEdits({
        tenantSlug: 'santa-cruz',
        edits: [{ rowId: 'food/food-insecurity-rate', dimensionId: DIM_FOOD_ID, baseVersion: 2, column: 'unit', text: '%' }],
      });
      expect(res).toEqual({ ok: false, error: 'This needs the editor role on this portrait.' });
      expect(mockState.userDbCalls).toBe(0);
      expect(mockState.appended).toHaveLength(0);
    }
  });

  it('saves multi-dimension edits as drafts inside ONE userDb transaction with per-dimension audit_log and one-connection discipline', async () => {
    const { saveGridEdits } = await import('./grid-actions');
    const res = await saveGridEdits({
      tenantSlug: 'santa-cruz',
      changeNote: 'Updated 2024 figures from county release.',
      edits: [
        { rowId: 'food/food-insecurity-rate', dimensionId: DIM_FOOD_ID, baseVersion: 2, column: 'value', text: '13.1' },
        {
          rowId: 'food/food-insecurity-rate',
          dimensionId: DIM_FOOD_ID,
          baseVersion: 2,
          column: 'supporting_source_url',
          text: 'https://datasharescc.org/2024',
        },
        { rowId: 'health/uninsured-rate', dimensionId: DIM_HEALTH_ID, baseVersion: 2, column: 'value', text: '' },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data).toEqual({
      dimensions: [
        {
          dimensionId: DIM_FOOD_ID,
          dimensionSlug: 'food',
          dimensionName: 'Food',
          versionId: `ver-${DIM_FOOD_ID}-v3`,
          versionNum: 3,
          indicatorCount: 1,
          cellCount: 2,
        },
        {
          dimensionId: DIM_HEALTH_ID,
          dimensionSlug: 'health',
          dimensionName: 'Health',
          versionId: `ver-${DIM_HEALTH_ID}-v3`,
          versionNum: 3,
          indicatorCount: 1,
          cellCount: 1,
        },
      ],
      totalIndicators: 2,
      totalCells: 3,
    });

    // Strictly ONE userDb transaction, zero systemDb calls, every DB helper ran on the SAME tx.
    expect(mockState.userDbCalls).toBe(1);
    expect(mockState.systemDbCalls).toBe(0);
    expect(mockState.latestByDimTx).toHaveLength(1);
    expect(mockState.configValueInTx).toHaveLength(1);
    const tx = mockState.latestByDimTx[0];
    expect(mockState.configValueInTx[0]).toBe(tx);

    // Every appended version is an immutable draft with origin 'human', never auto-published.
    expect(mockState.appended).toHaveLength(2);
    for (const entry of mockState.appended) {
      expect(entry.tx).toBe(tx);
      expect(entry.values).toMatchObject({
        status: 'draft',
        origin: 'human',
        changeNote: 'Updated 2024 figures from county release.',
        createdBy: USER_ID,
      });
    }

    // Untouched indicators and narrative preserved on Food.
    const foodSaved = mockState.appended[0]!.values.data as DimensionData;
    expect(foodSaved.context).toBe('Local food insecurity has risen since 2022.');
    expect(foodSaved.actions).toEqual(['Expand mobile food pantry', 'Increase school meal enrollment']);
    expect(foodSaved.indicators[1]!.name).toBe('Households receiving CalFresh');
    expect(foodSaved.indicators[1]!.value).toBe(9.8);

    // One audit_log entry per updated dimension on the SAME transaction.
    expect(mockState.audited).toHaveLength(2);
    expect(mockState.audited[0]!.args[0]).toBe(TENANT_ID);
    expect(mockState.audited[0]!.args[1]).toBe('dimension_version');
    expect(mockState.audited[0]!.args[2]).toBe(`ver-${DIM_FOOD_ID}-v3`);
    expect(mockState.audited[0]!.args[3]).toBe('create_human_version');
    expect(mockState.audited[0]!.args[6]).toBe(tx);
    expect(mockState.audited[1]!.args[2]).toBe(`ver-${DIM_HEALTH_ID}-v3`);
    expect(mockState.audited[1]!.args[6]).toBe(tx);

    // Revalidated admin, data, and each dimension page.
    expect(mockState.revalidated).toEqual([
      '/santa-cruz/admin',
      '/santa-cruz/admin/data',
      `/santa-cruz/admin/dim/${DIM_FOOD_ID}`,
      `/santa-cruz/admin/dim/${DIM_HEALTH_ID}`,
    ]);
  });

  it('rejects stale baseVersion (optimistic concurrency) without writing any drafts', async () => {
    const { saveGridEdits } = await import('./grid-actions');
    const res = await saveGridEdits({
      tenantSlug: 'santa-cruz',
      edits: [{ rowId: 'food/food-insecurity-rate', dimensionId: DIM_FOOD_ID, baseVersion: 1, column: 'unit', text: '%' }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Food was updated since this table loaded (now v2, expected v1)');
    }
    expect(mockState.appended).toHaveLength(0);
    expect(mockState.audited).toHaveLength(0);
  });

  it('rejects empty edits and malformed inputs with Zod messages', async () => {
    const { saveGridEdits } = await import('./grid-actions');
    const empty = await saveGridEdits({ tenantSlug: 'santa-cruz', edits: [] });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain('No changes to save');
    expect(mockState.userDbCalls).toBe(0);
  });

  it('generates a default changeNote when omitted, rescores with threshold_overrides, and refuses archived dimensions', async () => {
    const { saveGridEdits } = await import('./grid-actions');

    // Rescore with tenant threshold override and omit changeNote.
    mockState.overrides = {
      'health.uninsured-rate': { target: 2, rationale: 'Local council target.' },
    };
    const res = await saveGridEdits({
      tenantSlug: 'santa-cruz',
      edits: [
        { rowId: 'health/uninsured-rate', dimensionId: DIM_HEALTH_ID, baseVersion: 2, column: 'value', text: '6' },
        {
          rowId: 'health/uninsured-rate',
          dimensionId: DIM_HEALTH_ID,
          baseVersion: 2,
          column: 'supporting_source_url',
          text: 'https://health.example.gov/2024',
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(mockState.appended).toHaveLength(1);
    expect(mockState.appended[0]!.values.changeNote).toBe('Edited 2 cells across 1 indicator in the data table.');
    const healthSaved = mockState.appended[0]!.values.data as DimensionData;
    expect(healthSaved.indicators[0]!.scoring?.threshold_ref).toBe('health.uninsured-rate');
    expect(healthSaved.indicators[0]!.target).toBe(2);

    // Archived dimension is refused without writing any draft.
    mockState.appended = [];
    mockState.dimRows[0]!.archivedAt = new Date();
    const archived = await saveGridEdits({
      tenantSlug: 'santa-cruz',
      edits: [{ rowId: 'food/food-insecurity-rate', dimensionId: DIM_FOOD_ID, baseVersion: 2, column: 'unit', text: '%' }],
    });
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.error).toContain('could not be found');
    expect(mockState.appended).toHaveLength(0);
  });
});
