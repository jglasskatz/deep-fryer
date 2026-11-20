import React, { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { FindingPayload, IndicatorEvidence } from '@deep-fryer/core';
import type { RunExecution } from '@deep-fryer/db';
import {
  emptyGapForm,
  FindingRow,
  GapForm,
  NO_ANSWER,
  gapChoices,
  gapSavedMessage,
  ReviewCard,
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

const optionsOf = (html: string) => [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);

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

  it('saves when the button is pressed, once something is chosen and a reason given', () => {
    const onSave = vi.fn();
    const tree = elementsOf(GapForm(formProps({ indicator: 'life-expectancy', reason: 'None.' }, { onSave })));
    const button = tree.find((e) => e.type === 'button')!;
    expect(button.props).toMatchObject({ disabled: false });
    button.props.onClick!();
    expect(onSave).toHaveBeenCalledOnce();
    expect(renderForm({ indicator: 'life-expectancy', reason: 'None.' })).toMatch(/<option value="life-expectancy" selected="">/);
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
  const where = { tenantSlug: 'nyc', dimensionId: 'd1' };
  const chosen: GapFormState = { ...emptyGapForm, indicator: 'life-expectancy', reason: 'No city-level life table.', saving: true };

  it('sends the chosen indicator, then empties the form and says the gap is a draft', async () => {
    const send = vi.fn(async () => ({ ok: true as const, data: { versionId: 'v', versionNum: 7, requiresSecondReview: false } }));
    const after = await submitGap(send, where, chosen);
    expect(send).toHaveBeenCalledWith({ tenantSlug: 'nyc', dimensionId: 'd1', indicator: 'life-expectancy', reason: 'No city-level life table.' });
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
