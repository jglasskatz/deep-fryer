import React, { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { REVIEW_CAUSES, type FindingPayload, type IndicatorEvidence } from '@deep-fryer/core';
import type { RunExecution } from '@deep-fryer/db';
import { CausePicker } from './ReviewAudits';
import {
  emptyGapForm,
  FindingRow,
  GapForm,
  NO_ANSWER,
  gapChoices,
  gapSavedMessage,
  ReviewCard,
  reviewEditHref,
  submitGap,
  type GapFormState,
  type ReviewFinding,
} from './ReviewCard';

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);
// The card's buttons call server actions; rendering never does.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/review-actions', () => ({ approveFindings: vi.fn(), flagGap: vi.fn(), reResearchDimension: vi.fn() }));
vi.mock('@/lib/machine-audit-actions', () => ({ applyMachineAudits: vi.fn(), applyMachineApproved: vi.fn(), publishReviewed: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

const execution: RunExecution = { provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null };
const payload: FindingPayload = {
  kind: 'indicator', indicator_slug: 'rent', name: 'Rent burden', value: 42, unit: '% of households', year: 2024, target: 30,
  source: 'Official data', source_url: 'https://example.gov', source_tier: 1, confidence: 'high', geographic_scale: 'city',
  evidence: { snapshot_path: 'evidence/source.png', captured_at: '2026-10-23T00:00:00Z' },
  scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' }, level_pct: 40,
};
const gap: FindingPayload = { kind: 'gap', indicator_slug: 'water', reason: 'No city series.', scales_tried: ['city'], searched_at: '2026-11-01T00:00:00Z' };
const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({ id: 'f1', indicatorSlug: 'rent', payload, verification: null, audits: [], ...over });
const row = (f: ReviewFinding) => renderToStaticMarkup(createElement(FindingRow, { finding: f, evidenceBase: '/evidence' }));

describe('which provider and model produced a finding, in review', () => {
  it('names the model, the provider and the shared server', () => {
    const html = row(finding({ provenance: { execution, session: { model: 'claude-sonnet-5' } } }));
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
  });

  it('names the model that answered after a refusal', () => {
    const html = row(finding({
      provenance: {
        execution,
        session: {
          model: 'claude-sonnet-5',
          refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: 'cyber' }],
        },
      },
    }));
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
    expect(html).toContain('When claude-sonnet-5 declined part of the work, claude-opus-5 answered.');
  });

  it('says so on an older run that did not record its provider, and on a session with no usage', () => {
    expect(row(finding({ provenance: { execution: null, session: { model: 'claude-sonnet-5' } } })))
      .toContain('Researched with claude-sonnet-5; provider not recorded');
    expect(row(finding({ provenance: { execution, session: null } })))
      .toContain('Researched with a model that was not recorded on Anthropic, shared server');
    expect(row(finding())).toContain('provider not recorded');
  });

  it('names them on gap cards too', () => {
    const html = row(finding({ payload: gap, indicatorSlug: 'water', provenance: { execution, session: { model: 'claude-sonnet-5' } } }));
    expect(html).toContain('Data gap');
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
  });

  it('shows each finding’s own line on the dimension’s review card', () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, {
      tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', dimensionName: 'Housing', ring: 'social', approvedVersionNum: null,
      sessionId: 's1', canReadTranscript: false, evidenceBase: '/evidence',
      findings: [
        finding({ provenance: { execution, session: { model: 'claude-sonnet-5' } } }),
        finding({ id: 'f2', payload: gap, indicatorSlug: 'water', provenance: { execution, session: { model: 'claude-sonnet-5', refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: null }] } } }),
      ],
    }));
    expect(html.match(/Researched with claude-sonnet-5 on Anthropic, shared server/g)).toHaveLength(2);
    expect(html).toContain('claude-opus-5 answered');
  });
});

const BASE = '/files/tenant-anytown';

