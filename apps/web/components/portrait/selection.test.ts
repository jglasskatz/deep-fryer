import { describe, expect, it } from 'vitest';
import { closedHref, dimensionHref, isPlainClick, selectedSlugFrom, urlWithSelection } from './selection';

const SLUGS = ['food', 'housing', 'climate-change'];

describe('selectedSlugFrom', () => {
  it('selects a dimension the portrait has', () => {
    expect(selectedSlugFrom(SLUGS, 'housing')).toBe('housing');
  });

  it('ignores unknown, empty and missing values (an empty panel, not an error)', () => {
    expect(selectedSlugFrom(SLUGS, 'networks')).toBeNull();
    expect(selectedSlugFrom(SLUGS, 'Housing')).toBeNull();
    expect(selectedSlugFrom(SLUGS, '')).toBeNull();
    expect(selectedSlugFrom(SLUGS, null)).toBeNull();
    expect(selectedSlugFrom(SLUGS, undefined)).toBeNull();
  });

  it('uses the first of a repeated parameter, as URLSearchParams.get does', () => {
    expect(selectedSlugFrom(SLUGS, ['food', 'housing'])).toBe('food');
    expect(selectedSlugFrom(SLUGS, ['nope', 'housing'])).toBeNull();
    expect(selectedSlugFrom(SLUGS, [])).toBeNull();
  });
});

describe('links', () => {
  it('a row links to the page with the dimension selected, landing on the panel', () => {
    expect(dimensionHref('/santacruz', 'housing')).toBe('/santacruz?dim=housing#panel');
    expect(dimensionHref('/es/manhattan', 'climate-change')).toBe('/es/manhattan?dim=climate-change#panel');
  });

  it('encodes a slug that is not URL-safe', () => {
    expect(dimensionHref('/x', 'a b&c')).toBe('/x?dim=a%20b%26c#panel');
  });

  it('close links to the page with nothing selected', () => {
    expect(closedHref('/santacruz')).toBe('/santacruz#panel');
  });
});

describe('urlWithSelection', () => {
  it('sets the parameter and drops the fragment', () => {
    expect(urlWithSelection('https://df.example/santacruz', 'food')).toBe('/santacruz?dim=food');
    expect(urlWithSelection('https://df.example/santacruz?dim=food#panel', 'housing')).toBe('/santacruz?dim=housing');
  });

  it('removes the parameter when nothing is selected', () => {
    expect(urlWithSelection('https://df.example/santacruz?dim=food#panel', null)).toBe('/santacruz');
  });

  it('keeps other parameters', () => {
    expect(urlWithSelection('https://df.example/ar/santacruz?utm=x&dim=food', 'housing')).toBe(
      '/ar/santacruz?utm=x&dim=housing',
    );
    expect(urlWithSelection('https://df.example/santacruz?utm=x&dim=food', null)).toBe('/santacruz?utm=x');
  });
});

describe('isPlainClick', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

  it('handles a plain primary click in place', () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it('leaves new-tab, new-window, download and middle clicks to the link', () => {
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainClick({ ...plain, defaultPrevented: true })).toBe(false);
  });
});
