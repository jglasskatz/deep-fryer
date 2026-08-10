import { describe, expect, it } from 'vitest';
import { excerptAround, normalizeForMatch, quoteSupported, stripHtml } from './text.js';
import { findingPayloadSchema } from './validators.js';

describe('normalizeForMatch', () => {
  it('normalizes typography so rendered text matches extracted text', () => {
    expect(normalizeForMatch('“Rent burden” is 54 percent — up from 2019')).toBe(
      '"rent burden" is 54 percent - up from 2019',
    );
    expect(normalizeForMatch('It’s  spread\nacross   lines')).toBe("it's spread across lines");
    // NFKC folds width/compatibility forms.
    expect(normalizeForMatch('ﬁgure ５４')).toBe(normalizeForMatch('figure 54'));
  });
});

describe('quoteSupported', () => {
  const text = 'In 2024, the median renter household spent 54.3% of income on rent — the highest share recorded.';
  it('matches despite typography differences', () => {
    expect(quoteSupported('the median renter household spent 54.3% of income', text)).toBe(true);
    expect(quoteSupported('The  median renter household spent 54.3% of income', text)).toBe(true);
  });
  it('rejects absent or paraphrased passages', () => {
    expect(quoteSupported('renters spent about half their income', text)).toBe(false);
  });
  it('rejects too-short quotes — they attest nothing', () => {
    expect(quoteSupported('54.3%', text)).toBe(false);
  });
});

describe('excerptAround', () => {
  it('returns verbatim slices around the normalized match', () => {
    const text = 'Before context here. The “median” renter spent 54.3% of income. After context here.';
    const ex = excerptAround(text, 'the "median" renter spent 54.3% of income', 10);
    expect(ex).not.toBeNull();
    expect(ex!.match).toBe('The “median” renter spent 54.3% of income');
    expect(ex!.before.endsWith('here. ')).toBe(true);
    expect(ex!.after.startsWith('.')).toBe(true);
  });
  it('returns null when the quote is not present', () => {
    expect(excerptAround('some text entirely', 'a passage that is missing here')).toBeNull();
  });
});

describe('stripHtml', () => {
  it('drops scripts/styles, keeps content, decodes entities', () => {
    const html =
      '<html><head><title>T</title><style>.x{}</style></head><body><script>var x=1;</script><h1>Rent &amp; housing</h1><p>54.3% of income</p></body></html>';
    const text = stripHtml(html);
    expect(text).toContain('Rent & housing');
    expect(text).toContain('54.3% of income');
    expect(text).not.toContain('var x=1');
    expect(text).not.toContain('.x{}');
  });
});

describe('evidence.quote round-trip', () => {
  it('survives the zod finding parse (the non-strict mirror must carry it)', () => {
    const payload = {
      kind: 'indicator',
      indicator_slug: 'rent-burden',
      name: 'Rent burden',
      value: 54.3,
      unit: '%',
      year: 2024,
      target: 30,
      level_pct: 81,
      scoring: {
        threshold_ref: 'housing.rent',
        function: 'lower_is_better',
        inputs: { value: 54.3, target: 30, scale: 30 },
        worked_math: 'x',
      },
      source: 'ACS',
      source_url: 'https://example.gov/acs',
      source_tier: 2,
      evidence: {
        snapshot_path: 'evidence/by-content/abc123def456.png',
        captured_at: '2026-08-01T00:00:00Z',
        quote: 'the median renter household spent 54.3% of income on rent',
      },
      confidence: 'high',
      geographic_scale: 'city',
    };
    const parsed = findingPayloadSchema.parse(payload);
    expect(
      parsed.kind === 'indicator' ? parsed.evidence.quote : undefined,
    ).toBe('the median renter household spent 54.3% of income on rent');
  });
});
