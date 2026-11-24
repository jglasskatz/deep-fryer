import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import {
  EgressBlockedError,
  assertPublicHttpsUrl,
  guardedFetch,
  withEgressBlocklist,
} from './egress.js';
import {
  CALIFORNIA_REPORT_BLOCKLIST,
  auditSourceLeaks,
  buildCaliforniaReportBlocklist,
  matchBlockedSource,
  renderBlocklistInstructions,
} from './source-blocklist.js';
import { deterministicChecks, isFreshRunCapture } from './verify.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('CALIFORNIA_REPORT_BLOCKLIST & matchBlockedSource', () => {
  const repoDerived = buildCaliforniaReportBlocklist(REPO_ROOT);

  it.each([
    'https://zenodo.org/records/17540639',
    'https://zenodo.org/record/17540639',
    'https://zenodo.org/records/17540639/files/California%20Doughnut%20Economics%20Report%202025.pdf?download=1',
    'https://doi.org/10.5281/zenodo.17540639',
    'https://docs.google.com/spreadsheets/d/1uDvJsNbIMJbEMhPio4KzxKuxeIAPaDr8HRmII_kk36w/edit',
    'https://caldec.org/',
    'https://www.caldec.org/report',
    'https://reports.californiadoughnut.org/2025.pdf',
    'https://github.com/jglasskatz/ca-doughnut',
    'https://raw.githubusercontent.com/jglasskatz/ca-doughnut/main/data/raw_social.csv',
    'https://doughnuteconomics.org/stories/california-doughnut-snapshot-and-report',
    'https://doughnuteconomics.org/tools-and-stories/caldec-2025',
    'https://jglasskatz.github.io/deep-fryer/california/',
    'https://github.com/jglasskatz/deep-fryer/blob/main/site/imports/california/doughnut.json',
  ])('blocks California 2025 answer-key URL: %s', (url) => {
    const m1 = matchBlockedSource(url, CALIFORNIA_REPORT_BLOCKLIST);
    expect(m1, url).not.toBeNull();
    expect(m1?.matched).toBe(true);

    const m2 = matchBlockedSource(url, repoDerived);
    expect(m2, url).not.toBeNull();
    expect(m2?.matched).toBe(true);
  });

  it.each([
    'https://data.census.gov/table?q=california+renter+cost+burden',
    'https://api.census.gov/data/2023/acs/acs1?get=B25070_001E&for=state:06',
    'https://files.hudexchange.info/reports/published/CoC_PopSub_State_CA_2024.pdf',
    'https://www.arb.ca.gov/adam/select8/sc8start.php',
    'https://ww2.arb.ca.gov/our-work/topics/air-quality',
    'https://www.ppic.org/interactive/californians-and-the-housing-crisis/',
    'https://www.cdph.ca.gov/Programs/CCDPHP/DCDIC/NEOPB/Pages/SNAPEdCountyProfileDashboard.aspx',
    'https://oehha.ca.gov/calenviroscreen',
    'https://enviro.epa.gov/triexplorer/tri_factsheet.factsheet_forstate?pstate=CA&pyear=2023',
    'https://zenodo.org/records/99999999',
    'https://doughnuteconomics.org/about-doughnut-economics',
  ])('allows legitimate primary California/federal source: %s', (url) => {
    expect(matchBlockedSource(url, CALIFORNIA_REPORT_BLOCKLIST), url).toBeNull();
    expect(matchBlockedSource(url, repoDerived), url).toBeNull();
  });
});

