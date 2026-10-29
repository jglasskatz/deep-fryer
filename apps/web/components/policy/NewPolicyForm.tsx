'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { POLICY_ANALYSIS_SESSIONS, POLICY_NO_BASELINE, readPolicyEvaluationContext, type PolicyEvaluationContext } from '@deep-fryer/core';
import { createPolicyAnalysis } from '@/lib/policy-actions';
import { POLICY_LIMITS, briefLength } from '@/lib/policy-limits';
import { useAction } from '@/lib/use-action';
import { unwrap } from '@/lib/action-result';

const field = 'w-full rounded border border-field-border bg-white px-2 py-1.5 text-sm';
const sessions = `${POLICY_ANALYSIS_SESSIONS} research session${POLICY_ANALYSIS_SESSIONS === 1 ? '' : 's'}`;

/**
 * Start a policy analysis (SPEC-v5 §2): title, optional source link, and the
 * pasted brief. The server action is the authority on every limit and on the
 * plan's allowance; the form mirrors the same limits (lib/policy-limits.ts)
 * so the count is right while typing.
 *
 * The brief textarea deliberately has no maxLength: a browser silently
 * truncates a long paste to maxLength, which would analyze half a policy
 * without saying so. Over the limit, the form says by how much instead —
 * the changing figure in the (non-live) count under the field, and a fixed
 * alert sentence that is announced once, when the limit is crossed, rather
 * than on every keystroke while the brief is trimmed back.
 *
 * `initial` prefills the fields from an earlier analysis ("Run again with
 * this brief"); the form is otherwise blank.
 */
