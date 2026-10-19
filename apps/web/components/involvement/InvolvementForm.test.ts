import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_INPUT_PATTERN } from '@deep-fryer/core';
import { en } from '@/lib/i18n/messages/en';
import type { SubmitInvolvementResult } from '@/lib/involvement-actions';

/**
 * The organization form as the server renders it (SPEC-v6 §4.2), before and
 * after the server flags fields the browser let through.
 *
 * There is no DOM here to submit the form in, so the second render starts
 * from the state a refused submission leaves: the component's one
 * `useState(null)` — the server's last answer — is seeded with it. Every
 * other hook is React's own.
 */
let answered: SubmitInvolvementResult | null = null;
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = ((initial: unknown) =>
    initial === null && answered !== null ? [answered, () => {}] : actual.useState(initial)) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

// Vitest compiles the component's JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

async function render(): Promise<string> {
  const { InvolvementForm } = await import('./InvolvementForm');
  return renderToStaticMarkup(
    createElement(InvolvementForm, {
      tenantSlug: 'nyc',
      token: 'token',
      labels: en.involvement,
      dimensions: [{ slug: 'housing', name: 'Housing' }],
    }),
  );
}

/** One element's opening tag, found by an attribute value only it has. */
const tagWith = (html: string, attr: string) => html.match(new RegExp(`<[a-z]+[^>]*${attr}[^>]*>`))?.[0] ?? '';

describe('InvolvementForm', () => {
  afterEach(() => {
    answered = null;
  });

  it('lets the browser refuse a phone number the server would, with the reason as its hint', async () => {
    const phone = tagWith(await render(), 'name="phone"');
    expect(phone).toContain(`pattern="${PHONE_INPUT_PATTERN}"`);
    expect(phone).toContain(`title="${en.involvement.phoneInvalid}"`);
  });

  it('says under each field the server refused what to change, and reads it with the field', async () => {
    answered = { status: 'invalid', fields: ['website', 'phone'] };
    const html = await render();
    for (const [name, message] of [
      ['website', en.involvement.websiteInvalid],
      ['phone', en.involvement.phoneInvalid],
    ] as const) {
      const field = tagWith(html, `name="${name}"`);
      expect(field).toContain('aria-invalid="true"');
      const describedBy = field.match(/aria-describedby="([^"]*)"/)?.[1]?.split(' ') ?? [];
      const errorId = describedBy[0]!;
      expect(errorId).toMatch(new RegExp(`-${name}-error$`));
      expect(html).toContain(`<span id="${errorId}" class="mt-1 block text-sm text-red-700">${message}</span>`);
    }
    // The phone field keeps its privacy note, after the error.
    expect(tagWith(html, 'name="phone"')).toMatch(/aria-describedby="[^" ]+-phone-error [^" ]+-privacy"/);
  });

  it('adds no message to a field that was not flagged', async () => {
    answered = { status: 'invalid', fields: ['org_name'] };
    const html = await render();
    expect(html).not.toContain(en.involvement.websiteInvalid);
    expect(html).not.toContain('-error"');
    expect(tagWith(html, 'name="website"')).not.toContain('aria-describedby');
  });
});
