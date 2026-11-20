import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutreachContactData } from '@deep-fryer/core';
import { copyText, mailtoHref, openDetailsForPrint, OutreachContactsEditor, splitDraft, telHref, type ManagedOutreachContact } from './OutreachContactsEditor';

vi.stubGlobal('React', React);
vi.mock('@/lib/outreach-admin-actions', () => ({ saveOutreachContact: vi.fn(), publishOutreachContact: vi.fn(), setOutreachArchived: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

const draft = 'Subject: Water data for our doughnut\n\nHello Ms. Rivera,\nCould you share 2025 use & loss figures? Thanks — 100% appreciated.';
const data = (over: Partial<OutreachContactData> = {}): OutreachContactData => ({
  org: 'City Water Department',
  person: 'Ana Rivera',
  email: 'ana.rivera@water.example.gov',
  phone: '(831) 420-5200',
  address: '212 Locust Street',
  website: 'https://water.example.gov',
  why: 'Runs the city’s water supply.',
  tags: ['water'],
  data_needs: ['Per-person water use, 2020 to 2025'],
  draft_message: draft,
  ...over,
});
const contact = (id: string, over: Partial<OutreachContactData> = {}): ManagedOutreachContact => ({
  id,
  archived: false,
  publishedVersionId: null,
  versions: [{ id: `${id}-v2`, versionNum: 2, data: data(over) }, { id: `${id}-v1`, versionNum: 1, data: data({ draft_message: 'Old draft' }) }],
});
const render = (contacts: ManagedOutreachContact[]) =>
  renderToStaticMarkup(createElement(OutreachContactsEditor, { tenantSlug: 'ithaca', contacts }));
const decode = (html: string) => html.replace(/&amp;/g, '&');

describe('outreach contacts: copy, email and print', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links each contact’s draft to the email program with its address, subject and message', () => {
    const html = decode(render([contact('c1')]));
    const href = /href="(mailto:[^"]+)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    const url = new URL(href!);
    expect(url.pathname).toBe('ana.rivera@water.example.gov');
    expect(url.searchParams.get('subject')).toBe('Water data for our doughnut');
    expect(url.searchParams.get('body')).toBe('Hello Ms. Rivera,\r\nCould you share 2025 use & loss figures? Thanks — 100% appreciated.');
    expect(html).toContain('Open the draft in your email program');
    expect(html).toContain('Copy draft message');
    // The latest version's draft, not an older one's.
    expect(html).not.toContain('Old draft');
    expect(html).toContain('Staff details (version 2)');
  });

  it('copy puts the draft, exactly as saved, on the clipboard, and says when the browser refuses', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText(draft)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(draft);

    expect(await copyText(draft, { writeText: async () => { throw new Error('denied'); } })).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(await copyText(draft)).toBe(false);
  });

  it('warns that a long draft may arrive cut short in some email programs, and points to Copy', () => {
    expect(render([contact('c1')])).not.toContain('This draft is long.');
    const long = render([contact('c1', { draft_message: 'Subject: Hi\n' + 'Word '.repeat(600) })]);
    expect(long).toContain('This draft is long.');
  });

  it('handles a contact with no draft, no address or a broken address without offering what cannot work', () => {
    const none = render([contact('c1', { draft_message: '', email: '', person: '', phone: '', address: '' })]);
    expect(none).not.toContain('Copy draft message');
    expect(none).not.toContain('mailto:');
    expect(none).toContain('No draft message yet.');
    expect(none).toContain('No contact person, email, phone or address saved.');

    const addressOnly = render([contact('c1', { draft_message: '' })]);
    expect(addressOnly).toContain('Write an email');
    expect(addressOnly).not.toContain('Copy draft message');

    const broken = render([contact('c1', { email: 'ana at water' })]);
    expect(broken).not.toContain('mailto:');
    expect(broken).toContain('Copy draft message');
    expect(broken).toContain('does not look complete');
  });

  it('prints the list alone: the form and every button are left out, and a print button is offered', () => {
    const html = render([contact('c1'), contact('c2', { org: 'A'.repeat(180) })]);
    expect(html).toContain('Print the list');
    expect(html).toMatch(/<section aria-labelledby="contact-editor" class="[^"]*print:hidden/);
    for (const label of ['Archive contact', 'Copy draft message', 'Edit from version 2', 'Publish version 2', 'Print the list']) {
      const at = html.indexOf(`>${label}<`);
      expect(at, label).toBeGreaterThan(-1);
      // The button, or the row holding it, is hidden in print.
      const before = html.slice(0, at);
      const opening = Math.max(before.lastIndexOf('<button'), before.lastIndexOf('<a '));
      const row = before.lastIndexOf('<div');
      expect(before.slice(opening).includes('print:hidden') || before.slice(row).includes('print:hidden'), label).toBe(true);
    }
    expect(html).toContain('break-words font-semibold">' + 'A'.repeat(180));
  });

  it('offers no print button when there is nothing to print', () => {
    const html = render([]);
    expect(html).toContain('No outreach contacts have been added.');
    expect(html).not.toContain('Print the list');
  });

  it('opens every collapsed section for printing, then closes only those it opened', () => {
    const details = [{ open: false }, { open: true }, { open: false }];
    const restore = openDetailsForPrint({ querySelectorAll: () => details } as never);
    expect(details.map(d => d.open)).toEqual([true, true, true]);
    restore();
    expect(details.map(d => d.open)).toEqual([false, true, false]);
  });
});