function capturedFinding(evidence: IndicatorEvidence, narrativeEvidence?: IndicatorEvidence): ReviewFinding {
  const payload: FindingPayload = {
    kind: 'indicator',
    indicator_slug: 'rent-burden',
    name: 'Rent burden',
    value: 42.7,
    unit: '% of households',
    year: 2023,
    target: 30,
    level_pct: 42,
    scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' },
    source: 'Anytown Housing Report',
    source_url: 'https://anytown.example.gov/housing/report',
    source_tier: 1,
    evidence,
    confidence: 'high',
    geographic_scale: 'city',
    ...(narrativeEvidence
      ? {
          narrative_draft: {
            context: 'Rents rose faster than wages.',
            actions: [{ text: 'Apply for rental help', source_url: 'https://anytown.example.gov/help', evidence: narrativeEvidence }],
          },
        }
      : {}),
  };
  return {
    id: 'f1',
    indicatorSlug: 'rent-burden',
    payload,
    verification: { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' },
    audits: [],
  };
}

function renderCard(f: ReviewFinding): string {
  return renderToStaticMarkup(
    createElement(ReviewCard, {
      tenantSlug: 'anytown',
      runId: 'r1',
      dimensionId: 'd1',
      dimensionName: 'Housing',
      ring: 'social',
      findings: [f],
      approvedVersionNum: null,
      sessionId: null,
      canReadTranscript: false,
      evidenceBase: BASE,
    }),
  );
}

const CAPTURED = '2026-11-20T10:00:00.000Z';

describe('the review card and the text research read', () => {
  it('links the stored text of a captured page beside its snapshot and PDF', () => {
    const html = renderCard(
      capturedFinding({
        snapshot_path: 'evidence/abc123.png',
        pdf_path: 'evidence/abc123.pdf',
        text_path: 'evidence/abc123.txt',
        captured_at: CAPTURED,
      }),
    );
    expect(html).toContain(`href="${BASE}/evidence/abc123.txt"`);
    expect(html).toContain('>text research read</a>');
    expect(html).toContain(`href="${BASE}/evidence/abc123.pdf"`);
    expect(html).not.toContain('No readable text');
  });

  it('says so when a capture found no readable text, as with a scanned PDF', () => {
    const html = renderCard(
      capturedFinding({
        snapshot_path: 'evidence/scan01.png',
        pdf_path: 'evidence/scan01.pdf',
        no_readable_text: true,
        captured_at: CAPTURED,
      }),
    );
    expect(html).toContain('No readable text: research could not read any words on this page or document.');
    expect(html).not.toContain('text research read');
    expect(html).not.toContain('.txt');
  });

  it('shows an older finding, captured before text was kept, with no text link and no note', () => {
    const html = renderCard(capturedFinding({ snapshot_path: 'evidence/old001.png', captured_at: '2026-10-23T00:00:00Z' }));
    expect(html).toContain(`src="${BASE}/evidence/old001.png"`);
    expect(html).toContain('captured 2026-10-23');
    expect(html).not.toContain('text research read');
    expect(html).not.toContain('No readable text');
    expect(html).not.toContain('.txt');
    expect(html).not.toContain('undefined');
  });

  it('links the text of a proposed action source too', () => {
    const html = renderCard(
      capturedFinding(
        { snapshot_path: 'evidence/abc123.png', captured_at: CAPTURED },
        { snapshot_path: 'evidence/help01.png', text_path: 'evidence/help01.txt', captured_at: CAPTURED },
      ),
    );
    expect(html).toContain(`href="${BASE}/evidence/help01.txt"`);
    expect(html).toContain('Archived evidence');
  });
});

describe('the review card and the cheap source checks', () => {
  const checked = (over: Partial<NonNullable<ReviewFinding['verification']>>, evidence?: IndicatorEvidence): ReviewFinding => {
    const f = capturedFinding(evidence ?? { snapshot_path: 'evidence/abc123.png', text_path: 'evidence/abc123.txt', captured_at: CAPTURED });
    return { ...f, verification: { ...f.verification!, ...over } };
  };
  const flaggedCount = (html: string) => /(\d+) flagged/.exec(html)?.[1] ?? null;

  it('says the value was found, and does not flag the finding for it', () => {
    const html = renderCard(checked({ value_on_page: 'found', home_page_link: false }));
    expect(html).toContain('value found on the captured page');
    expect(html).not.toContain('value not found');
    // The home-page note and badge; the card's list of causes names it too.
    expect(html).not.toContain('Home-page link:');
    expect(html).not.toContain('>home-page link<');
    expect(flaggedCount(html)).toBeNull();
  });

  it('says the value was not found, explains it in plain words, and flags the finding', () => {
    const html = renderCard(checked({ value_on_page: 'not_found' }));
    expect(html).toContain('>value not found<');
    expect(html).toContain('Value not found: 42.7 does not appear in the text research read from the captured page.');
    expect(html).toContain('>text research read</a>');
    expect(flaggedCount(html)).toBe('1');
  });

  it('says there was no readable text, without flagging the finding for it', () => {
    const html = renderCard(checked({ value_on_page: 'no_text' }, { snapshot_path: 'evidence/abc123.png', captured_at: CAPTURED }));
    expect(html).toContain('>no readable text<');
    expect(html).toContain('No readable text: research had no text from this page to look for the value in');
    expect(flaggedCount(html)).toBeNull();
  });

  it('writes the missing value the way the card writes it above', () => {
    const f = checked({ value_on_page: 'not_found' });
    const html = renderCard({ ...f, payload: { ...f.payload, value: 1_200_000, unit: 'people' } as FindingPayload });
    expect(html).toContain('1,200,000 people');
    expect(html).toContain('Value not found: 1,200,000 does not appear in the text research read');
  });

  it('says the kept text could not be opened, rather than that there was none, when the text link is there', () => {
    const html = renderCard(checked({ value_on_page: 'no_text' }));
    expect(html).toContain('>text research read</a>');
    expect(html).toContain('No readable text: research kept the text of this page but could not open it to look for the value');
    expect(html).not.toContain('research had no text from this page');
    expect(flaggedCount(html)).toBeNull();
  });

  it('shows one note, not two, for a scanned document with no readable text', () => {
    const html = renderCard(
      checked({ value_on_page: 'no_text' }, { snapshot_path: 'evidence/scan01.png', pdf_path: 'evidence/scan01.pdf', no_readable_text: true, captured_at: CAPTURED }),
    );
    expect(html).toContain('No readable text: research could not read any words on this page or document.');
    expect(html).not.toContain('research had no text from this page');
  });

  it('flags a home-page link and says what to do about it', () => {
    const html = renderCard(checked({ value_on_page: 'found', home_page_link: true }));
    expect(html).toContain('>home-page link<');
    expect(html).toContain('Home-page link: the source link goes to a website&#x27;s home page or one of its sections');
    expect(flaggedCount(html)).toBe('1');
  });

  it('shows neither check on a finding recorded before the checks existed', () => {
    const html = renderCard(checked({}));
    // The badges and notes, not the card's list of causes, which names a home-page link too.
    expect(html).not.toMatch(/value found|value not found|no readable text|home-page link:/i);
    expect(html).not.toContain('>home-page link<');
    expect(html).not.toContain('undefined');
  });

  it('keeps a very long claimed value inside the note', () => {
    const long = 'a'.repeat(400);
    const f = checked({ value_on_page: 'not_found' });
    const html = renderCard({ ...f, payload: { ...f.payload, value: long } as FindingPayload });
    expect(html).toContain(`Value not found: ${long} does not appear`);
    expect(html).toMatch(/class="mt-2 break-words[^"]*">Value not found/);
  });
});

/**
 * The review card's gap form: the reviewer picks which indicator has no
 * usable data — every indicator at once is offered, last — and the button
 * saves a draft, publishing nothing.
 */

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const indicator = (slug: string, name: string): ReviewFinding => ({
  id: `f-${slug}`,
  indicatorSlug: slug,
  payload: {
    kind: 'indicator',
    indicator_slug: slug,
    name,
    value: 12,
    unit: '%',
    year: 2025,
    target: 5,
    level_pct: 40,
    scoring: { threshold_ref: slug, function: 'lower_is_better', inputs: { value: 12 }, worked_math: 'm' },
    source: 'County health department',
    source_url: 'https://health.example.gov/data',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/h.png', captured_at: '2026-09-01T00:00:00Z' },
    confidence: 'high',
    geographic_scale: 'city',
  } satisfies FindingPayload,
  verification: null,
  audits: [],
});

const gapFinding = (slug: string): ReviewFinding => ({
  id: `g-${slug}`,
  indicatorSlug: slug,
  payload: { kind: 'gap', indicator_slug: slug, reason: 'No series.', scales_tried: ['city'], searched_at: '2026-09-01T00:00:00Z' },
  verification: null,
  audits: [],
});

const three = [
  indicator('uninsured-rate', 'Uninsured residents'),
  indicator('life-expectancy', 'Life expectancy at birth'),
  indicator('clinic-wait-days', 'Days to a clinic appointment'),
];

const render = (findings: ReviewFinding[]) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(ReviewCard, {
        tenantSlug: 'nyc',
        runId: 'r1',
        dimensionId: 'd1',
        dimensionName: 'Health',
        ring: 'social',
        findings,
        approvedVersionNum: null,
        sessionId: null,
        canReadTranscript: false,
        evidenceBase: '/files/nyc',
      }),
    ),
  );

