import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import { valueAppearsInText, valueOnPage } from './page-text.js';
import { checkValueOnPage, deterministicChecks, isFlagged, mergeVerification } from './verify.js';

describe('valueAppearsInText', () => {
  it('finds a percentage written out in words', () => {
    expect(valueAppearsInText('12.3%', 'In 2023, 12.3 percent of households were cost-burdened.')).toBe(true);
    expect(valueAppearsInText('12.3%', 'Share: 12.3 per cent')).toBe(true);
    expect(valueAppearsInText(12.3, 'Share: 12.3%')).toBe(true);
    expect(valueAppearsInText('12.3 percent', 'Share: 12.3%')).toBe(true);
  });

  it('does not find a number inside a longer one', () => {
    expect(valueAppearsInText(12, 'Report published in 2012.')).toBe(false);
    expect(valueAppearsInText(12, 'Rate: 12.5 per 1,000')).toBe(false);
    expect(valueAppearsInText(12, 'See table 3.12')).toBe(false);
    expect(valueAppearsInText(200, 'Population 1,200,000')).toBe(false);
    expect(valueAppearsInText(12, 'Version 1.12.4')).toBe(false);
  });

  it('finds a whole number at the end of a sentence and beside punctuation', () => {
    expect(valueAppearsInText(12, 'The rate was 12.')).toBe(true);
    expect(valueAppearsInText(12, '(12)')).toBe(true);
    expect(valueAppearsInText(2012, 'Report published in 2012.')).toBe(true);
  });

  it('reads trailing zeros, thousands separators and narrow spaces as the same figure', () => {
    expect(valueAppearsInText(42.7, 'Rent burden: 42.70%')).toBe(true);
    expect(valueAppearsInText(45000, 'Median income was $45,000 last year')).toBe(true);
    expect(valueAppearsInText('$45,000', 'Median income was 45000 dollars')).toBe(true);
    expect(valueAppearsInText(45000, 'Revenu médian : 45 000 €')).toBe(true);
    expect(valueAppearsInText(0.5, 'A ratio of .5 to one')).toBe(true);
    expect(valueAppearsInText('.5', 'A ratio of 0.50 to one')).toBe(true);
  });

  it('reads scale words and letters', () => {
    expect(valueAppearsInText(1_200_000, 'About 1.2 million people')).toBe(true);
    expect(valueAppearsInText(1_200_000, 'About 1.2 Million people')).toBe(true);
    expect(valueAppearsInText(1_200_000, 'A budget of $1.2M')).toBe(true);
    expect(valueAppearsInText(3_000_000_000, 'Spending of $3bn')).toBe(true);
    expect(valueAppearsInText(45_000, 'Wages near 45K a year')).toBe(true);
    expect(valueAppearsInText('1.2 million', 'Population 1,200,000')).toBe(true);
    expect(valueAppearsInText('1.2 million', 'Population: 1.2 (millions)')).toBe(true);
    expect(valueAppearsInText('45K', 'Households (thousands), 2024: 45')).toBe(true);
    expect(valueAppearsInText(1.2, 'About 1.2 million people')).toBe(true);
  });

  it('does not find a scaled claim as a bare figure the page gives no scale for', () => {
    expect(valueAppearsInText('1.2 million', 'The population grew 1.2% last year.')).toBe(false);
    expect(valueAppearsInText('45K', 'See Table 45 for the county figures.')).toBe(false);
    expect(valueAppearsInText('1.2 million', 'Up 1.2 percent, to a record in millions of trips.')).toBe(false);
    expect(valueAppearsInText('1.2 million', `Revenue (millions).${' Other words.'.repeat(40)} Growth 1.2`)).toBe(false);
  });

  it('reads an approximate sign as part of a number', () => {
    expect(valueAppearsInText('~12%', 'Roughly 12 percent of adults')).toBe(true);
    expect(valueAppearsInText('≈ 12%', 'Roughly 12 percent of adults')).toBe(true);
  });

  it('looks for a value with unit words as that phrase, its numbers and dashes written either way', () => {
    expect(valueAppearsInText('12.3 per 1,000', 'A rate of 12.3 per 1000 residents')).toBe(true);
    expect(valueAppearsInText('12.3 per 1000', 'A rate of 12.3 per 1,000 residents')).toBe(true);
    expect(valueAppearsInText('12.3 per 1,000', 'A rate of 12.3 per 10,000 residents')).toBe(false);
    expect(valueAppearsInText('50–60%', 'Between 50-60 percent of renters')).toBe(true);
    expect(valueAppearsInText('50-60%', 'Between 50 – 60% of renters')).toBe(true);
    expect(valueAppearsInText('50–60%', 'Between 50–65% of renters')).toBe(false);
  });

  it('does not read a comma decimal as the same figure, so the reviewer checks it', () => {
    expect(valueAppearsInText(12.3, 'Taux : 12,3 %')).toBe(false);
  });

  it('ignores the sign, as a page may write a fall without a minus', () => {
    expect(valueAppearsInText(-3.2, 'Emissions fell 3.2% since 2019')).toBe(true);
    expect(valueAppearsInText('−3.2%', 'Emissions fell 3.2% since 2019')).toBe(true);
  });

  it('does not find a different figure', () => {
    expect(valueAppearsInText(42.7, 'Rent burden: 42.6%')).toBe(false);
    expect(valueAppearsInText(42.7, 'Rent burden: 42%')).toBe(false);
    expect(valueAppearsInText(42, 'Rent burden: 42.7%')).toBe(false);
  });

  it('looks for a value written in words as that phrase, ignoring case and spacing', () => {
    expect(valueAppearsInText('1 in 5', 'About 1  in\n5 adults')).toBe(true);
    expect(valueAppearsInText('Yes', 'Does the city have a plan? YES.')).toBe(true);
    expect(valueAppearsInText('Yes', 'Yesterday the council met.')).toBe(false);
    expect(valueAppearsInText('1 in 5', 'About 1 in 50 adults')).toBe(false);
    expect(valueAppearsInText('   ', 'Anything')).toBe(false);
  });
});

