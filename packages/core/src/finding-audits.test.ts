import { describe, expect, it } from 'vitest';
import { auditDecision, findingAuditResultSchema, findingCorrectionSchema } from './finding-audits.js';

describe('machine recommendations remain bounded review inputs', () => {
  it('refuses source/archive/identity/scoring replacement and empty patches', () => {
    for (const patch of [{}, { source_url: 'https://example.org' }, { evidence: {} }, { indicator_slug: 'different' }, { level_pct: 0 }]) {
      expect(findingCorrectionSchema.safeParse(patch).success).toBe(false);
    }
    expect(findingCorrectionSchema.parse({ value: 12, year: 2024 })).toEqual({ value: 12, year: 2024 });
  });
  it('requires corrections exactly for edit recommendations', () => {
    expect(findingAuditResultSchema.safeParse({ disposition: 'edit', reason: 'Rounding.' }).success).toBe(false);
    expect(findingAuditResultSchema.safeParse({ disposition: 'approve', reason: 'Supported.', correction: { value: 12 } }).success).toBe(false);
    expect(findingAuditResultSchema.safeParse({ disposition: 'edit', reason: 'The source says 12.', correction: { value: 12 } }).success).toBe(true);
  });
  it('never lets an approval erase another independent caution', () => {
    expect(auditDecision([{ disposition: 'approve', reason: 'Official.' }, { disposition: 're_research', reason: 'Wrong period.' }])?.disposition).toBe('re_research');
    expect(auditDecision([{ disposition: 'reject', reason: 'Wrong construct.' }, { disposition: 'edit', reason: 'Rounding.', correction: { value: 10 } }])?.disposition).toBe('re_research');
    expect(auditDecision([{ disposition: 'edit', reason: 'A', correction: { value: 10 } }, { disposition: 'edit', reason: 'B', correction: { value: 11 } }])?.disposition).toBe('re_research');
    expect(auditDecision([])).toBeNull();
  });
});
