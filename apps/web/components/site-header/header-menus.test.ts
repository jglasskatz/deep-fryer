import { describe, expect, it, vi } from 'vitest';
import { escapeUnfries } from '@/lib/theme';
import { OPEN_HEADER_MENU, onMenuFocusOut, onMenuKeyDown, onMenuPointerDown, type MenuDocument } from './header-menus';

/**
 * The header menus' dismissal rules, on a small fake DOM: a node knows its
 * parent, `closest` walks up to an open menu, and a menu reports what it
 * contains. Enough to drive the rules exactly as the document's events do.
 */
interface FakeNode {
  name: string;
  parent: FakeNode | null;
  closest(selector: string): unknown;
  focus: ReturnType<typeof vi.fn>;
}
interface FakeMenu extends FakeNode {
  open: boolean;
  summary: FakeNode;
  contains(node: unknown): boolean;
  querySelector(selector: 'summary'): FakeNode;
}

function node(name: string, parent: FakeNode | null): FakeNode {
  const n: FakeNode = {
    name,
    parent,
    focus: vi.fn(),
    closest(selector) {
      expect(selector).toBe(OPEN_HEADER_MENU);
      for (let at: FakeNode | null = n; at; at = at.parent) {
        if ('open' in at && (at as FakeMenu).open) return at;
      }
      return null;
    },
  };
  return n;
}

function menu(name: string, parent: FakeNode): FakeMenu {
  const m = node(name, parent) as FakeMenu;
  m.open = true;
  m.summary = node(`${name} summary`, m);
  m.contains = (other) => {
    for (let at = other as FakeNode | null; at; at = at.parent) if (at === m) return true;
    return false;
  };
  m.querySelector = () => m.summary;
  return m;
}

function page() {
  const body = node('body', null);
  const header = node('header', body);
  const language = menu('language', header);
  const english = node('English', language);
  const account = menu('account', header);
  account.open = false;
  const borough = node('Manhattan link', body);
  const doc: MenuDocument = {
    body,
    querySelectorAll: (selector) => {
      expect(selector).toBe(OPEN_HEADER_MENU);
      return [language, account].filter((m) => m.open);
    },
  };
  return { body, language, english, account, borough, doc };
}

const key = (k: string, target: unknown, extra: { defaultPrevented?: boolean; isComposing?: boolean } = {}) => {
  const event = {
    key: k,
    target,
    defaultPrevented: extra.defaultPrevented ?? false,
    isComposing: extra.isComposing ?? false,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
  };
  return event;
};

describe('header menus: Escape', () => {
  it('closes the menu it is pressed in and returns focus to its summary', () => {
    const { language, english, doc } = page();
    const event = key('Escape', english);
    expect(onMenuKeyDown(event, doc)).toBe(true);
    expect(language.open).toBe(false);
    expect(language.summary.focus).toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('closes from the summary itself, and the spent Escape does not also un-fry the page', () => {
    const { language, doc } = page();
    const event = key('Escape', language.summary);
    onMenuKeyDown(event, doc);
    expect(language.open).toBe(false);
    expect(escapeUnfries(event)).toBe(false);
  });

  it('closes the open menu when focus is on nothing in particular (Safari does not focus a clicked summary)', () => {
    const { language, body, doc } = page();
    expect(onMenuKeyDown(key('Escape', body), doc)).toBe(true);
    expect(language.open).toBe(false);
  });

  it('leaves other keys, used Escapes, IME Escapes, and Escapes elsewhere on the page alone', () => {
    for (const event of [
      key('Enter', page().english),
      key('Escape', page().english, { defaultPrevented: true }),
      key('Escape', page().english, { isComposing: true }),
    ]) {
      const { doc } = page();
      expect(onMenuKeyDown(event, doc)).toBe(false);
    }
    const { language, borough, doc } = page();
    const event = key('Escape', borough);
    expect(onMenuKeyDown(event, doc)).toBe(false);
    expect(language.open).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('header menus: focus leaving', () => {
  it('closes the menu when Tab moves focus past its last item, so it cannot cover the next link', () => {
    const { language, english, borough } = page();
    expect(onMenuFocusOut({ target: english, relatedTarget: borough })).toBe(true);
    expect(language.open).toBe(false);
  });

  it('stays open while focus moves within the menu (item to summary, summary to item)', () => {
    const { language, english } = page();
    expect(onMenuFocusOut({ target: english, relatedTarget: language.summary })).toBe(false);
    expect(onMenuFocusOut({ target: language.summary, relatedTarget: english })).toBe(false);
    expect(language.open).toBe(true);
  });

  it('stays open when focus goes nowhere (the window lost focus)', () => {
    const { language, english } = page();
    expect(onMenuFocusOut({ target: english, relatedTarget: null })).toBe(false);
    expect(language.open).toBe(true);
  });
});

describe('header menus: pressing outside', () => {
  it('closes open menus the press is outside of', () => {
    const { language, borough, doc } = page();
    expect(onMenuPointerDown({ target: borough }, doc)).toBe(1);
    expect(language.open).toBe(false);
  });

  it('leaves a menu alone when the press is inside it (its summary toggles it natively)', () => {
    const { language, english, doc } = page();
    expect(onMenuPointerDown({ target: english }, doc)).toBe(0);
    expect(onMenuPointerDown({ target: language.summary }, doc)).toBe(0);
    expect(language.open).toBe(true);
  });
});