const optionsOf = (html: string) => {
  const gapSection = html.slice(html.indexOf('Indicator with no usable data'));
  const selectHtml = /<select[\s\S]*?<\/select>/.exec(gapSection)?.[0] ?? '';
  return [...selectHtml.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
};

describe('ReviewCard gap form', () => {
  it('lists the card’s three indicators by name, then every indicator at once, last', () => {
    const html = render(three);
    expect(optionsOf(html)).toEqual([
      ['', 'Choose an indicator'],
      ['uninsured-rate', 'Uninsured residents'],
      ['life-expectancy', 'Life expectancy at birth'],
      ['clinic-wait-days', 'Days to a clinic appointment'],
      ['all', 'Every indicator in this dimension (clears all its values)'],
    ]);
    expect(html).toContain('Indicator with no usable data');
  });

  it('saves a draft and says nothing about publishing on its button', () => {
    const html = render(three);
    expect(html).toContain('Save gap as draft');
    expect(html).not.toContain('Publish honest gap wedge');
    // Nothing is chosen at first, so the button waits for a choice and a reason.
    expect(html).toMatch(/<option value="" selected="">Choose an indicator<\/option>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save gap as draft<\/button>/);
  });

  it('names a gap card’s indicator by its framework name, and lists each indicator once', () => {
    expect(gapChoices([gapFinding('life-expectancy'), indicator('life-expectancy', 'Life expectancy'), gapFinding('my-own-series')])).toEqual([
      { value: 'life-expectancy', label: 'Life expectancy at birth' },
      { value: 'my-own-series', label: 'my-own-series' },
      { value: 'all', label: 'Every indicator in this dimension (clears all its values)' },
    ]);
  });

  it('still offers the whole dimension on a card with no findings', () => {
    expect(gapChoices([]).map((c) => c.value)).toEqual(['all']);
  });

  it('tells the reviewer the gap is a draft, and who can publish it', () => {
    expect(gapSavedMessage(4, false)).toBe(
      'Gap saved as draft version 4. Nothing is public yet: publish it under "Publish reviewed drafts" at the top of this page.',
    );
    expect(gapSavedMessage(4, true)).toBe('Gap saved as draft version 4. Nothing is public yet: another editor needs to publish it.');
  });
});

type Props = { children?: ReactNode; onClick?: () => void; onChange?: (e: { target: { value: string } }) => void };

/** Every element GapForm returns, depth first; it uses no hooks, so it can be called directly. */
function elementsOf(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elementsOf(node.props.children)];
}

