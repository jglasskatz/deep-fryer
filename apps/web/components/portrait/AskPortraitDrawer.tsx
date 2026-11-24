'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { RAG_MAX_QUESTION_CHARS, type KnowledgeVisibility, type VerifiedCitation } from '@deep-fryer/core';
import { safeHref, sameSitePath } from '@/lib/safe-url';

export interface AskPortraitResponse {
  answer: string;
  citations: VerifiedCitation[];
  scope: KnowledgeVisibility;
  grounded: boolean;
}

export interface AskPortraitDrawerProps {
  tenantSlug: string;
  tenantName: string;
  suggestedQuestions: string[];
  /** Shown only to authenticated portrait members; server re-enforces membership and RLS. */
  canIncludeDrafts?: boolean;
  /** Initial open state (useful for tests). */
  initialOpen?: boolean;
  /** Initial answer state (useful for tests). */
  initialResponse?: AskPortraitResponse | null;
}

function safeCitationHref(url: string | null | undefined): { href: string; external: boolean } | null {
  if (!url) return null;
  const external = safeHref(url);
  if (external) return { href: external, external: true };
  const internal = sameSitePath(url);
  if (internal) return { href: internal, external: false };
  return null;
}

/**
 * Restrained, accessible slide-over Q&A drawer for `/[tenant]`.
 *
 * Rendered ONLY when the portrait's `ask_portrait` feature is enabled. Every
 * answer comes from `POST /api/portraits/[tenant]/ask` over indexed archived
 * sources, displays clickable verified citations, and clearly discloses that
 * answers come solely from this portrait's archived sources.
 */
export function AskPortraitDrawer({
  tenantSlug,
  tenantName,
  suggestedQuestions,
  canIncludeDrafts = false,
  initialOpen = false,
  initialResponse = null,
}: AskPortraitDrawerProps) {
  const [open, setOpen] = useState(initialOpen);
  const [question, setQuestion] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AskPortraitResponse | null>(initialResponse);

  const headingId = useId();
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function closeDrawer() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function ask(promptText: string) {
    const trimmed = promptText.trim();
    if (trimmed.length < 3 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portraits/${encodeURIComponent(tenantSlug)}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          includeDrafts: canIncludeDrafts ? includeDrafts : false,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | (AskPortraitResponse & { error?: undefined })
        | { error?: string }
        | null;
      if (!res.ok) {
        setError(payload?.error || 'Could not answer that question right now.');
        return;
      }
      if (payload && 'answer' in payload && typeof payload.answer === 'string') {
        setResponse(payload);
      } else {
        setError('Received an unexpected response from the server.');
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  function handleSuggestion(q: string) {
    setQuestion(q);
    void ask(q);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-black/5"
      >
        <span aria-hidden>✦</span>
        <span>Ask this portrait</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close Ask this portrait panel"
            onClick={closeDrawer}
            className="fixed inset-0 bg-black/5"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="relative z-10 flex h-full w-full max-w-lg flex-col border-s border-black/15 bg-[color:var(--color-bg)] text-[color:var(--color-fg)] shadow-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-black/10 px-5 py-4">
              <div>
                <h2 id={headingId} className="text-base font-semibold">
                  Ask {tenantName}
                </h2>
                <p className="mt-0.5 text-xs text-[color:var(--color-muted)]">
                  Answers come only from this portrait’s archived sources and published figures.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded px-2.5 py-1 text-sm underline hover:bg-black/5"
              >
                Close
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {suggestedQuestions.length > 0 ? (
                <section aria-label="Suggested questions">
                  <p className="text-xs font-medium text-[color:var(--color-muted)]">Suggested questions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestedQuestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={loading}
                        onClick={() => handleSuggestion(q)}
                        className="rounded border border-black/15 bg-white px-2.5 py-1.5 text-start text-xs hover:bg-black/5 disabled:opacity-60"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label htmlFor={inputId} className="block text-xs font-medium">
                    Your question
                  </label>
                  <textarea
                    ref={inputRef}
                    id={inputId}
                    rows={3}
                    maxLength={RAG_MAX_QUESTION_CHARS}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask about an indicator, target, source, or data gap…"
                    className="mt-1 block w-full rounded border border-[color:var(--color-muted)] bg-white px-3 py-2 text-sm text-[color:var(--color-fg)]"
                  />
                  <div className="mt-1 flex items-center justify-between text-xs text-[color:var(--color-muted)]">
                    <span>Grounded in archived portrait sources only</span>
                    <span>
                      {question.length}/{RAG_MAX_QUESTION_CHARS}
                    </span>
                  </div>
                </div>

                {canIncludeDrafts ? (
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={includeDrafts}
                      onChange={(e) => setIncludeDrafts(e.target.checked)}
                    />
                    <span>
                      Include unpublished drafts and internal policy analyses (members only)
                    </span>
                  </label>
                ) : null}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={loading || question.trim().length < 3}
                    className="rounded bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? 'Checking sources…' : 'Ask'}
                  </button>
                  {response ? (
                    <button
                      type="button"
                      onClick={() => {
                        setResponse(null);
                        setError(null);
                      }}
                      className="text-xs underline text-[color:var(--color-muted)]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </form>

              {error ? (
                <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  {error}
                </div>
              ) : null}

              <div aria-live="polite" className="space-y-4">
                {response ? (
                  <section aria-label="Answer" className="space-y-3 rounded border border-black/15 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={
                          response.grounded
                            ? 'rounded bg-black/5 px-2 py-0.5 font-medium'
                            : 'rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900'
                        }
                      >
                        {response.grounded
                          ? `Grounded in ${response.citations.length} archived ${response.citations.length === 1 ? 'source' : 'sources'}`
                          : 'Not covered by archived sources'}
                      </span>
                      {response.scope === 'member' ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900">
                          Includes member drafts
                        </span>
                      ) : null}
                    </div>

                    <p className="whitespace-pre-line text-sm leading-relaxed">{response.answer}</p>

                    {response.citations.length > 0 ? (
                      <div className="border-t border-black/10 pt-3">
                        <h3 className="text-xs font-semibold text-[color:var(--color-muted)]">Sources cited</h3>
                        <ol className="mt-2 space-y-1.5 text-xs">
                          {response.citations.map((citation) => {
                            const link = safeCitationHref(citation.citationUrl);
                            return (
                              <li key={`${citation.index}-${citation.chunkId}`} className="flex items-start gap-2">
                                <span className="shrink-0 font-mono text-[color:var(--color-muted)]">
                                  [{citation.index}]
                                </span>
                                {link ? (
                                  <a
                                    href={link.href}
                                    target={link.external ? '_blank' : undefined}
                                    rel={link.external ? 'noreferrer' : undefined}
                                    className="underline hover:opacity-80"
                                  >
                                    {citation.citationLabel}
                                    {link.external ? ' ↗' : ''}
                                  </a>
                                ) : (
                                  <span>{citation.citationLabel}</span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </div>

            <footer className="border-t border-black/10 px-5 py-3 text-xs text-[color:var(--color-muted)]">
              This assistant summarizes only archived data from this portrait and never invents figures. Verify critical
              numbers against the linked primary sources.
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  );
}
