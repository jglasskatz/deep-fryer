import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSpreadsheetPaste } from './CellEditor';
import { BACK_WAIT_MS, goBackOrElse, leavingHref, type BackTarget } from './leave-guard';

/**
 * Which clicks would leave the page while changes are staged (and so are
 * asked about first), and which pastes into a cell's box are a spreadsheet's
 * cells to lay over the table rather than words to type in.
 */

const here = 'https://doughnut.example.org/santa-cruz/admin/data?show=no-value';
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, extra: { target?: string; download?: boolean } = {}) => ({
  href: new URL(href, here).href,
  target: extra.target ?? '',
  hasAttribute: (name: string) => name === 'download' && Boolean(extra.download),
});

describe('leavingHref', () => {
  it('stops a plain click on a link to another page of the site or another site', () => {
    expect(leavingHref(plain, link('/santa-cruz/admin'), here)).toBe('https://doughnut.example.org/santa-cruz/admin');
    expect(leavingHref(plain, link('/santa-cruz/admin/data'), here)).toBe('https://doughnut.example.org/santa-cruz/admin/data');
    expect(leavingHref(plain, link('https://data.census.gov/'), here)).toBe('https://data.census.gov/');
  });

  it('lets through what loses nothing: a new tab, a download, a part of this page, a click that is not plain', () => {
    expect(leavingHref(plain, link('https://data.census.gov/', { target: '_blank' }), here)).toBeNull();
    expect(leavingHref(plain, link('/file.csv', { download: true }), here)).toBeNull();
    expect(leavingHref(plain, link('#row-food/food-insecurity-rate'), here)).toBeNull();
    expect(leavingHref({ ...plain, metaKey: true }, link('/santa-cruz/admin'), here)).toBeNull();
    expect(leavingHref({ ...plain, ctrlKey: true }, link('/santa-cruz/admin'), here)).toBeNull();
    expect(leavingHref({ ...plain, button: 1 }, link('/santa-cruz/admin'), here)).toBeNull();
    expect(leavingHref({ ...plain, defaultPrevented: true }, link('/santa-cruz/admin'), here)).toBeNull();
    expect(leavingHref(plain, null, here)).toBeNull();
  });
});

describe('isSpreadsheetPaste', () => {
  it('treats cells copied from a spreadsheet as a range, and words as words', () => {
    expect(isSpreadsheetPaste('12\t13', '')).toBe(true);
    expect(isSpreadsheetPaste('12\n13\n', '<table><tr><td>12</td></tr><tr><td>13</td></tr></table>')).toBe(true);
    expect(isSpreadsheetPaste('one line\nand another', '')).toBe(false);
    expect(isSpreadsheetPaste('12', '<table><tr><td>12</td></tr></table>')).toBe(false);
    expect(isSpreadsheetPaste('plain words', '')).toBe(false);
  });
});

describe('goBackOrElse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A window whose Back does what `onBack` does: fire popstate or pagehide, or nothing (the tab's first page). */
  function fakeWindow(onBack: (fire: (type: 'popstate' | 'pagehide') => void) => void) {
    const listeners = new Map<string, Set<() => void>>();
    const fire = (type: 'popstate' | 'pagehide') => listeners.get(type)?.forEach((l) => l());
    const target: BackTarget = {
      history: { back: () => onBack(fire) },
      addEventListener: (type, l) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(l);
      },
      removeEventListener: (type, l) => {
        listeners.get(type)?.delete(l);
      },
    };
    return { target, listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) };
  }

  it('says there was nowhere to go when Back did nothing, as on the first page of a tab', () => {
    vi.useFakeTimers();
    const { target, listening } = fakeWindow(() => {});
    const nowhere = vi.fn();
    goBackOrElse(target, nowhere);
    vi.advanceTimersByTime(BACK_WAIT_MS - 1);
    expect(nowhere).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(nowhere).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(0);
  });

  it('stays quiet when Back stepped to an earlier page of the site or left for another site', () => {
    vi.useFakeTimers();
    for (const event of ['popstate', 'pagehide'] as const) {
      const { target, listening } = fakeWindow((fire) => setTimeout(() => fire(event), 50));
      const nowhere = vi.fn();
      goBackOrElse(target, nowhere);
      vi.advanceTimersByTime(BACK_WAIT_MS * 2);
      expect(nowhere, event).not.toHaveBeenCalled();
      expect(listening()).toBe(0);
    }
  });
});