const formProps = (form: Partial<GapFormState>, more: { busy?: boolean; onChange?: (p: Partial<GapFormState>) => void; onSave?: () => void } = {}) => ({
  name: 'gap-cause-d1',
  choices: gapChoices(three),
  form: { ...emptyGapForm, ...form },
  busy: more.busy ?? false,
  onChange: more.onChange ?? (() => {}),
  onSave: more.onSave ?? (() => {}),
});

const renderForm = (form: Partial<GapFormState>, busy = false) => renderToStaticMarkup(createElement(GapForm, formProps(form, { busy })));

describe('Gap form states', () => {
  it('passes the indicator picked in the list, and the reason typed, to the card', () => {
    const changes: Partial<GapFormState>[] = [];
    const tree = elementsOf(GapForm(formProps({}, { onChange: (p) => changes.push(p) })));
    tree.find((e) => e.type === 'select')!.props.onChange!({ target: { value: 'life-expectancy' } });
    tree.find((e) => e.type === 'textarea')!.props.onChange!({ target: { value: 'No city-level life table.' } });
    expect(changes).toEqual([{ indicator: 'life-expectancy' }, { reason: 'No city-level life table.' }]);
  });

  it('passes the cause picked to the card', () => {
    const changes: Partial<GapFormState>[] = [];
    const tree = elementsOf(GapForm(formProps({}, { onChange: (p) => changes.push(p) })));
    (tree.find((e) => e.type === CausePicker)!.props as unknown as { onChange: (c: string) => void }).onChange('wrong_year');
    expect(changes).toEqual([{ cause: 'wrong_year' }]);
  });

  it('saves when the button is pressed, once an indicator and a cause are chosen and a reason given', () => {
    const onSave = vi.fn();
    const tree = elementsOf(GapForm(formProps({ indicator: 'life-expectancy', cause: 'wrong_year', reason: 'None.' }, { onSave })));
    const button = tree.find((e) => e.type === 'button')!;
    expect(button.props).toMatchObject({ disabled: false });
    button.props.onClick!();
    expect(onSave).toHaveBeenCalledOnce();
    expect(renderForm({ indicator: 'life-expectancy', cause: 'wrong_year', reason: 'None.' })).toMatch(/<option value="life-expectancy" selected="">/);
  });

  it('waits for a cause before it can save', () => {
    const html = renderForm({ indicator: 'life-expectancy', reason: 'None.' });
    expect(html).toContain('Why can&#x27;t research&#x27;s finding be used?');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save gap as draft<\/button>/);
    expect(renderForm({ indicator: 'life-expectancy', cause: 'wrong_year', reason: 'None.' })).toMatch(/<input type="radio" name="gap-cause-d1" checked="" value="wrong_year"/);
  });

  it('says where the words go for "Something else", and needs them', () => {
    const blank = renderForm({ indicator: 'life-expectancy', cause: 'other', reason: '  ' });
    expect(blank).toContain('Say what is wrong in the reason below.');
    expect(blank).toMatch(/<button[^>]*disabled=""[^>]*>Save gap as draft<\/button>/);
    expect(renderForm({ indicator: 'life-expectancy', cause: 'other', reason: 'Counts visits, not people.' })).not.toMatch(/<button[^>]*disabled=""/);
  });

  it('shows the save in progress, with every field held still', () => {
    const html = renderForm({ indicator: 'life-expectancy', reason: 'None.', saving: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Saving…<\/button>/);
    expect(html).not.toContain('Save gap as draft');
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });

  it('holds still while another action on the card runs', () => {
    expect(renderForm({ indicator: 'life-expectancy', reason: 'None.' }, true)).toMatch(/<button[^>]*disabled=""[^>]*>Save gap as draft<\/button>/);
  });

  it('shows a refusal beside the form, keeping what was chosen and typed', () => {
    const html = renderForm({ indicator: 'life-expectancy', reason: 'None.', error: 'That indicator is not part of this dimension.' });
    expect(html).toMatch(/<p role="alert"[^>]*>That indicator is not part of this dimension\.<\/p><button/);
    expect(html).toMatch(/<option value="life-expectancy" selected="">/);
    expect(html).toContain('>None.</textarea>');
  });

  it('shows no refusal line when nothing went wrong', () => {
    expect(renderForm({})).not.toContain('role="alert"');
  });
});