export function NewPolicyForm({
  tenantSlug,
  blockedReason,
  hasPublishedBaseline = true,
  initial,
}: {
  tenantSlug: string;
  /** Why no analysis can start right now (plan standing or allowance), from the page. */
  blockedReason: string | null;
  hasPublishedBaseline?: boolean;
  initial?: { title: string; sourceUrl: string; brief: string };
}) {
  const initialScope = initial ? readPolicyEvaluationContext(initial.brief) : null;
  const initialBrief = initialScope && initial ? initial.brief.split('\n\nPolicy text:\n').slice(1).join('\n\nPolicy text:\n') : initial?.brief;
  const id = useId();
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '');
  const [brief, setBrief] = useState(initialBrief ?? '');

  const [analysisMode, setAnalysisMode] = useState<'baseline' | 'retrospective' | 'prospective'>(initialScope?.mode ?? 'baseline');
  const [scope, setScope] = useState<PolicyEvaluationContext>(initialScope ?? {mode:'prospective',geography:tenantSlug,evidenceCutoff:new Date().toISOString().slice(0,10),horizon:'1–3 years after implementation',comparator:'No policy / continuation of current practice',affectedGroups:''});
  const scopeField = (key: keyof PolicyEvaluationContext, value: string) => setScope(previous => ({...previous,[key]:value}));
  const modeBlockedReason = blockedReason ?? (analysisMode === 'baseline' && !hasPublishedBaseline ? POLICY_NO_BASELINE : null);
  const chars = briefLength(brief);
  const over = chars - POLICY_LIMITS.briefMax;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { id: analysisId } = unwrap(
        await createPolicyAnalysis({ tenantSlug, title, brief, sourceUrl, evaluationContext: analysisMode === 'baseline' ? undefined : {...scope, mode: analysisMode} }),
      );
      router.push(`/${tenantSlug}/admin/policy/${analysisId}`);
    });
  };

  return (
    <form
      id="new-analysis"
      onSubmit={submit}
      className="scroll-mt-24 rounded border border-black/15 p-4"
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`} className="text-base font-semibold">
        New analysis
      </h2>
      <p className="mt-1 text-xs text-[color:var(--color-muted)]">
        The brief is analyzed once using the existing research provider and web sources. Retrospective
        evidence and conditional forecasts stay distinct. Results are drafts for staff review, never published.
        The research budget and provider configuration below still apply.
      </p>
      {initial ? (
        <p className="mt-2 text-sm">
          Filled in from an earlier analysis. Check the fields, then start it again.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-title`} className="text-sm font-medium">
            Title
          </label>
          <input
            id={`${id}-title`}
            className={`mt-1 ${field}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={POLICY_LIMITS.titleMin}
            maxLength={POLICY_LIMITS.titleMax}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={`${id}-source`} className="text-sm font-medium">
            Source link <span className="font-normal text-[color:var(--color-muted)]">(optional, https)</span>
          </label>
          <input
            id={`${id}-source`}
            type="url"
            inputMode="url"
            className={`mt-1 ${field}`}
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={POLICY_LIMITS.sourceUrlMax}
            pattern="https://.*"
            title="A full link starting with https://"
            placeholder="https://"
          />
        </div>
      </div>

      <label className="mt-4 block text-sm">Analysis type
        <select className={field} value={analysisMode} onChange={e => setAnalysisMode(e.target.value as typeof analysisMode)}>
          <option value="baseline">Modeled comparison with the published portrait</option>
          <option value="retrospective">Past policy — evidence graph</option>
          <option value="prospective">Proposed policy — conditional evidence graph</option>
        </select>
      </label>
      <p className="mt-2 text-sm">Portrait comparisons retain the published baseline and local dimensions. Evidence graphs use canonical Doughnut categories, not custom portrait scores, and do not require a published baseline.</p>
      {analysisMode !== 'baseline' && <fieldset className="mt-4 grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Evaluation scope</legend>
        <label className="text-sm">Geography<input className={field} required maxLength={300} value={scope.geography} onChange={e=>scopeField('geography',e.target.value)}/></label>
        <label className="text-sm">Evidence cutoff<input className={field} type="date" required value={scope.evidenceCutoff} onChange={e=>scopeField('evidenceCutoff',e.target.value)}/></label>
        <label className="text-sm">Outcome horizon<input className={field} required maxLength={300} value={scope.horizon} onChange={e=>scopeField('horizon',e.target.value)}/></label>
        <label className="text-sm">No-policy comparator<input className={field} required maxLength={600} value={scope.comparator} onChange={e=>scopeField('comparator',e.target.value)}/></label>
        <label className="text-sm">Affected groups<input className={field} required maxLength={600} placeholder="Exposed groups, beneficiaries and those bearing costs" value={scope.affectedGroups} onChange={e=>scopeField('affectedGroups',e.target.value)}/></label>
      </fieldset>}
      <div className="mt-3">
        <label htmlFor={`${id}-brief`} className="text-sm font-medium">
          Policy brief
        </label>
        <textarea
          id={`${id}-brief`}
          className={`mt-1 ${field} min-h-[14rem] font-normal`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          required
          minLength={POLICY_LIMITS.briefMin}
          aria-describedby={over > 0 ? `${id}-over ${id}-count` : `${id}-count`}
          aria-invalid={over > 0 || undefined}
        />
        <p id={`${id}-count`} className="mt-1 text-xs tabular-nums text-[color:var(--color-muted)]">
          {chars.toLocaleString('en-US')} / {POLICY_LIMITS.briefMax.toLocaleString('en-US')} characters
          {chars < POLICY_LIMITS.briefMin ? ` — at least ${POLICY_LIMITS.briefMin}` : ''}
          {over > 0 ? ` — ${over.toLocaleString('en-US')} over` : ''}. Paste the policy text; the
          analysis treats it as material to read, never as instructions.
        </p>
        {/* Fixed text: mounted (and so announced) once when the limit is
            crossed; the live figure stays in the count above. */}
        {over > 0 ? (
          <p id={`${id}-over`} role="alert" className="mt-1 text-sm text-red-700">
            The brief is over the {POLICY_LIMITS.briefMax.toLocaleString('en-US')}-character limit.
            Paste the summary and operative sections instead of the whole document.
          </p>
        ) : null}
      </div>

      {/* Known at render, not a reaction to input — so not an alert (the allowance
          section above already announces a billing problem). */}
      {modeBlockedReason ? <p className="mt-3 text-sm text-red-900">{modeBlockedReason}</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={pending || over > 0 || modeBlockedReason !== null}
      >
        {pending ? 'Starting…' : `Analyze — uses ${sessions}`}
      </button>
    </form>
  );
}