describe('mailto links', () => {
  it('reads a first "Subject:" line as the subject, and otherwise sends the whole draft as the body', () => {
    expect(splitDraft('subject:  Hi\r\nBody line')).toEqual({ subject: 'Hi', body: 'Body line' });
    expect(splitDraft('Subject: only a subject')).toEqual({ subject: 'only a subject', body: '' });
    expect(splitDraft('Hello,\nSubject: not first')).toEqual({ subject: '', body: 'Hello,\nSubject: not first' });
  });

  it('encodes characters that would end or change the link, and refuses an address that is not one', () => {
    const href = mailtoHref('a+b@example.org', 'Subject: Q&A?\nLine #1 & more')!;
    expect(href.startsWith('mailto:a%2Bb@example.org?subject=Q%26A%3F&body=')).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get('body')).toBe('Line #1 & more');
    expect(mailtoHref('a@example.org', '')).toBe('mailto:a@example.org');
    expect(mailtoHref('a@example.org?cc=x@evil.example', 'Hi')).toBeNull();
    expect(mailtoHref('', 'Hi')).toBeNull();
    expect(mailtoHref(undefined, undefined)).toBeNull();
  });

  it('treats an address carrying a query or path as incomplete, so the warning shows instead of a link', () => {
    for (const odd of ['a@b.co?bcc=evil@x.co', 'a@b.co?bcc=evil', 'a&b@example.org', 'a@b.co/path', 'a%40b@example.org', 'a=b@example.org']) {
      expect(mailtoHref(odd, 'Hi'), odd).toBeNull();
    }
    const html = render([contact('c1', { email: 'a@b.co?bcc=evil' })]);
    expect(html).not.toContain('mailto:');
    expect(html).toContain('does not look complete');
  });
});

describe('phone links', () => {
  it('dials the number without its extension, and keeps a leading +', () => {
    expect(telHref('(831) 420-5200')).toBe('tel:8314205200');
    expect(telHref('(555) 010-0000 ext. 12')).toBe('tel:5550100000');
    expect(telHref('555-0100 x12')).toBe('tel:5550100');
    expect(telHref('555-0100 Ext 12')).toBe('tel:5550100');
    expect(telHref('555-0100#12')).toBe('tel:5550100');
    expect(telHref('+1 831 420 5200')).toBe('tel:+18314205200');
  });

  it('shows a phone value with no digits as plain text, with no link', () => {
    expect(telHref('ask at the front desk')).toBeNull();
    expect(telHref('')).toBeNull();
    expect(telHref(undefined)).toBeNull();
    const html = render([contact('c1', { phone: 'ask at the front desk' })]);
    expect(html).toContain('ask at the front desk');
    expect(html).not.toContain('tel:');
    expect(render([contact('c1', { phone: '(555) 010-0000 ext. 12' })])).toContain('href="tel:5550100000"');
  });
});