describe('submitGap', () => {
  const where = { tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1' };
  const chosen: GapFormState = { ...emptyGapForm, indicator: 'life-expectancy', cause: 'wrong_geography', reason: 'No city-level life table.', saving: true };

  it('sends the run, the chosen indicator and the cause, then empties the form and says the gap is a draft', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: { versionId: 'v', versionNum: 7, requiresSecondReview: false } }));
    const after = await submitGap(send, where, chosen);
    expect(send).toHaveBeenCalledWith({ tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', indicator: 'life-expectancy', reason: 'No city-level life table.', cause: 'wrong_geography' });
    expect(after).toEqual({ ...emptyGapForm, saved: gapSavedMessage(7, false) });
  });

  it('keeps the choice and reason when the save is refused, and says why', async () => {
    const send = vi.fn(async () => ({ ok: false as const, error: 'This needs the editor role on this portrait.' }));
    expect(await submitGap(send, where, chosen)).toEqual({ ...chosen, saving: false, error: 'This needs the editor role on this portrait.' });
  });

  it('keeps the form and says in plain words when the server cannot be reached', async () => {
    const send = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    expect(await submitGap(send, where, chosen)).toEqual({ ...chosen, saving: false, error: NO_ANSWER });
    expect(NO_ANSWER).not.toMatch(/fetch|network|error/i);
  });
});

