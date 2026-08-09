import { describe, expect, it } from 'vitest';
import { reviewReasons } from '@deep-fryer/contract';
import {
  reviewReasonCodeSchema,
  type CurrentDisposition,
  type FindingPayload,
  type FindingVerification,
} from '@deep-fryer/core';
import {
  computeGateReport,
  contentHash,
  gateExitCode,
  sampleIds,
  type GateFindingRow,
  type GateInput,
} from './gate.js';

function indicator(overrides: Partial<Extract<FindingPayload, { kind: 'indicator' }>> = {}) {
  return {
    kind: 'indicator' as const,
    indicator_slug: 'rent-burden',
    name: 'Rent burden',
    value: 12.4,
    unit: '%',
    year: 2024,
    target: 5,
    level_pct: 148,
    scoring: {
      threshold_ref: 'housing.rent',
      function: 'lower_is_better' as const,
      inputs: { value: 12.4, target: 5, scale: 5 },
      worked_math: 'x',
    },
    source: 'ACS',
    source_url: 'https://example.gov/acs',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/abc.png', captured_at: '2026-01-01T00:00:00Z' },
    confidence: 'high' as const,
    geographic_scale: 'city' as const,
    ...overrides,
  };
}

function verification(overrides: Partial<FindingVerification> = {}): FindingVerification {
  return {
    url_ok: true,
    schema_ok: true,
    recency_ok: true,
    scale_ok: true,
    content_supported: 'pass',
    ...overrides,
  };
}

let seq = 0;
function row(
  overrides: Partial<GateFindingRow> & { dimensionId?: string } = {},
): GateFindingRow {
  seq += 1;
  return {
    id: `f-${String(seq).padStart(3, '0')}`,
    sessionId: 's-1',
    dimensionId: 'd-1',
    indicatorSlug: 'rent-burden',
    payload: indicator(),
    verification: verification(),
    ...overrides,
  };
}

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    run: { id: 'run-1', createdAt: new Date('2026-08-01T00:00:00Z'), tenantSlug: 'santacruz' },
    findings: [],
    sessions: [{ id: 's-1', dimensionId: 'd-1', kind: 'dimension' }],
    dimensionSlugById: new Map([
      ['d-1', 'housing'],
      ['d-2', 'water'],
    ]),
    versionsForRun: [],
    auditRowsAfterRun: [],
    ...overrides,
  };
}

/** A dimension that is dispositioned via a materialized version. */
function reviewed(overrides: Partial<GateInput> = {}): Partial<GateInput> {
  return { versionsForRun: [{ dimensionId: 'd-1' }], ...overrides };
}

describe('contentHash', () => {
  it('matches the pinned golden digest — byte compatibility with recorded approvals', () => {
    // Any change to wrapper key order, sorting, or stringification strands
    // every approval recorded in audit_log as stale. This digest is the tripwire.
    const rows = [
      {
        id: 'f2-gap',
        payload: { kind: 'gap', indicator_slug: 'water-gap', reason: 'none found' },
        verification: null,
      },
      {
        id: 'f1-ind',
        payload: { kind: 'indicator', indicator_slug: 'rent-burden', value: 12.4 },
        verification: {
          url_ok: true,
          schema_ok: true,
          recency_ok: true,
          scale_ok: true,
          content_supported: 'pass',
        },
      },
    ] as unknown as GateFindingRow[];
    expect(contentHash(rows)).toBe(
      '7c01cf57997f0c93def068331d8911313845d3c98fc3c77382f85cd47422edd0',
    );
    // Order-insensitive: the sort inside the hash normalizes input order.
    expect(contentHash([...rows].reverse())).toBe(contentHash(rows));
  });
});

describe('sampleIds', () => {
  it('is deterministic per run and changes with the run id', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const s1 = sampleIds(ids, 'run-1', 3);
    expect(sampleIds([...ids].reverse(), 'run-1', 3)).toEqual(s1);
    expect(s1).toHaveLength(3);
    expect(sampleIds(ids, 'run-2', 3)).not.toEqual(s1);
  });
});