describe('valueOnPage', () => {
  it('answers found, not found, or no text', () => {
    expect(valueOnPage('12.3%', '12.3 percent')).toBe('found');
    expect(valueOnPage(12, 'published 2012')).toBe('not_found');
    expect(valueOnPage(12, '')).toBe('no_text');
    expect(valueOnPage(12, ' \n\t ')).toBe('no_text');
    expect(valueOnPage(12, null)).toBe('no_text');
    expect(valueOnPage(12, undefined)).toBe('no_text');
  });
});

describe('the value and link checks on a finding', () => {
  const config = defaultPortraitConfig('Anytown', 'The Anytown city limits');
  const finding = (over: Record<string, unknown> = {}) => ({
    kind: 'indicator',
    indicator_slug: 'cost-burdened-renters',
    name: 'Cost-burdened renters',
    value: '12.3%',
    unit: '% of renter households',
    year: new Date().getUTCFullYear() - 1,
    target: 30,
    level_pct: 40,
    scoring: { threshold_ref: 'housing.cost-burdened-renters', function: 'lower_is_better', inputs: { value: 12.3 }, worked_math: 'w' },
    source: 'Anytown Housing Report',
    source_url: 'https://www.anytown.gov/housing/report.pdf',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/a1.png', text_path: 'evidence/a1.txt', captured_at: '2026-11-20T00:00:00Z' },
    confidence: 'high',
    geographic_scale: 'city',
    ...over,
  });
  const resolves = async () => true;

  it('records whether the cited link is a home or section page', async () => {
    const document = await deterministicChecks(finding(), config, 'housing', resolves);
    expect(document.checks.home_page_link).toBe(false);
    for (const url of ['https://www.epa.gov/', 'https://www.epa.gov/water']) {
      const { checks } = await deterministicChecks(finding({ source_url: url }), config, 'housing', resolves);
      expect(checks.home_page_link).toBe(true);
      expect(isFlagged(mergeVerification(checks, { content_supported: 'pass' }))).toBe(true);
    }
    const { checks } = await deterministicChecks(finding({ source_url: 'https://www.epa.gov/water/report.pdf' }), config, 'housing', resolves);
    expect(checks.home_page_link).toBe(false);
  });

  it('reads the stored text and looks for the value in it', async () => {
    const { payload } = await deterministicChecks(finding(), config, 'housing', resolves);
    const read = vi.fn(async () => 'In 2025, 12.3 percent of renter households paid more than half.');
    expect(await checkValueOnPage(payload!, read)).toBe('found');
    expect(read).toHaveBeenCalledWith('evidence/a1.txt');
    expect(await checkValueOnPage(payload!, async () => 'Published 2012. No figures.')).toBe('not_found');
  });

  it('flags a value that is not on the page, even when every other check passed', async () => {
    const { payload, checks } = await deterministicChecks(finding(), config, 'housing', resolves);
    const value_on_page = await checkValueOnPage(payload!, async () => 'Nothing to see.');
    const verification = mergeVerification({ ...checks, value_on_page }, { content_supported: 'pass' });
    expect(verification.value_on_page).toBe('not_found');
    expect(isFlagged(verification)).toBe(true);
    const found = mergeVerification({ ...checks, value_on_page: 'found' }, { content_supported: 'pass' });
    expect(isFlagged(found)).toBe(false);
  });

  it('answers no_text, and does not flag for it, when there is no text to look in', async () => {
    const noTextPath = await deterministicChecks(
      finding({ evidence: { snapshot_path: 'evidence/a1.png', no_readable_text: true, captured_at: '2026-11-20T00:00:00Z' } }),
      config,
      'housing',
      resolves,
    );
    const read = vi.fn(async () => 'unused');
    expect(await checkValueOnPage(noTextPath.payload!, read)).toBe('no_text');
    expect(read).not.toHaveBeenCalled();
    const { payload, checks } = await deterministicChecks(finding(), config, 'housing', resolves);
    expect(await checkValueOnPage(payload!, async () => { throw new Error('object missing'); })).toBe('no_text');
    expect(await checkValueOnPage(payload!, async () => '   ')).toBe('no_text');
    expect(isFlagged(mergeVerification({ ...checks, value_on_page: 'no_text' }, { content_supported: 'pass' }))).toBe(false);
  });

  it('gives a gap neither check', async () => {
    const gap = { kind: 'gap', indicator_slug: 'eviction-rate', reason: 'No city series.', scales_tried: ['city'], searched_at: '2026-11-20T00:00:00Z' };
    const { payload, checks } = await deterministicChecks(gap, config, 'housing', resolves);
    expect(checks.home_page_link).toBeUndefined();
    expect(await checkValueOnPage(payload!, async () => 'x')).toBeUndefined();
  });
});