/**
 * Every decision but an approval needs a cause: the card offers the same
 * causes, in the same order, as one row of radio buttons for re-research,
 * for a gap and before opening the editor.
 */
describe('the review card asks why', () => {
  const causeLabels = REVIEW_CAUSES.map((c) => c.label.replaceAll("'", '&#x27;'));
  const radios = (html: string, name: string) =>
    [...html.matchAll(new RegExp(`<input type="radio" name="${name}" value="([a-z_]+)"`, 'g'))].map((m) => m[1]);

  it('offers every cause, in order, for re-research, a gap and an edit', () => {
    const html = render(three);
    for (const name of ['rerun-cause-d1', 'gap-cause-d1', 'edit-cause-d1']) {
      expect(radios(html, name)).toEqual(REVIEW_CAUSES.map((c) => c.id));
    }
    let at = 0;
    for (const label of causeLabels) {
      const next = html.indexOf(`<span>${label}</span>`, at);
      expect(next, label).toBeGreaterThan(-1);
      at = next;
    }
    expect(html).toContain('Why re-research?');
    expect(html).toContain('Why edit?');
    expect(html).not.toContain('Correct as cited');
  });

  it('keeps each button waiting until a cause is picked', () => {
    const html = render(three);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Plan re-research<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open the editor<\/button>/);
    // No cause is picked for the reviewer.
    expect(html).not.toMatch(/type="radio"[^>]*checked=""/);
  });

  it('lays the causes out to wrap on a narrow screen, each a full-size target', () => {
    const html = render(three);
    expect(html).toMatch(/<div class="mt-1 flex flex-wrap gap-1.5"><label class="inline-flex min-h-11/);
  });

  it('opens the editor on the run and cause picked', () => {
    expect(reviewEditHref('nyc', 'd1', 'r1', 'wrong_year')).toBe('/nyc/admin/dim/d1?run=r1&cause=wrong_year');
  });

  it('still asks why on a card with no findings', () => {
    const html = render([]);
    expect(radios(html, 'rerun-cause-d1')).toHaveLength(REVIEW_CAUSES.length);
    expect(radios(html, 'gap-cause-d1')).toHaveLength(REVIEW_CAUSES.length);
  });

  it('offers a strategy selector defaulting to hybrid (with standard and deep) in the Re-research form', () => {
    const html = render(three);
    expect(html).toContain('aria-label="Research strategy for re-research"');
    expect(html).toMatch(/<option value="hybrid" selected="">/);
    expect(html).toContain('<option value="standard">');
    expect(html).toContain('<option value="deep">');
  });

  it('preserves exact per-finding session transcript links across dense-dimension chunks', () => {
    const html = renderToStaticMarkup(
      createElement(ReviewCard, {
        tenantSlug: 'nyc',
        runId: 'r1',
        dimensionId: 'd1',
        dimensionName: 'Housing',
        ring: 'social',
        approvedVersionNum: null,
        sessionId: 'sess-chunk-1',
        sessionIds: ['sess-chunk-1', 'sess-chunk-2'],
        canReadTranscript: true,
        evidenceBase: '/evidence',
        findings: [
          finding({ id: 'f1', sessionId: 'sess-chunk-1', indicatorSlug: 'rent' }),
          finding({ id: 'f2', sessionId: 'sess-chunk-2', payload: gap, indicatorSlug: 'water' }),
        ],
      }),
    );
    expect(html).toContain('href="/api/research/sessions/sess-chunk-1/transcript"');
    expect(html).toContain('href="/api/research/sessions/sess-chunk-2/transcript"');
    expect(html).toContain('>transcript 1</a>');
    expect(html).toContain('>transcript 2</a>');
    expect(html.match(/>session transcript<\/a>/g)).toHaveLength(2);
  });
});
