import { describe, expect, it } from 'vitest';
import { isHomeOrSectionPage } from './source-links.js';

describe('isHomeOrSectionPage', () => {
  it('marks a home page and a one-segment section page', () => {
    expect(isHomeOrSectionPage('https://www.epa.gov/')).toBe(true);
    expect(isHomeOrSectionPage('https://www.epa.gov')).toBe(true);
    expect(isHomeOrSectionPage('https://www.epa.gov/water')).toBe(true);
    expect(isHomeOrSectionPage('https://www.epa.gov/water/')).toBe(true);
    // A fragment does not change the page that is fetched.
    expect(isHomeOrSectionPage('https://www.epa.gov/water#top')).toBe(true);
  });

  it('does not mark a document, a deeper page or a page picked out by a query', () => {
    expect(isHomeOrSectionPage('https://www.epa.gov/water/report.pdf')).toBe(false);
    expect(isHomeOrSectionPage('https://www.epa.gov/report.pdf')).toBe(false);
    expect(isHomeOrSectionPage('https://www.epa.gov/water/quality')).toBe(false);
    expect(isHomeOrSectionPage('https://data.city.gov/rent?year=2024')).toBe(false);
    expect(isHomeOrSectionPage('https://data.city.gov/?table=rent')).toBe(false);
  });

  it('leaves a string that is not a URL to the URL check', () => {
    expect(isHomeOrSectionPage('not a url')).toBe(false);
    expect(isHomeOrSectionPage('')).toBe(false);
  });
});