describe('computeGateReport stages', () => {
  it('passes clean and demands confirmation when review is complete', () => {
    const report = computeGateReport(input({ findings: [row()], ...reviewed() }));
    expect(report.violations.map((v) => v.stage)).toEqual(['confirmation']);
    expect(report.approval.state).toBe('none');
    expect(gateExitCode(report)).toBe(2);
  });

  it('flags empty dimension sessions and missing verification as critical', () => {
    const report = computeGateReport(
      input({
        findings: [row({ verification: null })],
        sessions: [
          { id: 's-1', dimensionId: 'd-1', kind: 'dimension' },
          { id: 's-2', dimensionId: 'd-2', kind: 'dimension' },
        ],
      }),
    );
    const messages = report.violations.map((v) => v.message).join('\n');
    expect(messages).toContain('produced no findings');
    expect(messages).toContain('no verification record');
    expect(report.hasCritical).toBe(true);
  });

  it('treats missing evidence as critical and broken URLs as warnings', () => {
    const report = computeGateReport(
      input({
        findings: [
          row({
            payload: indicator({ evidence: undefined as never }),
            verification: verification({ url_ok: false }),
          }),
        ],
        ...reviewed(),
      }),
    );
    const critical = report.violations.filter((v) => v.severity === 'critical');
    expect(critical.some((v) => v.message.includes('evidence-archived-at-access'))).toBe(true);
    expect(
      report.violations.some(
        (v) => v.severity === 'warning' && v.message.includes('snapshot is the surviving record'),
      ),
    ).toBe(true);
  });

  it('holds the 5% unsupported bar: 1/20 fails → critical, 1/21 → warning', () => {
    const make = (total: number) =>
      computeGateReport(
        input({
          findings: [
            row({ verification: verification({ content_supported: 'fail' }) }),
            ...Array.from({ length: total - 1 }, () => row()),
          ],
          ...reviewed(),
        }),
      );
    // 1/20 = 5.0% — not above the bar; individual-disposition warning instead.
    expect(
      make(20).violations.some(
        (v) => v.stage === 'verifier' && v.severity === 'warning' && v.message.includes('contradicted'),
      ),
    ).toBe(true);
    // 1/19 ≈ 5.3% — over the bar.
    expect(
      make(19).violations.some(
        (v) => v.stage === 'verifier' && v.severity === 'critical' && v.message.includes('exceeds 5%'),
      ),
    ).toBe(true);
  });

  it('warns on uncertain > 25%, tier-1/2 share < 50%, and every tier-4 source', () => {
    const report = computeGateReport(
      input({
        findings: [
          row({ verification: verification({ content_supported: 'uncertain' }) }),
          row({ payload: indicator({ source_tier: 4 }) }),
          row({ payload: indicator({ source_tier: 5 }) }),
        ],
        ...reviewed(),
      }),
    );
    const warnings = report.violations.filter((v) => v.severity === 'warning');
    expect(warnings.some((v) => v.message.includes('uncertain'))).toBe(true);
    expect(warnings.some((v) => v.message.includes('below 50%'))).toBe(true);
    expect(warnings.filter((v) => v.message.includes('rests on a tier-'))).toHaveLength(2);
  });

  it('requires a disposition per dimension: versions or flag_gap/human audit rows satisfy it', () => {
    const base = input({ findings: [row()] });
    expect(
      computeGateReport(base).violations.some(
        (v) => v.stage === 'review' && v.message.includes('awaiting disposition'),
      ),
    ).toBe(true);
    expect(
      computeGateReport({
        ...base,
        auditRowsAfterRun: [
          { action: 'flag_gap', entityId: 'x', after: { dimension: 'housing' } },
        ],
      }).violations.some((v) => v.stage === 'review'),
    ).toBe(false);
  });

  it('enforces per-finding dispositions when disposition state is provided', () => {
    const flagged = row({ verification: verification({ content_supported: 'fail' }) });
    const clean = row();
    const base = input({ findings: [flagged, clean], ...reviewed() });

    // Flagged finding with no disposition → critical.
    const undisposed = computeGateReport({ ...base, dispositions: [] });
    expect(
      undisposed.violations.some(
        (v) =>
          v.stage === 'review' &&
          v.severity === 'critical' &&
          v.findingId === flagged.id &&
          v.message.includes('review-disposes-each-flag'),
      ),
    ).toBe(true);

    // The spot-check sample (the passing finding) must be verified too.
    expect(
      undisposed.violations.some(
        (v) => v.findingId === clean.id && v.message.includes('spot-check'),
      ),
    ).toBe(true);

    // needs_rework blocks even when everything is dispositioned.
    const rework: CurrentDisposition[] = [
      { findingId: flagged.id, state: 'needs_rework', reviewerLabel: 'r', at: new Date() },
      { findingId: clean.id, state: 'verified', reviewerLabel: 'r', at: new Date() },
    ];
    expect(
      computeGateReport({ ...base, dispositions: rework }).violations.some((v) =>
        v.message.includes('needs-rework'),
      ),
    ).toBe(true);

    // Fully dispositioned → only confirmation remains. The flag here is a
    // schema failure (content pass) so the verifier stage stays quiet and
    // the review stage is isolated.
    const schemaFlagged = row({ verification: verification({ schema_ok: false }) });
    const done: CurrentDisposition[] = [
      { findingId: schemaFlagged.id, state: 'rejected', reviewerLabel: 'r', at: new Date() },
      { findingId: clean.id, state: 'verified', reviewerLabel: 'r', at: new Date() },
    ];
    const green = computeGateReport({
      ...input({ findings: [schemaFlagged, clean], ...reviewed() }),
      dispositions: done,
    });
    expect(green.violations.filter((v) => v.stage !== 'confirmation')).toHaveLength(0);
  });

  it('binds approval to the content hash: current vs stale', () => {
    const f = row();
    const base = input({ findings: [f], ...reviewed() });
    const { hash } = computeGateReport(base);

    const approved = computeGateReport({
      ...base,
      auditRowsAfterRun: [
        {
          action: 'research_verify.approve',
          entityId: 'run-1',
          after: { content_hash: hash, approved_by: 'joe' },
        },
      ],
    });
    expect(approved.approval.state).toBe('current');
    expect(approved.approval.approvedBy).toBe('joe');
    expect(approved.violations).toHaveLength(0);
    expect(gateExitCode(approved)).toBe(0);

    const stale = computeGateReport({
      ...base,
      auditRowsAfterRun: [
        {
          action: 'research_verify.approve',
          entityId: 'run-1',
          after: { content_hash: 'deadbeef', approved_by: 'joe' },
        },
      ],
    });
    expect(stale.approval.state).toBe('stale');
    expect(stale.violations.some((v) => v.message.includes('STALE'))).toBe(true);
  });
});

describe('review-reasons vocabulary', () => {
  it('contract JSON and the core type enum carry the same codes', () => {
    const contractCodes = reviewReasons.reasons.map((r) => r.code).sort();
    const coreCodes = [...reviewReasonCodeSchema.options].sort();
    expect(contractCodes).toEqual(coreCodes);
  });
});