describe('egress blocklist enforcement (guardedFetch & assertPublicHttpsUrl)', () => {
  it('throws EgressBlockedError before touching DNS or the network when blocklist is passed directly', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    const fetchMock = vi.fn(async () => new Response('should-not-fetch', { status: 200 }));

    await expect(
      guardedFetch(
        'https://zenodo.org/records/17540639/files/California%20Doughnut%20Economics%20Report%202025.pdf?download=1',
        {},
        resolve,
        { blocklist: CALIFORNIA_REPORT_BLOCKLIST, fetch: fetchMock },
      ),
    ).rejects.toThrow(EgressBlockedError);

    await expect(
      guardedFetch(
        'https://caldec.org/report',
        {},
        resolve,
        { blocklist: CALIFORNIA_REPORT_BLOCKLIST, fetch: fetchMock },
      ),
    ).rejects.toThrow(/blocked benchmark answer-key source/);

    expect(resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces ambient withEgressBlocklist across guardedFetch, assertPublicHttpsUrl, and redirect hops', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://shortener.example/ca') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://zenodo.org/records/17540639' },
        });
      }
      return new Response('ok', { status: 200 });
    });

    await withEgressBlocklist(CALIFORNIA_REPORT_BLOCKLIST, async () => {
      await expect(
        assertPublicHttpsUrl('https://jglasskatz.github.io/deep-fryer/california/', resolve),
      ).rejects.toThrow(/blocked benchmark answer-key source/);

      // Redirect from an allowed URL into the blocked report must fail before fetching hop 2.
      await expect(
        guardedFetch('https://shortener.example/ca', {}, resolve, { fetch: fetchMock }),
      ).rejects.toThrow(/blocked benchmark answer-key source/);

      // Allowed primary source still passes.
      const res = await guardedFetch('https://www.arb.ca.gov/adam/select8/sc8start.php', {}, resolve, {
        fetch: fetchMock,
      });
      expect(res.status).toBe(200);
    });

    // Only shortener hop 1 and arb.ca.gov were ever fetched; blocked Zenodo hop 2 was never fetched.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prevents verify.ts fresh-capture short-circuit and fails url_ok on blocked sources', async () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const blockedUrl = 'https://zenodo.org/records/17540639';
    const allowedUrl = 'https://www.ppic.org/interactive/californians-and-the-housing-crisis/';

    expect(
      isFreshRunCapture(
        blockedUrl,
        { snapshot_path: 'evidence/abc12345.png', captured_at: now.toISOString() },
        { runStartedAt: now, blocklist: CALIFORNIA_REPORT_BLOCKLIST },
        now.getTime(),
      ),
    ).toBe(false);

    expect(
      isFreshRunCapture(
        allowedUrl,
        { snapshot_path: 'evidence/abc12345.png', captured_at: now.toISOString() },
        { runStartedAt: now, blocklist: CALIFORNIA_REPORT_BLOCKLIST },
        now.getTime(),
      ),
    ).toBe(true);

    const cfg = defaultPortraitConfig('State of California', 'California');
    cfg.scale_policy.default_accepted = ['state'];
    const result = await deterministicChecks(
      {
        kind: 'indicator',
        indicator_slug: 'housing-cost-burden',
        name: 'Housing Cost Burden',
        value: 55,
        unit: '%',
        year: 2024,
        target: 0,
        level_pct: 55,
        scoring: {
          threshold_ref: 'housing.cost-burdened-renters',
          function: 'lower_is_better',
          inputs: { value: 55, target: 0 },
          worked_math: '55% shortfall',
        },
        source: 'California Doughnut Report',
        source_url: blockedUrl,
        source_tier: 3,
        confidence: 'medium',
        geographic_scale: 'state',
        evidence: { snapshot_path: 'evidence/abc12345.png', captured_at: now.toISOString() },
      },
      cfg,
      'housing',
      undefined,
      { runStartedAt: now, blocklist: CALIFORNIA_REPORT_BLOCKLIST },
    );
    expect(result.checks.schema_ok).toBe(true);
    expect(result.checks.url_ok).toBe(false);
  });
});

describe('renderBlocklistInstructions & auditSourceLeaks', () => {
  it('ignores its own blocklist instructions while catching finding and tool-call leaks', () => {
    const instructions = renderBlocklistInstructions(CALIFORNIA_REPORT_BLOCKLIST);
    expect(instructions).toContain('STRICT BENCHMARK SOURCE ISOLATION');
    expect(instructions).toContain('caldec.org');

    // Clean run: user prompt carries the instructions, assistant uses only primary sources.
    const cleanTranscript = gzipSync(
      [
        JSON.stringify({ type: 'user', content: `Research California housing.\n\n${instructions}` }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'mcp__evidence__read_source',
                input: { url: 'https://www.ppic.org/interactive/californians-and-the-housing-crisis/' },
              },
              { type: 'text', text: 'Found California renter cost burden from PPIC and U.S. Census ACS.' },
            ],
          },
        }),
      ].join('\n'),
    );

    const cleanFindings = [
      {
        indicator_slug: 'housing-cost-burden',
        kind: 'indicator',
        value: 54.8,
        unit: '%',
        year: 2023,
        source_name: 'U.S. Census Bureau ACS 1-Year Estimates',
        source_url: 'https://data.census.gov/table/ACSDT1Y2023.B25070',
      },
    ];

    const cleanAudit = auditSourceLeaks(cleanFindings, cleanTranscript, CALIFORNIA_REPORT_BLOCKLIST);
    expect(cleanAudit.clean).toBe(true);
    expect(cleanAudit.leakCount).toBe(0);

    // Leaky run: tool call tried Zenodo PDF + finding cited ca-doughnut repo.
    const leakyTranscript = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'WebFetch',
              input: { url: 'https://zenodo.org/records/17540639' },
            },
          ],
        },
      }),
    ].join('\n');

    const leakyFindings = [
      {
        indicator_slug: 'particulate-matter',
        kind: 'indicator',
        value: 60,
        unit: '%',
        year: 2023,
        source_name: 'California Doughnut Economics Coalition',
        source_url: 'https://raw.githubusercontent.com/jglasskatz/ca-doughnut/main/data/raw_ecological.csv',
      },
    ];

    const leakyAudit = auditSourceLeaks(leakyFindings, leakyTranscript, CALIFORNIA_REPORT_BLOCKLIST);
    expect(leakyAudit.clean).toBe(false);
    expect(leakyAudit.findingLeaks.length).toBeGreaterThanOrEqual(1);
    expect(leakyAudit.toolCallLeaks.length).toBe(1);
    expect(leakyAudit.toolCallLeaks[0]?.toolName).toBe('WebFetch');
    expect(leakyAudit.leakedIndicatorSlugs).toEqual(['particulate-matter']);
  });
});
